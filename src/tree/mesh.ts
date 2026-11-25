/**
 * TypeScript mirror of the generated Kotlin `Geo.treeBody` (see kotlin.ts). Every formula, salt and
 * order of operations matches the Kotlin source so the preview is the mesh the game builds.
 * Positions are rounded to Float32 where Kotlin stores them in FloatArray.
 */
import { hash } from "./hash";
import type { TreeParams } from "./params";

export const TREE_GROUND = 1.1;
const PI = Math.PI;
const f32 = Math.fround;

export interface TreeMesh {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  idx: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  topY: number;
  ringSides: number;
  /** Rings of the trunk grid (the first rows × (ringSides + 1) vertices are the grid, bottom to top). */
  rows: number;
}

interface MeshData {
  pos: Float32Array;
  uv: Float32Array;
  idx: Uint32Array;
  nor: Float32Array;
}

const wrapAngle = (x: number) => ((((x + PI) % (2 * PI)) + 2 * PI) % (2 * PI)) - PI;

class SurfaceBuilder {
  pos: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  n = 0;
  vertex(x: number, y: number, z: number, u: number, v: number): number {
    this.pos.push(f32(x), f32(y), f32(z));
    this.uv.push(f32(u), f32(v));
    return this.n++;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  x(i: number) {
    return this.pos[i * 3] as number;
  }
  y(i: number) {
    return this.pos[i * 3 + 1] as number;
  }
  z(i: number) {
    return this.pos[i * 3 + 2] as number;
  }
}

class TreeShape {
  readonly r: (salt: number) => number;
  readonly k: number;
  private ph: number[];
  private swayA: number;
  private swayB: number;
  private swayZ: number;
  private swayC: number;
  private swell: number;
  private burlA: number;
  private burlY: number;
  private burlH: number;
  private taper: number;
  readonly topY: number;
  private rootPhi: number[];
  private rootReach: number[];
  private rootHeight: number[];
  private rootSteep: number[];
  private rootSigma: number;
  private rootAngleTan: number;

  constructor(
    private p: TreeParams,
    sp: number,
    shape: number,
    n: number,
  ) {
    const seed = sp * 16 + shape;
    const r = (salt: number) => hash(seed, 0, salt);
    this.r = r;
    const k = p.rootCount;
    this.k = k;
    this.ph = [0, 1, 2, 3].map((i) => r(300 + i) * 2 * PI);
    this.swayA = (0.03 + r(304) * 0.09) * p.sway;
    this.swayB = (0.02 + r(305) * 0.05) * p.sway;
    this.swayZ = (0.03 + r(306) * 0.08) * p.sway;
    this.swayC = 0.03 * p.sway;
    this.swell = (0.04 + r(307) * 0.07) * p.swell;
    this.burlA = r(308) * 2 * PI;
    this.burlY = 5 + r(309) * 10;
    this.burlH = (0.1 + r(310) * 0.15) * p.burl;
    this.taper = 0.9 + r(311) * 0.25;
    this.topY = p.height + r(312) * p.heightRand;
    const used: boolean[] = new Array(n).fill(false);
    this.rootPhi = [];
    for (let i = 0; i < k; i++) {
      let c = Math.round(((i + (r(210 + i) - 0.5) * p.rootSpread) * n) / k) % n;
      if (c < 0) c += n;
      while (used[c]) c = (c + 1) % n;
      used[c] = true;
      this.rootPhi.push((c / n) * 2 * PI);
    }
    this.rootReach = Array.from({ length: k }, (_, i) =>
      1.6 * p.rootLength * (p.rootLenMin + r(230 + i) * p.rootLenRand) * (r(250 + i) < p.rootStubChance ? p.rootStubScale : 1.0),
    );
    this.rootHeight = Array.from({ length: k }, (_, i) => Math.max(0.05, p.rootHMin + r(260 + i) * p.rootHRand));
    this.rootSteep = Array.from({ length: k }, (_, i) => p.rootSteepMin + r(270 + i) * p.rootSteepRand);
    this.rootSigma = ((2 * PI) / n) * p.rootWidth;
    this.rootAngleTan = Math.sin((p.rootAngle * PI) / 180.0) / Math.cos((p.rootAngle * PI) / 180.0);
  }

