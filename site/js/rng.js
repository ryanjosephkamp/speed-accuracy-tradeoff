// A small seeded random number generator, so every run on the page can be repeated from its seed:
// sfc32 (seeded through splitmix32) for uniforms and Box–Muller for standard normals. The page
// gives the evidence and the dots separate streams, so drawing the dots never touches the
// evidence's random numbers.

function splitmix32(a) {
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    const sm = splitmix32(this.seed);
    this.a = sm(); this.b = sm(); this.c = sm(); this.d = sm();
    for (let i = 0; i < 12; i++) this.u32();
    this.spare = null;
  }
  u32() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }
  /** Uniform on [0, 1), with 53 random bits. */
  next() {
    return ((this.u32() >>> 5) * 67108864 + (this.u32() >>> 6)) / 9007199254740992;
  }
  /** Standard normal. */
  gauss() {
    if (this.spare !== null) { const s = this.spare; this.spare = null; return s; }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
}

/** A fresh seed for a new run, shown on the page so the run can be repeated. */
export const freshSeed = () => (Math.random() * 1e9) >>> 0;
/** The dots' stream for a run's seed. */
export const dotSeed = (seed) => (seed ^ 0x5bd1e995) >>> 0;
