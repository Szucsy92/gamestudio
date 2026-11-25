/**
 * Fewer triangles for the trees with the look kept as close as possible. The cost of a tree is mostly its trunk grid
 * (sides × rows × 2) and the limb tubes (rings × loop × 2). The knobs that change it without touching the shape are the
 * lowest side count (radialMin), the multiplier of the side count (radialMult), the flare rows (flareRows) and the
 * limb rings (limbRings). `reduceTree` tries their combinations and keeps the one that is closest to the original
 * tree among those that reach the triangle target: the distance is measured on the real meshes (rings of the trunk
 * grid at many heights, both ways) plus how far a limb's centre line is cut by having fewer rings.
 */
import { buildTree, type BuildOptions } from "./mesh";
import type { ParamKey, TreeParams } from "./params";

/** The settings that trade triangles for detail. */
export const LOD_KEYS = ["radialMult", "radialMin", "flareRows", "limbRings"] as const satisfies readonly ParamKey[];
export type LodKey = (typeof LOD_KEYS)[number];

const COUNT_SHAPES = [0, 5, 10];
const ERROR_SHAPES = [0, 8];
const ALL_SHAPES = Array.from({ length: 16 }, (_, i) => i);

/** Mean triangles of one tree body of this species over the given shapes. */
export function avgTriangles(p: TreeParams, sp: number, opts: BuildOptions = {}, shapes: readonly number[] = ALL_SHAPES): number {
  let sum = 0;
  for (const s of shapes) sum += buildTree(p, sp, s, { lifelike: true, ...opts }).triangleCount;
  return sum / shapes.length;
}

interface Rings {
  ys: number[];
  /** Ring points (x, z pairs, closed) per row. */
  pts: Float32Array[];
  sides: number;
}

function ringsOf(p: TreeParams, sp: number, shape: number, opts: BuildOptions): Rings {
  const m = buildTree({ ...p, lean: 0 }, sp, shape, { lifelike: true, ...opts });
  const stride = m.ringSides + 1;
  const ys: number[] = [];
  const pts: Float32Array[] = [];
  // the last row only narrows the stem into its cap: left out
  for (let r = 0; r < m.rows - 1; r++) {
    ys.push(m.pos[r * stride * 3 + 1]!);
    const ring = new Float32Array(stride * 2);
    for (let c = 0; c < stride; c++) {
      ring[c * 2] = m.pos[(r * stride + c) * 3]!;
      ring[c * 2 + 1] = m.pos[(r * stride + c) * 3 + 2]!;
    }
    pts.push(ring);
  }
  return { ys, pts, sides: m.ringSides };
}

/** The cross-section of the surface at height y: the rings of the two rows around it, blended. */
function sectionAt(R: Rings, y: number): Float32Array | null {
  const { ys } = R;
  if (y < ys[0]! - 1e-9 || y > ys[ys.length - 1]! + 1e-9) return null;
  let r = 0;
  while (r < ys.length - 2 && y > ys[r + 1]!) r++;
  const a = R.pts[r]!, b = R.pts[Math.min(r + 1, ys.length - 1)]!;
  const t = ys[r + 1]! > ys[r]! ? Math.min(1, Math.max(0, (y - ys[r]!) / (ys[r + 1]! - ys[r]!))) : 0;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t;
  return out;
}

function distToRing(x: number, z: number, ring: Float32Array): number {
  let best = Infinity;
  for (let i = 0; i + 3 < ring.length; i += 2) {
    const ax = ring[i]!, az = ring[i + 1]!, bx = ring[i + 2]!, bz = ring[i + 3]!;
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 1e-12 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const ex = ax + dx * t - x, ez = az + dz * t - z;
    best = Math.min(best, ex * ex + ez * ez);
  }
  return Math.sqrt(best);
}

/** Mean distance of the points of ring `a` (vertices and edge midpoints) from the polygon `b`. */
function oneWay(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < a.length; i += 2) {
    sum += distToRing(a[i]!, a[i + 1]!, b);
    sum += distToRing((a[i]! + a[i + 2]!) / 2, (a[i + 1]! + a[i + 3]!) / 2, b);
    n += 2;
  }
  return n ? sum / n : 0;
}

/** How far the trunk surface of `cand` is from that of `ref` (metres: mean and worst height). */
export function trunkDistance(ref: TreeParams, cand: TreeParams, sp: number, shape: number, opts: BuildOptions = {}): { mean: number; worst: number } {
  const A = ringsOf(ref, sp, shape, opts);
  const B = ringsOf(cand, sp, shape, opts);
  const samples: number[] = [];
  for (let i = 0; i < A.ys.length; i++) {
    samples.push(A.ys[i]!);
    if (i + 1 < A.ys.length) samples.push((A.ys[i]! + A.ys[i + 1]!) / 2);
  }
  let sum = 0;
  let worst = 0;
  let n = 0;
  for (const y of samples) {
    const a = sectionAt(A, y), b = sectionAt(B, y);
    if (!a || !b) continue;
    const d = (oneWay(a, b) + oneWay(b, a)) / 2;
    sum += d;
    worst = Math.max(worst, d);
    n++;
  }
  return { mean: n ? sum / n : 0, worst };
}