  cx(y: number) {
    return Math.sin(y * 0.3 + this.ph[0]!) * this.swayA + Math.sin(y * 0.71 + this.ph[1]!) * this.swayB;
  }
  cz(y: number) {
    return Math.cos(y * 0.26 + this.ph[2]!) * this.swayZ + Math.sin(y * 0.5 + this.ph[3]!) * this.swayC;
  }

  radius(a: number, y: number): number {
    const p = this.p;
    const r0 = (p.trunkRadius + p.trunkTaper * (1.0 - y / 22.0)) * this.taper;
    let sw = 1.0 + Math.sin(a * 3 + y * 0.9 + this.ph[0]!) * this.swell + Math.sin(a * 2 + y * 0.23 + this.ph[1]!) * this.swell;
    const bd = wrapAngle(a - this.burlA);
    sw += this.burlH * Math.exp(-(bd / 0.5) * (bd / 0.5) - ((y - this.burlY) / 1.6) * ((y - this.burlY) / 1.6));
    const fluting = (Math.sin(a * 16.0 + y * 0.3) * 0.45 + Math.sin(a * 8.0 - y * 0.15) * 0.55) * p.fluting;
    const foot = Math.min(1.0, Math.max(0.0, 1.0 - (y - TREE_GROUND) / p.footHeight));
    const trunk = (r0 * sw + fluting) * (1.0 + foot * foot * p.footFlare) * p.trunkScale;
    let ext = 0.0;
    for (let i = 0; i < this.k; i++) {
      const d = wrapAngle(a - this.rootPhi[i]!);
      const h = this.rootHeight[i]!;
      const f = Math.max(
        0.0,
        y >= TREE_GROUND
          ? y < TREE_GROUND + h
            ? Math.pow(1.0 - (y - TREE_GROUND) / h, this.rootSteep[i]!)
            : 0.0
          : 1.0 + (TREE_GROUND - y) * p.rootDepth,
      );
      let crest = this.rootReach[i]! * f;
      if (p.rootAngle < 90.0 && f > 0.0 && y > TREE_GROUND) {
        // Joint angle: near the joint the crest may leave the trunk at most rootAngle off vertical.
        const t = (y - TREE_GROUND) / h;
        const cap = (this.rootAngleTan * h * (1.0 - t)) / (t * t);
        const q = crest / cap;
        crest /= Math.pow(1.0 + q * q * q, 1.0 / 3.0);
      }
      ext = Math.max(ext, crest * Math.exp(-(d / this.rootSigma) * (d / this.rootSigma)));
    }
    return trunk + ext;
  }
}

function rotateOnto(v: number[], a: number[], b: number[]): number[] {
  let ax = a[1]! * b[2]! - a[2]! * b[1]!;
  let ay = a[2]! * b[0]! - a[0]! * b[2]!;
  let az = a[0]! * b[1]! - a[1]! * b[0]!;
  const s = Math.sqrt(ax * ax + ay * ay + az * az);
  if (s < 1e-6) return v;
  ax /= s;
  ay /= s;
  az /= s;
  const c = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const d = ax * v[0]! + ay * v[1]! + az * v[2]!;
  return [
    v[0]! * c + (ay * v[2]! - az * v[1]!) * s + ax * d * (1 - c),
    v[1]! * c + (az * v[0]! - ax * v[2]!) * s + ay * d * (1 - c),
    v[2]! * c + (ax * v[1]! - ay * v[0]!) * s + az * d * (1 - c),
  ];
}

/** Area-weighted normals (float math like Kotlin's FloatArray); optional seam weld for a ring grid. */
function computeNormals(pos: Float32Array, idx: Uint32Array, weldRows = 0, radial = 0): Float32Array {
  const nor = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]!, b = idx[i + 1]!, c = idx[i + 2]!;
    const ux = pos[b * 3]! - pos[a * 3]!, uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!, uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const vx = pos[c * 3]! - pos[a * 3]!, vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!, vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      nor[k * 3] = nor[k * 3]! + nx;
      nor[k * 3 + 1] = nor[k * 3 + 1]! + ny;
      nor[k * 3 + 2] = nor[k * 3 + 2]! + nz;
    }
  }
  for (let r = 0; r < weldRows; r++) {
    const first = r * (radial + 1), last = first + radial;
    for (let k = 0; k < 3; k++) {
      const s = nor[first * 3 + k]! + nor[last * 3 + k]!;
      nor[first * 3 + k] = s;
      nor[last * 3 + k] = s;
    }
  }
  normalize(nor);
  return nor;
}

