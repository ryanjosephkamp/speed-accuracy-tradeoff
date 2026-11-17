"""QR codes in poor light: decode each video frame alone, or accumulate evidence across frames?

A QR code is filmed by a still camera in poor light: each frame is the code's pattern at low
contrast plus independent pixel noise, measured by the per-pixel signal-to-noise ratio (SNR, the
light-dark difference over the noise standard deviation). Policies, each stopping at the first
frame where the decoder returns any text:
- per_frame: decode each frame on its own (what a basic scanner does);
- average: decode the running average of all frames so far (frames are aligned: a still camera);
- modules: average the pixels in each module (the code's cells, with the grid known), add up
  across frames, and decode a clean image of the signs. This is the most evidence a decoder could
  use, since the module averages are the sufficient statistic under Gaussian noise; knowing the
  grid exactly gives it an edge a real scanner would have to earn by locating the code.
- modules_gated: as modules, but stop only when the expected number of wrong modules (from each
  module's posterior) is below a bound, which trades frames for fewer misreads.
Reports frames to a correct read and the misread rate. Writes experiments/results/qr_frames.json.
"""
import json
import sys
import time
from pathlib import Path

import multiprocessing as mp

import numpy as np
import segno
import zxingcpp

PX = 4          # pixels per module
QUIET = 4       # quiet zone, modules
K_MAX = 80      # give up after this many frames
PAYLOADS = ["https://example.com/r/7F3K9Q", "WIFI:T:WPA;S:lab;P:k3y-9081;;", "otpauth://totp/x?secret=JBSWY3DP"]


def code(payload, ec):
    q = segno.make(payload, error=ec, boost_error=False, micro=False)
    m = np.pad(np.array(q.matrix, dtype=np.int8), QUIET, constant_values=0)  # 1 = dark
    return m


def to_image(z):
    """Float frame (signal plus noise) to an 8-bit image the decoder sees, with automatic gain."""
    z = (z - z.mean()) / (z.std() + 1e-9)
    return np.clip(128 + 40 * z, 0, 255).astype(np.uint8)


HUNG = []  # images on which the decoder ran past the time limit


def _worker(conn):
    import zxingcpp as z
    while True:
        img = conn.recv()
        if img is None:
            return
        r = z.read_barcodes(img, formats=z.BarcodeFormat.QRCode)
        conn.send(r[0].text if r else None)


class Decoder:
    """Runs the decoder in a child process, so a decode that hangs (it very rarely does, inside
    the C++ library) can be stopped: past `limit` seconds it counts as a failed read, and the
    child is replaced."""

    def __init__(self, limit=2.0):
        self.limit = limit
        self.ctx = mp.get_context("spawn")
        self._start()

    def _start(self):
        self.conn, child = self.ctx.Pipe()
        self.proc = self.ctx.Process(target=_worker, args=(child,), daemon=True)
        self.proc.start()

    def __call__(self, img):
        self.conn.send(img)
        if self.conn.poll(self.limit):
            return self.conn.recv()
        HUNG.append(img.copy())
        self.proc.kill()
        self.proc.join()
        self._start()
        return None


decode = None


def trial(m, payload, snr, rng, gate):
    dark = np.kron(m, np.ones((PX, PX), np.int8)).astype(float)
    signal = snr * (0.5 - dark)  # light +snr/2, dark -snr/2, noise sd 1
    n_mod = m.shape[0]
    total = np.zeros_like(signal)
    mod_sum = np.zeros((n_mod, n_mod))
    res = {}
    for k in range(1, K_MAX + 1):
        frame = signal + rng.standard_normal(signal.shape)
        total += frame
        mod_sum += frame.reshape(n_mod, PX, n_mod, PX).mean(axis=(1, 3))
        todo = [p for p in ("per_frame", "average", "modules", "modules_gated") if p not in res]
        if not todo:
            break
        clean = None
        for p in todo:
            if p == "per_frame":
                img = to_image(frame)
            elif p == "average":
                img = to_image(total / k)
            else:
                if clean is None:
                    sign = (mod_sum < 0).astype(np.int8)  # 1 = dark
                    clean = to_image(np.kron(0.5 - sign, np.ones((PX, PX))))
                    # each module's evidence: sum of k * PX^2 pixel means; log-odds of light vs dark
                    llr = 2 * (snr / 2) * mod_sum * PX * PX  # per-module log-likelihood ratio
                    p_wrong = 1 / (1 + np.exp(np.abs(llr)))
                    exp_wrong = float(p_wrong.sum())
                img = clean
                if p == "modules_gated" and exp_wrong > gate:
                    continue
            text = decode(img)
            if text is not None:
                res[p] = (k, text == payload)
    for p in ("per_frame", "average", "modules", "modules_gated"):
        res.setdefault(p, (None, False))
    return res


def main(trials=120):
    global decode
    decode = Decoder()
    rows = []
    rng = np.random.default_rng(2026)
    t0 = time.time()
    for ec in ("l", "m"):
        codes = [(code(p, ec), p) for p in PAYLOADS]
        for snr in (1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0):
            out = {p: [] for p in ("per_frame", "average", "modules", "modules_gated")}
            for i in range(trials):
                m, payload = codes[i % len(codes)]
                r = trial(m, payload, snr, rng, gate=0.5)
                for p, v in r.items():
                    out[p].append(v)
            row = dict(ec=ec, snr=snr, trials=trials)
            for p, v in out.items():
                frames = np.array([k if (k is not None and ok) else np.inf for k, ok in v])
                mis = sum(1 for k, ok in v if k is not None and not ok)
                fail = sum(1 for k, ok in v if k is None)
                row[p] = dict(median_frames=float(np.median(frames)), mean_frames_read=float(frames[np.isfinite(frames)].mean()) if np.isfinite(frames).any() else None,
                              read_rate=float(np.isfinite(frames).mean()), misreads=mis, timeouts=fail)
            rows.append(row)
            print(f"ec {ec} snr {snr:4.2f}: " + " | ".join(
                f"{p} med {row[p]['median_frames']:>4} read {row[p]['read_rate']:.2f} mis {row[p]['misreads']}" for p in out),
                f"({time.time() - t0:.0f}s)", flush=True)
    print(f"decodes stopped at the time limit: {len(HUNG)}")
    if HUNG:
        np.save(Path(__file__).parent / "results" / "qr_hung_images.npy", np.array(HUNG))
    (Path(__file__).parent / "results" / "qr_frames.json").write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 120)
