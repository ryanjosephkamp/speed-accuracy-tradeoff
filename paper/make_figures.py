"""Figures, tables, and quoted numbers for the paper.

Reads experiments/results/*.json and the closed forms below, and writes
paper/figures/*.pdf and paper/generated/*.tex. Run from the repository root:

    uv run --group paper python paper/make_figures.py
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from scipy.optimize import brentq  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "experiments" / "results"
FIG = ROOT / "paper" / "figures"
GEN = ROOT / "paper" / "generated"
FIG.mkdir(exist_ok=True)
GEN.mkdir(exist_ok=True)

INK, MUTED, GRID = "#0b0b0b", "#898781", "#e1e0d9"
BLUE, ORANGE = "#2a78d6", "#eb6834"  # weighted rule, per-moment rule
RAMP = ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"]  # sequential blue, light to dark

plt.rcParams.update({
    "font.family": "serif", "font.serif": ["STIXGeneral", "Times New Roman", "DejaVu Serif"],
    "mathtext.fontset": "stix", "font.size": 9, "axes.labelsize": 9, "axes.titlesize": 9,
    "legend.fontsize": 8, "xtick.labelsize": 8, "ytick.labelsize": 8,
    "axes.edgecolor": "#c3c2b7", "axes.linewidth": 0.6, "xtick.color": "#52514e",
    "ytick.color": "#52514e", "axes.labelcolor": INK, "axes.grid": True, "grid.color": GRID,
    "grid.linewidth": 0.5, "axes.spines.top": False, "axes.spines.right": False,
    "legend.frameon": False, "lines.linewidth": 1.4, "savefig.bbox": "tight",
    "savefig.pad_inches": 0.02,
})


def load(name):
    return json.loads((RES / f"{name}.json").read_text())


# --- closed forms, with mu = sigma = 1 ---------------------------------------------------------

def bound(c: float) -> float:
    """Optimal evidence bound for a constant cost c: the root of sinh(2b) + 2b = 1/c."""
    return brentq(lambda b: np.sinh(2 * b) + 2 * b - 1 / c, 1e-12, 50)


def transfer(c0: float, lam):
    """Laplace transform of the normalized kernel: 2 c0 cosh^2(b0) [r tanh(r b0) - tanh b0] / lam."""
    b0 = bound(c0)
    lam = np.asarray(lam, dtype=complex)
    r = np.sqrt(2 * lam + 1)
    return 2 * c0 * np.cosh(b0) ** 2 * (r * np.tanh(r * b0) - np.tanh(b0)) / lam


def mean_look_ahead(c0: float) -> float:
    b0 = bound(c0)
    return c0 * (np.sinh(2 * b0) / 2 - b0 + 2 * b0 ** 2 * np.tanh(b0))


def mean_decision_time(c0: float) -> float:
    b0 = bound(c0)
    return b0 * np.tanh(b0)


def kernel(c0: float, s, terms: int = 6000):
    """Normalized kernel w(s): the survival flux at the bound, -d/dx P_x(tau > s) at x = b0, for
    the filtered process, as an eigenfunction series. Under the decision maker's beliefs the drift
    is +1 with probability g(b0) and -1 otherwise."""
    b0 = bound(c0)
    g = 1 / (1 + np.exp(-2 * b0))
    n = np.arange(1, terms + 1)
    k = n * np.pi / (2 * b0)
    s = np.atleast_1d(np.asarray(s, float))
    out = np.zeros_like(s)
    for a, p in ((1.0, g), (-1.0, 1 - g)):
        amp = k * k / (b0 * (a * a + k * k)) * (1 - (-1.0) ** n * np.exp(-2 * a * b0))
        out += p * (np.exp(-np.outer(s, 0.5 * (k * k + a * a))) @ amp)
    total = np.tanh(b0) + b0 / np.cosh(b0) ** 2  # = 1 / (2 c0 cosh^2 b0), the kernel's mass
    return out / total


def gain_lead(amp_phase, ref):
    """Swing relative to the per-moment swing, and lead in degrees, from (amplitude, phase) fits."""
    lead = (amp_phase[1] - ref[1] + 180) % 360 - 180
    return amp_phase[0] / ref[0], lead


# --- numbers quoted in the text ------------------------------------------------------------------

macros: dict[str, str] = {}


def macro(name: str, value: str):
    macros[name] = value


cs = np.geomspace(1e-4, 10, 4000)
mla = np.array([mean_look_ahead(c) for c in cs])
i = int(np.argmax(mla))
macro("MaxLookAhead", f"{mla[i]:.3f}")
macro("MaxLookAheadCost", f"{cs[i]:.3f}")
macro("LookAheadTenth", f"{mean_look_ahead(0.1):.3f}")
macro("DecisionTimeTenth", f"{mean_decision_time(0.1):.2f}")
macro("BoundTenth", f"{bound(0.1):.3f}")

# --- Figure 1: showcase schedules ---------------------------------------------------------------

show = load("showcase")
TITLES = ["(a) Cost jumps 16-fold at $t = 0.5$", "(b) Cost falls from 0.4 to 0.05 at $t = 0.3$",
          "(c) Flat, then rising after $t = 0.5$", "(d) Hard deadline at $t = 1$"]
fig = plt.figure(figsize=(6.3, 5.0))
outer = fig.add_gridspec(2, 2, hspace=0.55, wspace=0.28)
first = None
for k, (s, title) in enumerate(zip(show["schedules"], TITLES)):
    inner = outer[k // 2, k % 2].subgridspec(2, 1, height_ratios=[1, 2.6], hspace=0.18)
    ac = fig.add_subplot(inner[0])
    ax = fig.add_subplot(inner[1], sharex=ac)
    t = np.array(s["t"])
    cost = np.array(s["cost"], dtype=float)
    finite = cost < 50  # past a deadline the cost is infinite
    ac.plot(t[finite], cost[finite], color=MUTED, lw=1.2)
    top = max(cost[finite].max() * 1.15, 0.05)
    ac.set_ylim(0, top)
    ac.set_yticks([0, float(f"{cost[finite].max():.2g}")])
    ac.set_ylabel("Cost", labelpad=2)
    ac.tick_params(labelbottom=False)
    ac.set_title(title, loc="left", color=INK)
    ax.plot(t, s["exact"], color=INK, lw=1.6, label="Optimal")
    ax.plot(t, s["per_moment"], color=ORANGE, ls=(0, (4, 2)), label="Per-moment")
    ax.plot(t, s["weighted"], color=BLUE, ls=(0, (1.2, 1.2)), lw=1.8, label="Weighted look-ahead")
    ax.set_ylim(0, None)
    ax.set_xlim(0, t.max())
    ax.set_xlabel("Time $t$")
    ax.set_ylabel("Bound on $|X|$")
    first = first or ax
first.legend(loc="upper right")
fig.savefig(FIG / "showcase.pdf")
plt.close(fig)

rows = []
for s, title in zip(show["schedules"], TITLES):
    rows.append(f"{title[4:]} & {s['loss']['per_moment']:.2f} & {s['loss']['weighted']:.3f} \\\\")
(GEN / "tab_showcase.tex").write_text("\n".join(rows) + "\n")

# --- Figure 2: kernels and mean look-ahead -----------------------------------------------------

fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.3, 2.5))
s = np.geomspace(1e-3, 8.0, 500)
for c0, col in zip((0.3, 0.1, 0.05, 0.02), RAMP):
    w = kernel(c0, s)
    a1.loglog(s, w, color=col, label=f"$c_0 = {c0:g}$")
    m = mean_look_ahead(c0)
    a1.plot([m], [kernel(c0, m)[0]], "o", ms=4.5, color=col, mec="white", mew=0.8)
a1.set_ylim(1e-3, 20)
a1.set_xlim(1e-3, 8)
a1.set_xlabel("Time ahead $s$")
a1.set_ylabel("Weight $w(s)$")
a1.legend(loc="upper right")
a1.set_title("(a) Kernels; dots mark the mean", loc="left")
a2.semilogx(cs, mla, color=BLUE, label="Mean look-ahead")
a2.semilogx(cs, [mean_decision_time(c) for c in cs], color=INK, ls=(0, (4, 2)), label="Mean decision time")
a2.axhline(0.5, color=MUTED, lw=0.8, ls=":")
a2.set_ylim(0, 2.5)
a2.set_xlabel("Cost $c_0$")
a2.set_ylabel("Time")
a2.legend(loc="upper right")
a2.set_title("(b) How far ahead the bound looks", loc="left")
fig.tight_layout()
fig.savefig(FIG / "kernels.pdf")
plt.close(fig)

# --- Figure 3: transfer function against the dynamic program -----------------------------------

om = np.geomspace(0.05, 200, 400)
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.3, 2.5))
for c0, col in zip((0.3, 0.1, 0.02), (RAMP[0], RAMP[1], RAMP[3])):
    W = transfer(c0, -1j * om)
    a1.loglog(om, np.abs(W), color=col, label=f"$c_0 = {c0:g}$")
    a2.semilogx(om, np.degrees(np.angle(W)), color=col, label=f"$c_0 = {c0:g}$")
c0 = 0.1
b0 = bound(c0)
a1.loglog(om[om > 2], 2 * c0 * np.cosh(b0) ** 2 * np.sqrt(2 / om[om > 2]), color=MUTED, lw=0.8, ls=":")
a2.axhline(45, color=MUTED, lw=0.8, ls=":")
dp = [gain_lead(r["exact"], r["per_moment"]) for r in show["first_order"]]
oms = [r["omega"] for r in show["first_order"]]
a1.plot(oms, [d[0] for d in dp], "o", ms=5, color=INK, mec="white", mew=0.8, label="Dynamic program")
a2.plot(oms, [d[1] for d in dp], "o", ms=5, color=INK, mec="white", mew=0.8, label="Dynamic program")
a1.set_xlabel("Angular frequency $\\omega$")
a1.set_ylabel("Swing / per-moment swing")
a1.set_title("(a) Gain $|\\tilde w(-i\\omega)|$", loc="left")
a1.legend(loc="lower left")
a2.set_xlabel("Angular frequency $\\omega$")
a2.set_ylabel("Lead (degrees)")
a2.set_ylim(0, 50)
a2.set_title("(b) Lead $\\arg \\tilde w(-i\\omega)$", loc="left")
fig.tight_layout()
fig.savefig(FIG / "transfer.pdf")
plt.close(fig)

rows = []
for r, (gx, lx) in zip(show["first_order"], dp):
    W = transfer(0.1, -1j * r["omega"])
    gw, lw = gain_lead(r["weighted"], r["per_moment"])
    rows.append(f"{r['omega']:g} & {abs(W):.3f} & {np.degrees(np.angle(W)):.1f} & {gx:.3f} & {lx:.1f} "
                f"& {gw:.3f} & {lw:.1f} \\\\")
(GEN / "tab_sinusoid.tex").write_text("\n".join(rows) + "\n")
macro("ClosedFormWorstGain", f"{100 * max(abs(abs(transfer(0.1, -1j * r['omega'])) / gx - 1) for r, (gx, lx) in zip(show['first_order'], dp)):.1f}")
macro("ClosedFormWorstLead", f"{max(abs(np.degrees(np.angle(transfer(0.1, -1j * r['omega']))) - lx) for r, (gx, lx) in zip(show['first_order'], dp)):.2f}")
worst_gain = max(abs(gain_lead(r["weighted"], r["per_moment"])[0] / gx - 1)
                 for r, (gx, lx) in zip(show["first_order"], dp))
worst_lead = max(abs(gain_lead(r["weighted"], r["per_moment"])[1] - lx)
                 for r, (gx, lx) in zip(show["first_order"], dp))
macro("SinusoidWorstGain", f"{100 * worst_gain:.1f}")
macro("SinusoidWorstLead", f"{worst_lead:.2f}")
g8, l8 = dp[-1]
macro("PerMomentTooLargeAtEight", f"{1 / g8:.1f}")
macro("PerMomentLateAtEight", f"{l8:.1f}")

# --- Figure 4 and table: random schedules ------------------------------------------------------

rand = load("random_schedules")
fams = (("smooth", "Smooth"), ("step", "Step"), ("deadline", "Deadline"))
fig, ax = plt.subplots(figsize=(6.3, 2.4))
rng = np.random.default_rng(0)
floor = 1e-4
rows = []
for j, (k, label) in enumerate(fams):
    pm = np.array([r["per_moment"] for r in rand if r["kind"] == k])
    wb = np.array([r["weighted_bound"] for r in rand if r["kind"] == k])
    for off, v, col, name in ((-0.17, pm, ORANGE, "Per-moment"), (0.17, wb, BLUE, "Weighted look-ahead")):
        x = j + off + rng.uniform(-0.07, 0.07, len(v))
        ax.scatter(x, np.maximum(v, floor), s=12, color=col, edgecolor="white", linewidth=0.5,
                   label=name if j == 0 else None, zorder=3)
    rec = 1 - wb.sum() / pm.sum()
    rows.append(f"{label} & {len(pm)} & {np.median(pm):.3f} & {pm.max():.2f} & {np.median(wb):.4f} "
                f"& {wb.max():.3f} & {100 * rec:.1f}\\% \\\\")
    macro(f"Recovered{label}", f"{100 * rec:.1f}")
    macro(f"PerMomentMedian{label}", f"{np.median(pm):.2f}")
all_pm = np.array([r["per_moment"] for r in rand])
all_wb = np.array([r["weighted_bound"] for r in rand])
macro("PerMomentMaxAll", f"{all_pm.max():.2f}")
macro("WeightedMaxAll", f"{all_wb.max():.3f}")
ax.set_yscale("log")
ax.set_ylim(floor / 1.5, 5)
ax.set_xticks(range(3), [f[1] for f in fams])
ax.set_ylabel("Loss (points per 100 trials)")
ax.grid(axis="x", visible=False)
ax.legend(loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=2)
fig.tight_layout()
fig.savefig(FIG / "random_losses.pdf")
plt.close(fig)
(GEN / "tab_random.tex").write_text("\n".join(rows) + "\n")

# --- tables: unknown reliability, braking, lopsided stakes, loss formula -----------------------

unk = load("unknown_reliability")
def unknown_label(name):
    """Readable row labels; times are in units of sigma^2 / mu^2, so drop the seconds."""
    import re
    m = re.match(r"constant ([\d.]+)$", name)
    if m:
        return f"Constant {m.group(1)}"
    m = re.match(r"flat ([\d.]+), rising ([\d.]+)/s after ([\d.]+) s$", name)
    if m:
        return f"Flat {m.group(1)}, then rising {m.group(2)} per unit time after $t = {m.group(3)}$"
    m = re.match(r"deadline ([\d.]+) s at cost ([\d.]+)$", name)
    if m:
        return f"Deadline at $t = {m.group(1)}$, cost {m.group(2)}"
    return name


rows = [f"{unknown_label(u['name'])} & {u['frozen_time']:.3f} & {u['weighted']:.3f} & {u['plug_in']:.3f} & "
        f"{u['best_fixed']:.3f} \\\\" for u in unk]
(GEN / "tab_unknown.tex").write_text("\n".join(rows) + "\n")
macro("UnknownWeightedMax", f"{max(u['weighted'] for u in unk):.3f}")
macro("UnknownFrozenMax", f"{max(u['frozen_time'] for u in unk):.2f}")

brk = load("braking")
for k, name in (("per_moment", "PerMoment"), ("weighted", "Weighted"), ("best_fixed", "BestFixed")):
    v = np.array([b[k] for b in brk])
    macro(f"Braking{name}Median", f"{np.median(v):.2f}")
    macro(f"Braking{name}Max", f"{v.max():.2f}")
macro("BrakingCount", str(len(brk)))

lop = load("lopsided")
rows = []
for rm in (0.5, 0.25):
    for k, label in fams:
        sel = [r for r in lop["random"] if r["r_minus"] == rm and r["kind"] == k]
        pm = np.array([r["per_moment"] for r in sel])
        wb = np.array([r["weighted"] for r in sel])
        rec = 1 - wb.sum() / pm.sum()
        rows.append(f"{rm:g} & {label} & {np.median(pm):.3f} & {pm.max():.3f} & {wb.max():.3f} & "
                    f"{100 * rec:.1f}\\% \\\\")
(GEN / "tab_lopsided.tex").write_text("\n".join(rows) + "\n")
errs = []
for r in lop["first_order"]:  # every frequency; each is fit over whole periods
    for side in ("hi", "lo"):
        ex, fo = r[side]["exact"], r[side]["first_order"]
        errs.append((abs(fo[0] / ex[0] - 1), abs(fo[1] - ex[1])))
macro("LopsidedWorstGain", f"{100 * max(e[0] for e in errs):.1f}")
macro("LopsidedWorstLead", f"{max(e[1] for e in errs):.1f}")
macro("LopsidedPerMomentMax", f"{max(r['per_moment'] for r in lop['random']):.2f}")
macro("LopsidedWeightedMax", f"{max(r['weighted'] for r in lop['random']):.3f}")

lf = load("loss_formula")
rows = []
for kind, size in sorted({(r["kind"], r["size"]) for r in lf}, key=lambda x: (x[0] != "smooth", x[1])):
    sel = [r for r in lf if r["kind"] == kind and r["size"] == size]
    pl = sum(r["per_moment"]["loss"] for r in sel)
    pp = sum(r["per_moment"]["predicted"] for r in sel)
    wl = sum(r["weighted"]["loss"] for r in sel)
    wp = sum(r["weighted"]["predicted"] for r in sel)
    what = f"{size:g}" if kind == "smooth" else f"{size:g}$\\times$"
    rows.append(f"{kind.capitalize()} & {what} & {pl:.4f} & {pp / pl:.2f} & {wl:.5f} & {wp / wl:.2f} \\\\")
(GEN / "tab_loss.tex").write_text("\n".join(rows) + "\n")
pm_ratio, wb_ratio = {}, {}
for kind, size in {(r["kind"], r["size"]) for r in lf}:
    sel = [r for r in lf if r["kind"] == kind and r["size"] == size]
    pm_ratio[(kind, size)] = sum(r["per_moment"]["predicted"] for r in sel) / sum(r["per_moment"]["loss"] for r in sel)
    wb_ratio[(kind, size)] = sum(r["weighted"]["predicted"] for r in sel) / sum(r["weighted"]["loss"] for r in sel)
moderate = [v for k, v in pm_ratio.items() if not (k[0] == "step" and k[1] > 3)]
macro("LossPmLow", f"{round(100 * (min(moderate) - 1)):d}")
macro("LossPmHigh", f"{round(100 * (max(moderate) - 1)):d}")
macro("LossPmSixteen", f"{round(100 * (pm_ratio[('step', 16.0)] - 1)):d}")
macro("LossWbLow", f"{min(wb_ratio.values()):.2f}")
macro("LossWbHigh", f"{max(wb_ratio.values()):.2f}")
pm_tot = sum(r["per_moment"]["loss"] for r in lf)
wb_tot = sum(r["weighted"]["loss"] for r in lf)
macro("LossTotalRatio", f"{pm_tot / wb_tot:.0f}")

# Loss scaling: one smooth shape at growing amplitude, scored on the paper's grid and on one twice
# as fine. A loss of order p grows 2^p-fold per doubling of the amplitude. The per-moment rule's
# order is fitted for a <= 0.4 on the paper's grid; the weighted rule's for a >= 0.2, where the two
# grids agree on its loss to within about 30%, on each grid. Below that its loss is too small for
# the grid to resolve.
ls = load("loss_scaling")


def sci(v):
    m, e = f"{v:.1e}".split("e")
    return f"${m}\\times 10^{{{int(e)}}}$".replace("$-", "$-")


def order(rs, key, grid, lo, hi):
    a = [r for r in rs if lo <= r["amplitude"] <= hi]
    return float(np.log(a[-1][grid][key] / a[0][grid][key]) / np.log(a[-1]["amplitude"] / a[0]["amplitude"]))


rows, pm_growth = [], []
prev = None
for r in ls["rows"]:
    a, pm = r["amplitude"], r["paper"]["per_moment"]
    g_pm = pm / prev["paper"]["per_moment"] if prev else None
    if g_pm and a <= 0.4:
        pm_growth.append(g_pm)
    rows.append(f"{a:g} & {sci(pm)} & {f'{g_pm:.1f}' if g_pm else '---'} & "
                f"{sci(r['paper']['weighted'])} & {sci(r['fine']['weighted'])} \\\\")
    prev = r
(GEN / "tab_scaling.tex").write_text("\n".join(rows) + "\n")
two = next(r for r in ls["rows"] if r["amplitude"] == 0.2)
macro("ScalingCost", f"{ls['cost']:g}")
macro("ScalingPmGrowthLow", f"{min(pm_growth):.1f}")
macro("ScalingPmGrowthHigh", f"{max(pm_growth):.1f}")
macro("ScalingPmOrder", f"{order(ls['rows'], 'per_moment', 'paper', 0, 0.4):.1f}")
wb_orders = [order(ls["rows"], "weighted", g, 0.2, 0.8) for g in ("paper", "fine")]
macro("ScalingWbOrderLow", f"{min(wb_orders):.1f}")
macro("ScalingWbOrderHigh", f"{max(wb_orders):.1f}")
macro("ScalingGridChangeTwo", f"{100 * abs(two['fine']['weighted'] / two['paper']['weighted'] - 1):.0f}")


# --- Theorem 7 sweep: cost, frequency, and perturbation size ----------------------------------

sw = load("first_order_sweep")
rows = []
for rel in sorted({r["rel"] for r in sw}):
    cells = []
    for c0 in sorted({r["c0"] for r in sw}):
        ratios = [r["swing_ratio"] for r in sw if r["rel"] == rel and r["c0"] == c0]
        lo, hi = min(ratios), max(ratios)
        cells.append(f"{lo:.3f}" if f"{lo:.3f}" == f"{hi:.3f}" else f"{lo:.3f}--{hi:.3f}")
    ph = max(abs(r["phase_error"]) for r in sw if r["rel"] == rel)
    rows.append(f"{rel:g} & " + " & ".join(cells) + f" & {ph:.2f} \\\\")
(GEN / "tab_sweep.tex").write_text("\n".join(rows) + "\n")
for rel, name in ((0.1, "Tenth"), (0.3, "Third"), (0.6, "SixTenths")):
    macro(f"SweepSwing{name}", f"{100 * max(abs(r['swing_ratio'] - 1) for r in sw if r['rel'] == rel):.1f}")
    macro(f"SweepPhase{name}", f"{max(abs(r['phase_error']) for r in sw if r['rel'] == rel):.2f}")

# --- Held-out schedules: losses, recovery, baselines, behavior ---------------------------------

held = load("held_out")
HFAMS = (("smooth", "Smooth"), ("step", "Step"), ("deadline", "Deadline"), ("pulse", "Pulse"),
         ("ramp", "Ramp"), ("multi-step", "Multi-step"), ("piecewise", "Piecewise"))
POLICIES = (("per_moment", "Per-moment"), ("weighted", "Weighted look-ahead"),
            ("weighted_one_pass", "Weighted, one pass"), ("averaged_cost", "Averaged cost"),
            ("shift_mean", "Shift by mean look-ahead"), ("shift_half", "Shift by 0.5"),
            ("best_constant", "Tuned constant (oracle)"))


def L(rows_, k):
    return np.array([r[k]["loss"] for r in rows_])


def recovery(rows_):
    pm, wb = L(rows_, "per_moment"), L(rows_, "weighted")
    keep = pm >= 0.01
    return 1 - wb[keep] / pm[keep]


rows = []
for k, label in HFAMS:
    rs = [r for r in held if r["family"] == k]
    pm, wb = L(rs, "per_moment"), L(rs, "weighted")
    rec = recovery(rs)
    rows.append(f"{label} & {len(rs)} & {np.median(pm):.3f} & {pm.max():.2f} & {np.median(wb):.4f} & {wb.max():.3f} & "
                f"{100 * np.median(rec):.1f}\\% & {100 * np.percentile(rec, 10):.1f}\\% & {100 * (1 - wb.sum() / pm.sum()):.1f}\\% \\\\")
(GEN / "tab_heldout.tex").write_text("\n".join(rows) + "\n")
rec = recovery(held)
pm_all, wb_all = L(held, "per_moment"), L(held, "weighted")
share = pm_all / (100 * np.array([r["exact"]["reward"] for r in held]))
macro("HeldCount", str(len(held)))
macro("HeldRecoveredCount", str(len(rec)))
macro("HeldRecoveredMedian", f"{100 * np.median(rec):.1f}")
macro("HeldRecoveredPTen", f"{100 * np.percentile(rec, 10):.1f}")
macro("HeldRecoveredMin", f"{100 * rec.min():.1f}")
macro("HeldPerMomentMedian", f"{np.median(pm_all):.2f}")
macro("HeldPerMomentMax", f"{pm_all.max():.2f}")
macro("HeldWeightedMedian", f"{np.median(wb_all):.4f}")
macro("HeldWeightedMax", f"{wb_all.max():.3f}")
macro("HeldShareMedian", f"{100 * np.median(share):.2f}")
macro("HeldShareMax", f"{100 * share.max():.1f}")
macro("HeldPerMomentOverOne", str(int((pm_all >= 1).sum())))
macro("HeldPerMomentUnderTenth", str(int((pm_all < 0.1).sum())))

nodl = [r for r in held if r["family"] != "deadline"]
dl = [r for r in held if r["family"] == "deadline"]
rows = []
for k, label in POLICIES:
    a, d = L(nodl, k), L(dl, k)
    beats = int((a < L(nodl, "per_moment") - 1e-9).sum()) if k != "per_moment" else 0
    worse = int((a > L(nodl, "per_moment") + 1e-9).sum()) if k != "per_moment" else 0
    rows.append(f"{label} & {np.median(a):.4f} & {np.percentile(a, 90):.3f} & {a.max():.2f} & "
                f"{'--' if k == 'per_moment' else f'{beats} / {worse}'} & {np.median(d):.3f} & {d.max():.2f} \\\\")
(GEN / "tab_baselines.tex").write_text("\n".join(rows) + "\n")
macro("HeldNoDeadlineCount", str(len(nodl)))
for k, name in (("shift_mean", "ShiftMean"), ("shift_half", "ShiftHalf"), ("best_constant", "BestConstant"),
                ("averaged_cost", "AveragedCost"), ("weighted_one_pass", "OnePass")):
    macro(f"Held{name}Worse", str(int((L(nodl, k) > L(nodl, "per_moment") + 1e-9).sum())))
    macro(f"Held{name}Beats", str(int((L(nodl, k) < L(nodl, "per_moment") - 1e-9).sum())))
    macro(f"Held{name}Max", f"{L(held, k).max():.2f}")

rows = []
for k, label in HFAMS:
    rs = [r for r in held if r["family"] == k]
    def med(pol, f):
        return np.median([f(r, pol) for r in rs])
    dx = lambda r, pol: r[pol]["max_dx"]
    dp = lambda r, pol: 100 * (r[pol]["p"] - r["exact"]["p"])
    drt = lambda r, pol: r[pol]["rt"] - r["exact"]["rt"]
    def sg(v, d):
        out = f"{v:+.{d}f}"
        return out[1:] if float(out) == 0 else out
    rows.append(f"{label} & {med('per_moment', dx):.3f} & {med('weighted', dx):.3f} & "
                f"{sg(med('per_moment', dp), 2)} & {sg(med('weighted', dp), 2)} & "
                f"{sg(med('per_moment', drt), 3)} & {sg(med('weighted', drt), 3)} \\\\")
(GEN / "tab_behavior.tex").write_text("\n".join(rows) + "\n")

# Paired plot: each held-out schedule's per-moment loss against its weighted loss.
GROUPS = ((("smooth", "pulse", "ramp"), "Smooth changes", "o"),
          (("step", "multi-step", "piecewise"), "Jumps", "^"),
          (("deadline",), "Deadlines", "s"))
fig, ax = plt.subplots(figsize=(4.2, 3.4))
floor = 1e-5
for fams_, label, mk in GROUPS:
    rs = [r for r in held if r["family"] in fams_]
    ax.scatter(np.maximum(L(rs, "per_moment"), floor), np.maximum(L(rs, "weighted"), floor), s=14, marker=mk,
               facecolor="none" if mk != "o" else BLUE, edgecolor=BLUE, linewidth=0.8, label=label, zorder=3, alpha=0.9)
lim = (floor, 10)
for f, txt in ((1, "equal"), (0.1, "10\\%"), (0.01, "1\\%")):
    ax.plot(lim, [lim[0] * f, lim[1] * f], color=MUTED, lw=0.7, ls=":" if f != 1 else "-", zorder=1)
    ax.text(lim[1] / 1.6, lim[1] * f / 1.25, txt.replace("\\", ""), color=MUTED, fontsize=7, ha="right", va="top")
ax.set_xscale("log"); ax.set_yscale("log"); ax.set_xlim(*lim); ax.set_ylim(*lim)
ax.set_xlabel("Per-moment loss (points per 100 trials)")
ax.set_ylabel("Weighted look-ahead loss")
ax.legend(loc="upper left")
fig.tight_layout()
fig.savefig(FIG / "heldout_paired.pdf")
plt.close(fig)

# --- Grid refinement ----------------------------------------------------------------------------

gr = load("grid_refinement")
rows = []
for r in gr:
    pmv = " & ".join(f"{g['per_moment']:.3f}" for g in r["grids"])
    wbv = " & ".join(f"{g['weighted']:.4f}" for g in r["grids"])
    rows.append(f"{r['name'].capitalize()} & {pmv} & {wbv} & {r['residual']:.3f} \\\\")
(GEN / "tab_grid.tex").write_text("\n".join(rows) + "\n")
macro("GridPmMaxChange", f"{max(abs(r['grids'][-1]['per_moment'] - r['grids'][1]['per_moment']) for r in gr):.3f}")
macro("GridWbMaxChange", f"{max(abs(r['grids'][-1]['weighted'] - r['grids'][1]['weighted']) for r in gr):.4f}")
macro("FixedPointMove", f"{max(r['move_300'] for r in gr):.3f}")
fp = max(abs(r['weighted_300'] - r['weighted_30']) for r in gr)
macro("FixedPointLossChange", f"{fp:.4f}" if fp >= 5e-5 else "less than 0.0001")

# --- The finite-horizon floor: the constant-cost bound against the optimum with a forced choice --
hf = {r["cost"]: r for r in load("horizon_floor")}
macro("HorizonFloor", f"{hf[0.02]['per_moment']['loss']:.4f}")

# --- A worked example in physical units (Palmer, Huk, and Shadlen 2005, mean observer) --------
# Proportional-rate fit: drift mu' = k * coherence with noise variance 1 per second, bound A'.
# Time unit T = 1 / mu'^2. The observer's bound in this paper's units is b = mu' A'; reading it
# as the optimum for a constant cost gives c0 = 1 / (sinh 2b + 2b), and the lead is m(c0) T.
K_PALMER, A_PALMER, COH = 21.0, 0.71, 0.064
mu_p = K_PALMER * COH
b_p = mu_p * A_PALMER
c_p = 1 / (np.sinh(2 * b_p) + 2 * b_p)
macro("PalmerT", f"{1000 / mu_p ** 2:.0f}")
macro("PalmerBound", f"{b_p:.2f}")
macro("PalmerCost", f"{c_p:.2f}")
macro("PalmerLookAhead", f"{mean_look_ahead(c_p):.2f}")
macro("PalmerLead", f"{1000 * mean_look_ahead(c_p) / mu_p ** 2:.0f}")
# Sinusoidal costs at 0.5, 1, and 2 Hz: the lead over the per-moment response, in degrees and
# milliseconds, and the gain relative to it, from the closed-form transfer function.
for hz, tag in ((0.5, "HalfHz"), (1.0, "OneHz"), (2.0, "TwoHz")):
    resp = transfer(c_p, -1j * 2 * np.pi * hz / mu_p ** 2)
    deg = float(np.degrees(np.angle(resp)))
    macro(f"PalmerDeg{tag}", f"{deg:.0f}")
    macro(f"PalmerLeadMs{tag}", f"{1000 * deg / 360 / hz:.0f}")
    macro(f"PalmerGain{tag}", f"{abs(resp):.2f}")

(GEN / "numbers.tex").write_text(
    "% Written by make_figures.py. Do not edit.\n"
    + "".join(f"\\newcommand{{\\{k}}}{{{v}}}\n" for k, v in sorted(macros.items())))
print("\n".join(f"{k} = {v}" for k, v in sorted(macros.items())))