function normalize(nor: Float32Array) {
  for (let v = 0; v < nor.length / 3; v++) {
    const l = Math.sqrt(nor[v * 3]! ** 2 + nor[v * 3 + 1]! ** 2 + nor[v * 3 + 2]! ** 2);
    if (l > 1e-8) {
      nor[v * 3] = nor[v * 3]! / l;
      nor[v * 3 + 1] = nor[v * 3 + 1]! / l;
      nor[v * 3 + 2] = nor[v * 3 + 2]! / l;
    }
  }
}

/** Port of Geo.finishTube: outward winding check and seam-welded normals. */
function finishTube(pos: Float32Array, uv: Float32Array, rows: number, radial: number, centers: Float32Array): MeshData {
  const idx = new Uint32Array((rows - 1) * radial * 6);
  let k = 0;
  for (let iy = 0; iy < rows - 1; iy++)
    for (let ix = 0; ix < radial; ix++) {
      const a = iy * (radial + 1) + ix, b = (iy + 1) * (radial + 1) + ix;
      const c = (iy + 1) * (radial + 1) + ix + 1, d = iy * (radial + 1) + ix + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = d;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  let nor = computeNormals(pos, idx);
  let outward = 0;
  for (let row = 0; row < rows; row++)
    for (let ix = 0; ix < radial; ix++) {
      const v = row * (radial + 1) + ix;
      outward +=
        nor[v * 3]! * (pos[v * 3]! - centers[row * 3]!) +
        nor[v * 3 + 1]! * (pos[v * 3 + 1]! - centers[row * 3 + 1]!) +
        nor[v * 3 + 2]! * (pos[v * 3 + 2]! - centers[row * 3 + 2]!);
    }
  if (outward < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1]!;
      idx[i + 1] = idx[i + 2]!;
      idx[i + 2] = t;
    }
    nor = computeNormals(pos, idx);
  }
  for (let row = 0; row < rows; row++) {
    const a = row * (radial + 1), b = a + radial;
    let nx = nor[a * 3]! + nor[b * 3]!, ny = nor[a * 3 + 1]! + nor[b * 3 + 1]!, nz = nor[a * 3 + 2]! + nor[b * 3 + 2]!;
    const l = Math.max(Math.sqrt(nx * nx + ny * ny + nz * nz), 1e-8);
    nx /= l; ny /= l; nz /= l;
    nor[a * 3] = nx; nor[a * 3 + 1] = ny; nor[a * 3 + 2] = nz;
    nor[b * 3] = nx; nor[b * 3 + 1] = ny; nor[b * 3 + 2] = nz;
  }
  return { pos, uv, idx, nor };
}