/** Largest distance (m) between a limb's curved centre line and the polyline of `rings` rings and a tip. */
export function limbDeviation(p: TreeParams, rings: number): number {
  const R = Math.max(1, Math.round(rings));
  const along: number[] = [];
  for (let j = 0; j < R; j++) along.push(0.14 + (j * 0.82) / R);
  along.push(1.0);
  // a typical limb: half the bend and curl the sliders allow, the middle of the rise range
  const side = (s: number) => (p.limbBend / 2) * Math.pow(s, 1.5) + (p.limbCurl / 2) * Math.sin(s * 2.8);
  const rise = (s: number) => (p.limbRiseMin + p.limbRiseRange / 2) * Math.pow(s, 1.8) - 0.15 * (1 - s);
  let worst = 0;
  for (let s = 0.14; s <= 1.0; s += 0.01) {
    let j = 0;
    while (j < along.length - 2 && s > along[j + 1]!) j++;
    const t = (s - along[j]!) / (along[j + 1]! - along[j]!);
    const cs = side(along[j]!) + (side(along[j + 1]!) - side(along[j]!)) * t;
    const cr = rise(along[j]!) + (rise(along[j + 1]!) - rise(along[j]!)) * t;
    worst = Math.max(worst, Math.hypot(side(s) - cs, rise(s) - cr));
  }
  return worst;
}

export interface LodOptions {
  /** Wanted triangles as a share of the tree at the original resolution (0.5 = half). */
  target: number;
  /** Settings this repo's Meshes.kt has (the others are left as they are). */
  allowed: ReadonlySet<ParamKey>;
  soilBottom?: boolean;
}

export interface LodResult {
  /** The settings to apply (all four of LOD_KEYS). */
  knobs: Record<LodKey, number>;
  params: TreeParams;
  /** Mean triangles per tree at the original resolution, and with the new settings (over all 16 shapes). */
  baseline: number;
  triangles: number;
  /** Distance from the original tree in centimetres: mean over the trunk, worst height, limb centre line. */
  meanCm: number;
  worstCm: number;
  limbCm: number;
  /** True when the target could not be reached with the settings available. */
  short: boolean;
}

const range = (from: number, to: number) => {
  const out: number[] = [];
  for (let v = from; v >= to; v--) out.push(v);
  return out;
};

/**
 * The settings that bring the trees of this species to `target` of their triangles with the least change in look.
 * `original` holds the resolution settings of the untouched repo, `current` everything else the person has tuned.
 */
export function reduceTree(original: TreeParams, current: TreeParams, sp: number, o: LodOptions): LodResult {
  const opts: BuildOptions = { soilBottom: o.soilBottom ?? false };
  // the tree the person has now, at the original resolution: what the triangle target and the look are measured on
  const ref: TreeParams = { ...current };
  for (const k of LOD_KEYS) if (o.allowed.has(k)) ref[k] = original[k];
  const limit = Math.max(0.05, Math.min(1, o.target));
  const baseCount = avgTriangles(ref, sp, opts, COUNT_SHAPES);

  const mults = o.allowed.has("radialMult") ? range(ref.radialMult, 2) : [ref.radialMult];
  const mins = o.allowed.has("radialMin") ? [...new Set([ref.radialMin, 10, 8, 6].filter((v) => v <= ref.radialMin))] : [ref.radialMin];
  const rows = o.allowed.has("flareRows") ? range(ref.flareRows, 3) : [ref.flareRows];
  const rings = o.allowed.has("limbRings") ? range(ref.limbRings, 1) : [ref.limbRings];

  const cands: { p: TreeParams; t: number }[] = [];
  for (const radialMult of mults)
    for (const radialMin of mins)
      for (const flareRows of rows)
        for (const limbRings of rings) {
          const p = { ...ref, radialMult, radialMin, flareRows, limbRings };
          cands.push({ p, t: avgTriangles(p, sp, opts, COUNT_SHAPES) });
        }
  const feasible = cands.filter((c) => c.t <= baseCount * limit).sort((a, b) => b.t - a.t);
  const pool = feasible.length ? feasible.slice(0, 40) : [cands.sort((a, b) => a.t - b.t)[0]!];
  const limbBase = limbDeviation(ref, ref.limbRings);

  let best: { p: TreeParams; score: number; mean: number; worst: number; limb: number } | null = null;
  for (const c of pool) {
    let mean = 0, worst = 0;
    for (const sh of ERROR_SHAPES) {
      const d = trunkDistance(ref, c.p, sp, sh, opts);
      mean += d.mean / ERROR_SHAPES.length;
      worst = Math.max(worst, d.worst);
    }
    const limb = Math.max(0, limbDeviation(c.p, c.p.limbRings) - limbBase);
    const score = (0.7 * mean + 0.3 * worst) * 100 + 0.5 * limb * 100;
    if (!best || score < best.score) best = { p: c.p, score, mean, worst, limb };
  }
  const chosen = best!;
  const triangles = avgTriangles(chosen.p, sp, opts);
  const baseline = avgTriangles(ref, sp, opts);
  const knobs = Object.fromEntries(LOD_KEYS.map((k) => [k, chosen.p[k]])) as Record<LodKey, number>;
  return { knobs, params: chosen.p, baseline, triangles, meanCm: chosen.mean * 100, worstCm: chosen.worst * 100, limbCm: chosen.limb * 100, short: triangles > baseline * limit * 1.02 };
}
