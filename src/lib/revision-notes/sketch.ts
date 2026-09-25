/**
 * Hand-drawn strokes as SVG path data. Every line is drawn as a gentle curve
 * with a little jitter at the ends and the middle, then drawn a second time
 * with a different jitter — the double stroke is what reads as "pen on paper".
 *
 * Randomness is seeded (from the problem title), so the same notes always
 * produce the same image — no flicker between renders, stable downloads.
 */

export type Rng = () => number;

/** mulberry32 — tiny, fast, good enough for jitter. */
export function seededRng(seed: string): Rng {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);

function jitter(rng: Rng, amount: number): number {
  return (rng() * 2 - 1) * amount;
}

/** One wobbly stroke from (x1,y1) to (x2,y2). */
function stroke(rng: Rng, x1: number, y1: number, x2: number, y2: number, wobble: number): string {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const amp = Math.min(wobble, 0.6 + len / 400);
  // Slight overshoot/undershoot at the ends, like a quick pen stroke.
  const sx = x1 + jitter(rng, amp);
  const sy = y1 + jitter(rng, amp);
  const ex = x2 + jitter(rng, amp);
  const ey = y2 + jitter(rng, amp);
  const mx = (sx + ex) / 2 + jitter(rng, amp * 1.6);
  const my = (sy + ey) / 2 + jitter(rng, amp * 1.6);
  return `M${f(sx)} ${f(sy)} Q${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}`;
}

/** A sketchy line: two overlapping strokes. */
export function sketchLine(
  rng: Rng,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  wobble = 2.2,
): string {
  return `${stroke(rng, x1, y1, x2, y2, wobble)} ${stroke(rng, x1, y1, x2, y2, wobble)}`;
}

/** A sketchy rounded rectangle (sides + quarter-curve corners), drawn twice. */
export function sketchRoundedRect(
  rng: Rng,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  wobble = 2.2,
): string {
  const pass = () => {
    const j = () => jitter(rng, wobble * 0.6);
    const x2 = x + w;
    const y2 = y + h;
    return [
      `M${f(x + r + j())} ${f(y + j())}`,
      `Q${f(x + w / 2 + j())} ${f(y + j() * 1.5)} ${f(x2 - r + j())} ${f(y + j())}`,
      `Q${f(x2 + j())} ${f(y + j())} ${f(x2 + j())} ${f(y + r + j())}`,
      `Q${f(x2 + j() * 1.5)} ${f(y + h / 2 + j())} ${f(x2 + j())} ${f(y2 - r + j())}`,
      `Q${f(x2 + j())} ${f(y2 + j())} ${f(x2 - r + j())} ${f(y2 + j())}`,
      `Q${f(x + w / 2 + j())} ${f(y2 + j() * 1.5)} ${f(x + r + j())} ${f(y2 + j())}`,
      `Q${f(x + j())} ${f(y2 + j())} ${f(x + j())} ${f(y2 - r + j())}`,
      `Q${f(x + j() * 1.5)} ${f(y + h / 2 + j())} ${f(x + j())} ${f(y + r + j())}`,
      `Q${f(x + j())} ${f(y + j())} ${f(x + r + j())} ${f(y + j())}`,
    ].join(" ");
  };
  return `${pass()} ${pass()}`;
}