/** Port of Geo.sweptTube (tapered tube along a centre line). */
function sweptTube(points: number[][], radii: number[], radial: number): MeshData {
  const rows = points.length;
  const pos = new Float32Array(rows * (radial + 1) * 3);
  const uv = new Float32Array(rows * (radial + 1) * 2);
  const centers = new Float32Array(rows * 3);
  let n = 0;
  for (let row = 0; row < rows; row++) {
    const p = points[row]!;
    const before = points[row === 0 ? 0 : row - 1]!;
    const after = points[row === rows - 1 ? rows - 1 : row + 1]!;
    let tx = f32(after[0]! - before[0]!), ty = f32(after[1]! - before[1]!), tz = f32(after[2]! - before[2]!);
    const tl = Math.max(Math.sqrt(tx * tx + ty * ty + tz * tz), 1e-6);
    tx /= tl; ty /= tl; tz /= tl;
    const refX = 0, refY = Math.abs(ty) > 0.88 ? 0 : 1, refZ = Math.abs(ty) > 0.88 ? 1 : 0;
    let ux = ty * refZ - tz * refY, uy = tz * refX - tx * refZ, uz = tx * refY - ty * refX;
    const ul = Math.max(Math.sqrt(ux * ux + uy * uy + uz * uz), 1e-6);
    ux /= ul; uy /= ul; uz /= ul;
    const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
    centers[row * 3] = p[0]!; centers[row * 3 + 1] = p[1]!; centers[row * 3 + 2] = p[2]!;
    for (let side = 0; side <= radial; side++) {
      const a = (side / radial) * 2 * PI;
      const wobble = 1 + Math.sin(a * 3 + row * 0.73) * 0.035 + Math.sin(a * 5 - row * 0.41) * 0.018;
      const r = radii[row]! * wobble;
      const ca = Math.cos(a), sa = Math.sin(a);
      pos[n * 3] = p[0]! + (ux * ca + vx * sa) * r;
      pos[n * 3 + 1] = p[1]! + (uy * ca + vy * sa) * r;
      pos[n * 3 + 2] = p[2]! + (uz * ca + vz * sa) * r;
      uv[n * 2] = side / radial;
      uv[n * 2 + 1] = row / (rows - 1);
      n++;
    }
  }
  return finishTube(pos, uv, rows, radial, centers);
}

/** three.js-style Euler XYZ rotation, column-major 4x4 (what Mat.compose builds with unit scale). */
function eulerXYZ(rx: number, ry: number, rz: number): number[] {
  const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [c * e, af + be * d, bf - ae * d, 0, -c * f, ae - bf * d, be + af * d, 0, d, -b * c, a * c, 0, 0, 0, 0, 1];
}

function mergeParts(parts: MeshData[], m: number[]): MeshData {
  const vcount = parts.reduce((s, p) => s + p.pos.length / 3, 0);
  const icount = parts.reduce((s, p) => s + p.idx.length, 0);
  const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), uv = new Float32Array(vcount * 2);
  const idx = new Uint32Array(icount);
  let vb = 0, ib = 0;
  for (const d of parts) {
    const vc = d.pos.length / 3;
    for (let v = 0; v < vc; v++) {
      const x = d.pos[v * 3]!, y = d.pos[v * 3 + 1]!, z = d.pos[v * 3 + 2]!;
      const o = (vb + v) * 3;
      pos[o] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      pos[o + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      pos[o + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      uv[(vb + v) * 2] = d.uv[v * 2]!;
      uv[(vb + v) * 2 + 1] = d.uv[v * 2 + 1]!;
      const nx = d.nor[v * 3]!, ny = d.nor[v * 3 + 1]!, nz = d.nor[v * 3 + 2]!;
      let tx = m[0]! * nx + m[4]! * ny + m[8]! * nz, ty = m[1]! * nx + m[5]! * ny + m[9]! * nz, tz = m[2]! * nx + m[6]! * ny + m[10]! * nz;
      const l = Math.max(Math.sqrt(tx * tx + ty * ty + tz * tz), 1e-8);
      tx /= l; ty /= l; tz /= l;
      nor[o] = tx; nor[o + 1] = ty; nor[o + 2] = tz;
    }
    for (let j = 0; j < d.idx.length; j++) idx[ib + j] = d.idx[j]! + vb;
    vb += vc;
    ib += d.idx.length;
  }
  return { pos, uv, idx, nor };
}

export interface BuildOptions {
  lifelike?: boolean;
  shadow?: boolean;
  /**
   * Newer game repos start the body exactly at the soil (`val bottom = TREE_GROUND`) and stretch the flare rows from
   * there; the cut depth is then unused. Detected from the loaded Meshes.kt.
   */
  soilBottom?: boolean;
}

/** The tree body (trunk, root flare, limbs, optional forks) as one mesh. */
export function buildTree(p: TreeParams, sp: number, shape: number, opts: BuildOptions = {}): TreeMesh {
  const lifelike = opts.lifelike ?? true;
  const shadow = opts.shadow ?? false;
  const ridges = p.rootCount;
  const n = shadow ? 2 * ridges : lifelike ? Math.max(p.radialMin, p.radialMult * ridges) : Math.max(p.radialMin, 2 * ridges);
  const ts = new TreeShape(p, sp, shape, n);
  const loopW = lifelike ? 4 : 3;

  const limbCount = shadow ? 0 : p.limbCount;
  const per = p.limbsPerLevel;
  const limbY: number[] = [];
  const limbLen: number[] = [];
  for (let b = 0; b < limbCount; b++) {
    limbY.push(p.limbStart + b * p.limbSpacing + ts.r(60 + b) * p.limbJitter);
    const raw = p.limbLenBase + b * p.limbLenSlope + ts.r(95 + b) * p.limbLenRand;
    limbLen.push(Math.max(raw, 1.0) * p.limbLength);
  }
  const groupFrom: number[] = [];
  const groupSize: number[] = [];
  let nextLimb = 0;
  while (nextLimb < limbCount) {
    const want = ts.r(320 + groupFrom.length) > 0.25 ? per : Math.max(1, per - 1);
    const cnt = Math.min(want, limbCount - nextLimb);
    groupFrom.push(nextLimb);
    groupSize.push(cnt);
    nextLimb += cnt;
  }
  const levels = groupFrom.length;

  // The body ends in a flat cut cutDepth below the soil (the default 0.6 keeps the reference bottom row at 0.5).
  const bottom = opts.soilBottom ? TREE_GROUND : 0.5 + (0.6 - p.cutDepth);
  const ys: number[] = [bottom];
  if (shadow) {
    for (const y of [0.5, 1.1, 1.8, 2.8, 4.2, 7.5, 14.0]) if (y > bottom + 0.05) ys.push(y);
    ys.push(ts.topY);
  } else {
    const flareTop = Math.max(p.flareTop, TREE_GROUND + p.rootHMin + p.rootHRand + 0.4);
    const flareRows = Math.min(12, Math.max(3, Math.round(p.flareRows)));
    const keep = new Array<boolean>(12).fill(false);
    for (let i = 0; i < flareRows; i++) keep[Math.floor((i * 22 + (flareRows - 1)) / (2 * (flareRows - 1)))] = true;
    for (const [fi, y] of [0.5, 0.8, 1.1, 1.25, 1.45, 1.7, 2.05, 2.45, 2.95, 3.55, 4.2, 5.0].entries()) {
      if (!keep[fi]) continue;
      const v = opts.soilBottom ? TREE_GROUND + ((y - 0.5) * (flareTop - TREE_GROUND)) / 4.5 : 0.5 + ((y - 0.5) * (flareTop - 0.5)) / 4.5;
      if (v > bottom + 0.05) ys.push(v);
    }
  }
  const last = () => ys[ys.length - 1]!;
  const gap = p.limbHole;
  const levelRow: number[] = [];
  let prevTop = last();
  for (let l = 0; l < levels; l++) {
    let y = 0.0;
    for (let b = groupFrom[l]!; b < groupFrom[l]! + groupSize[l]!; b++) y += limbY[b]!;
    y = y / groupSize[l]! + (ts.r(330 + l) - 0.5) * p.levelJitter;
    y = Math.max(y, prevTop + 2 * gap + 0.5 + (l === 0 ? 1.0 : 0.0));
    if (y - gap - last() > 3.2) ys.push((last() + y - gap) / 2);
    levelRow.push(ys.length);
    ys.push(y - gap, y + gap);
    prevTop = y + gap;
  }
  if (!shadow) ys.push(Math.max(ts.topY, last() + 3.0));
  ys.push(last() + 0.7);
  const rows = ys.length;
  const stride = n + 1;

  const sb = new SurfaceBuilder();
  for (let r = 0; r < rows; r++) {
    const y = ys[r]!;
    const wx = ts.cx(y), wz = ts.cz(y);
    for (let c = 0; c <= n; c++) {
      const th = (c / n) * 2 * PI;
      const rr = ts.radius(th, y) * (r === rows - 1 ? 0.3 : 1.0);
      sb.vertex(Math.sin(th) * rr + wx, y, Math.cos(th) * rr + wz, c / n, y / 22.0);
    }
  }
  const yTop = ys[rows - 1]!;
  const cap = sb.vertex(ts.cx(yTop), yTop + 0.25, ts.cz(yTop), 0.5, yTop / 22.0);
  for (let c = 0; c < n; c++) sb.tri((rows - 1) * stride + c, (rows - 1) * stride + c + 1, cap);

  const forks: MeshData[] = [];
  const hole: boolean[] = new Array((rows - 1) * n).fill(false);
  const R = Math.max(1, p.limbRings);
  for (let l = 0; l < levels; l++) {
    const count = groupSize[l]!;
    const span = Math.trunc(n / count);
    const we = Math.max(1, Math.min(loopW, span - 1));
    const r0 = levelRow[l]!;
    for (let j = 0; j < count; j++) {
      const b = groupFrom[l]! + j;
      const c0 = Math.min(j * span + Math.trunc(ts.r(380 + b) * (span - we)), n - we);
      for (let c = c0; c < c0 + we; c++) hole[r0 * n + c] = true;
      const kb = 2 * (we + 1);
      const loop: number[] = new Array(kb);
      for (let i = 0; i <= we; i++) {
        loop[i] = r0 * stride + c0 + i;
        loop[we + 1 + i] = (r0 + 1) * stride + c0 + we - i;
      }
      let px = 0, py = 0, pz = 0;
      for (const v of loop) { px += sb.x(v); py += sb.y(v); pz += sb.z(v); }
      px /= kb; py /= kb; pz /= kb;
      let nx = px - ts.cx(py), nz = pz - ts.cz(py);
      const nl = Math.max(Math.sqrt(nx * nx + nz * nz), 1e-9);
      nx /= nl; nz /= nl;
      const n0 = [nx, 0.0, nz];
      const sx = -nz, sz = nx;
      const len = limbLen[b]! * (0.9 + ts.r(340 + b) * 0.8);
      const rise = p.limbRiseMin + ts.r(350 + b) * p.limbRiseRange;
      const bend = (ts.r(360 + b) - 0.5) * p.limbBend;
      const curl = (ts.r(365 + b) - 0.5) * p.limbCurl;
      const thick = (0.55 + ts.r(370 + b) * 0.4) * p.limbThick;
      // Centre line: R rings and a tip. It bends sideways, curls and rises or droops.
      const along: number[] = [];
      for (let j2 = 0; j2 < R; j2++) along.push(0.14 + (j2 * 0.82) / R);
      along.push(1.0);
      const lineAt = (s: number) => {
        const side = bend * Math.pow(s, 1.5) + curl * Math.sin(s * 2.8);
        return [px + nx * (s * len) + sx * side, py + rise * Math.pow(s, 1.8) - 0.15 * (1.0 - s), pz + nz * (s * len) + sz * side];
      };
      const cxs: number[] = [], cys: number[] = [], czs: number[] = [];
      for (let j2 = 0; j2 <= R; j2++) {
        const q = lineAt(along[j2]!);
        cxs.push(q[0]!); cys.push(q[1]!); czs.push(q[2]!);
      }
      const tx: number[] = [], ty: number[] = [], tz: number[] = [];
      for (let j2 = 0; j2 <= R; j2++) {
        const a = Math.min(j2 + 1, R), z = Math.max(j2 - 1, 0);
        let dx = cxs[a]! - cxs[z]!, dy = cys[a]! - cys[z]!, dz = czs[a]! - czs[z]!;
        const dl = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1e-9);
        dx /= dl; dy /= dl; dz /= dl;
        tx.push(dx); ty.push(dy); tz.push(dz);
      }
      let sMin = 1e9, sMax = -1e9, yMin = 1e9, yMax = -1e9;
      let holeR = 0;
      for (const v of loop) {
        const sd = (sb.x(v) - px) * sx + (sb.z(v) - pz) * sz;
        sMin = Math.min(sMin, sd); sMax = Math.max(sMax, sd);
        yMin = Math.min(yMin, sb.y(v)); yMax = Math.max(yMax, sb.y(v));
        holeR += Math.sqrt((sb.x(v) - px) ** 2 + (sb.y(v) - py) ** 2 + (sb.z(v) - pz) ** 2);
      }
      holeR /= kb;
      const round = Math.min(1.0, ((sMax - sMin) * 1.15) / Math.max(1e-6, yMax - yMin));
      const ring: number[][] = [];
      let meanU = 0;
      for (const v of loop) meanU += sb.uv[v * 2]!;
      meanU /= kb;
      for (let j2 = 0; j2 < R; j2++) {
        const vScale = j2 === 0 ? (1.0 + round) / 2 : round;
        const ringScale = (0.8 - (0.76 * j2) / R) * thick;
        const rr: number[] = new Array(kb);
        for (let i = 0; i < kb; i++) {
          const lv = loop[i]!;
          const rv = rotateOnto(
            [(sb.x(lv) - px) * ringScale, (sb.y(lv) - py) * vScale * ringScale, (sb.z(lv) - pz) * ringScale],
            n0,
            [tx[j2]!, ty[j2]!, tz[j2]!],
          );
          const u = sb.uv[lv * 2]!, vv = sb.uv[lv * 2 + 1]!;
          rr[i] = sb.vertex(cxs[j2]! + rv[0]!, cys[j2]! + rv[1]!, czs[j2]! + rv[2]!, u, vv + (along[j2]! * len) / 22.0);
        }
        ring.push(rr);
      }
      const tip = sb.vertex(cxs[R]!, cys[R]!, czs[R]!, meanU, sb.uv[loop[0]! * 2 + 1]! + len / 22.0);
      const rings = [loop, ...ring];
      for (let j2 = 0; j2 < R; j2++) {
        const lower = rings[j2]!, upper = rings[j2 + 1]!;
        for (let i = 0; i < kb; i++) {
          const i2 = (i + 1) % kb;
          sb.tri(lower[i]!, lower[i2]!, upper[i]!);
          sb.tri(lower[i2]!, upper[i2]!, upper[i]!);
        }
      }
      const lastRing = ring[R - 1]!;
      for (let i = 0; i < kb; i++) sb.tri(lastRing[i]!, lastRing[(i + 1) % kb]!, tip);

      // Forks: tapered tubes whose first ring sits on the limb's centre line (embedded in the limb).
      if (!shadow && p.forkCount > 0) {
        const limbRadiusAt = (s: number) => {
          if (s >= along[R - 1]!) {
            const sl = along[R - 1]!;
            return holeR * (0.8 - (0.76 * (R - 1)) / R) * thick * Math.max(0, (1 - s) / (1 - sl));
          }
          const j2 = Math.max(0, Math.min(R - 2, Math.floor(((s - 0.14) * R) / 0.82)));
          const sa = along[j2]!, sbb = along[j2 + 1]!;
          const t = Math.max(0, Math.min(1, (s - sa) / (sbb - sa)));
          const ra = 0.8 - (0.76 * j2) / R, rb = 0.8 - (0.76 * (j2 + 1)) / R;
          return holeR * (ra + (rb - ra) * t) * thick;
        };
        for (let f = 0; f < p.forkCount; f++) {
          const salt = 400 + b * 8 + f;
          const off = p.forkCount > 1 ? f / (p.forkCount - 1) - 0.5 : 0.0;
          const s = Math.min(0.92, Math.max(0.1, p.forkStart + off * p.forkSpread + (ts.r(salt) - 0.5) * 0.08));
          const base = lineAt(s);
          const ahead = lineAt(Math.min(1.0, s + 0.02));
          let dx = ahead[0]! - base[0]!, dy = ahead[1]! - base[1]!, dz = ahead[2]! - base[2]!;
          const dl = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1e-9);
          dx /= dl; dy /= dl; dz /= dl;
          let qx = -dz, qz = dx;
          const ql = Math.max(Math.sqrt(qx * qx + qz * qz), 1e-9);
          qx /= ql; qz /= ql;
          const sign = (f % 2 === 0 ? 1.0 : -1.0) * (ts.r(salt + 1) < 0.5 ? -1.0 : 1.0);
          let ex = dx + qx * p.forkAngle * sign, ey = dy + p.forkRise, ez = dz + qz * p.forkAngle * sign;
          const el = Math.max(Math.sqrt(ex * ex + ey * ey + ez * ez), 1e-9);
          ex /= el; ey /= el; ez /= el;
          const fl = p.forkLength * len * (1.0 - s * 0.5) * (0.8 + ts.r(salt + 2) * 0.4);
          const pts: number[][] = [];
          for (const k2 of [0.0, 0.3, 0.65, 1.0]) {
            pts.push([
              f32(base[0]! + ex * fl * k2 + dx * fl * 0.15 * k2 * k2),
              f32(base[1]! + ey * fl * k2 + dy * fl * 0.15 * k2 * k2),
              f32(base[2]! + ez * fl * k2 + dz * fl * 0.15 * k2 * k2),
            ]);
          }
          const fr = limbRadiusAt(s) * p.forkThick;
          forks.push(sweptTube(pts, [f32(fr), f32(fr * 0.72), f32(fr * 0.42), f32(0.012)], lifelike ? 8 : 5));
        }
      }
    }
  }

  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < n; c++) {
      if (hole[r * n + c]) continue;
      const a = r * stride + c, b = (r + 1) * stride + c;
      const c2 = (r + 1) * stride + c + 1, d = r * stride + c + 1;
      sb.tri(a, d, b);
      sb.tri(b, d, c2);
    }

  const sPos = new Float32Array(sb.pos);
  const sIdx = new Uint32Array(sb.idx);
  const surface: MeshData = { pos: sPos, uv: new Float32Array(sb.uv), idx: sIdx, nor: computeNormals(sPos, sIdx, rows, n) };
  const lean = p.lean * (0.4 + ts.r(313) * 1.8);
  const m = eulerXYZ(lean * (ts.r(314) * 2 - 1), 0.0, -lean * (ts.r(315) * 2 - 1));
  const parts: MeshData[] = [surface, ...forks];
  if (p.bottomCap > 0) {
    // Bottom cap: a flat fan over a copy of the lowest ring, facing down, so the body cannot be seen into from below.
    const cp = new Float32Array((n + 2) * 3), cu = new Float32Array((n + 2) * 2), ci = new Uint32Array(n * 3), cn = new Float32Array((n + 2) * 3);
    for (let c = 0; c <= n; c++) {
      cp[c * 3] = sPos[c * 3]!; cp[c * 3 + 1] = sPos[c * 3 + 1]!; cp[c * 3 + 2] = sPos[c * 3 + 2]!;
      cu[c * 2] = sb.uv[c * 2]!; cu[c * 2 + 1] = sb.uv[c * 2 + 1]!;
    }
    const y0 = ys[0]!;
    cp[(n + 1) * 3] = f32(ts.cx(y0)); cp[(n + 1) * 3 + 1] = f32(y0); cp[(n + 1) * 3 + 2] = f32(ts.cz(y0));
    cu[(n + 1) * 2] = f32(0.5); cu[(n + 1) * 2 + 1] = f32(y0 / 22.0);
    for (let c = 0; c < n; c++) {
      ci[c * 3] = c + 1; ci[c * 3 + 1] = c; ci[c * 3 + 2] = n + 1;
    }
    for (let v = 0; v < n + 2; v++) cn[v * 3 + 1] = -1;
    parts.push({ pos: cp, uv: cu, idx: ci, nor: cn });
  }
  const merged = mergeParts(parts, m);
  return {
    ...merged,
    vertexCount: merged.pos.length / 3,
    triangleCount: merged.idx.length / 3,
    topY: yTop,
    ringSides: n,
    rows,
  };
}

/** GLES short indices: the Kotlin mergeTreeParts refuses meshes above this. */
export const MAX_VERTICES = 65535;
