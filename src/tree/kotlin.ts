/**
 * Generates the "one-surface trees" section of Meshes.kt from the tuned parameters and splices it into the
 * reference Meshes.kt. The Kotlin below is the source of truth that mesh.ts mirrors line for line.
 */
import { PARAM_SPECS, SPECIES, type SpeciesParams } from "./params";

export const SECTION_START = "    // ---- one-surface trees ----";
export const SECTION_END = "    /** How far a crown lump bulges";

export function ktDouble(v: number): string {
  const s = String(Number(v.toFixed(6)));
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

export function kotlinArrays(species: SpeciesParams): string {
  const lines: string[] = [];
  for (const s of PARAM_SPECS) {
    const vals = species.map((p) => (s.int ? String(Math.round(p[s.key])) : ktDouble(p[s.key])));
    const fn = s.int ? "intArrayOf" : "doubleArrayOf";
    lines.push(`    private val ${s.kt} = ${fn}(${vals.join(", ")})`.padEnd(86) + ` // ${s.label}`);
  }
  return lines.join("\n");
}

export function kotlinTreeSection(species: SpeciesParams, stamp: string): string {
  return `${SECTION_START}
    // The trunk, its root flare and the limbs are ONE connected surface: a single grid of rings, in which each limb is
    // stitched into a hole of the trunk grid (the loop around the hole is shared with the limb's first ring). There are
    // no buried collars, no overlapping tubes and no normal seams between parts, and the normals are computed once.
    //
    // Finomhangolva a Tree Mesh Studio-ban (${stamp}). Minden érték fajonként: ${SPECIES.map((s) => `${s.id} = ${s.kt}`).join(", ")}.
    // A fa-paraméterek egy az egyben megegyeznek a 3D előnézetben látott beállításokkal (TreeTuning.json).

${kotlinArrays(species)}
    private val TREE_ROOT_W = doubleArrayOf(1.40, .85, 1.85, .80)          // (megtartva a régi kód kompatibilitásáért)
    private const val TREE_GROUND = 1.1                                    // soil level in body space (the instance sits 1.1 m low)

    /** Growable vertex and index lists for a hand-built surface. */
    private class SurfaceBuilder {
        var pos = FloatArray(1536)
        var uv = FloatArray(1024)
        var n = 0
        var idx = ShortArray(2048)
        var ni = 0
        fun vertex(x: Double, y: Double, z: Double, u: Double, v: Double): Int {
            if (n * 3 + 3 > pos.size) { pos = pos.copyOf(pos.size * 2); uv = uv.copyOf(uv.size * 2) }
            pos[n * 3] = x.toFloat(); pos[n * 3 + 1] = y.toFloat(); pos[n * 3 + 2] = z.toFloat()
            uv[n * 2] = u.toFloat(); uv[n * 2 + 1] = v.toFloat()
            return n++
        }
        fun tri(a: Int, b: Int, c: Int) {
            if (ni + 3 > idx.size) idx = idx.copyOf(idx.size * 2)
            idx[ni++] = a.toShort(); idx[ni++] = b.toShort(); idx[ni++] = c.toShort()
        }
        fun x(i: Int) = pos[i * 3].toDouble()
        fun y(i: Int) = pos[i * 3 + 1].toDouble()
        fun z(i: Int) = pos[i * 3 + 2].toDouble()
    }

    private fun wrapAngle(x: Double) = (((x + PI) % (2 * PI)) + 2 * PI) % (2 * PI) - PI

    /**
     * Everything that makes one tree body different from the next: the stem's sway and taper, the bark's swell and a burl,
     * and for every root its place, reach, height, steepness and width. Drawn from a hash of (species, shape), so each of
     * the shapes of a species is a different tree, always the same one for the same pair.
     */
    private class TreeShape(val sp: Int, shape: Int, n: Int) {
        private val seed = sp * 16 + shape
        fun r(salt: Int) = hash(seed, 0, salt)
        val k = TREE_RIDGES[sp]
        private val ph = DoubleArray(4) { r(300 + it) * 2 * PI }
        private val swayA = (.03 + r(304) * .09) * TREE_SWAY_AMT[sp]
        private val swayB = (.02 + r(305) * .05) * TREE_SWAY_AMT[sp]
        private val swayZ = (.03 + r(306) * .08) * TREE_SWAY_AMT[sp]
        private val swayC = .03 * TREE_SWAY_AMT[sp]
        private val swell = (.04 + r(307) * .07) * TREE_SWELL[sp]
        private val burlA = r(308) * 2 * PI
        private val burlY = 5 + r(309) * 10
        private val burlH = (.10 + r(310) * .15) * TREE_BURL[sp]
        private val taper = .9 + r(311) * .25
        val topY = TREE_HEIGHT[sp] + r(312) * TREE_HEIGHT_RAND[sp]
        // Roots are thin fins: each one sits on exactly one column of the ring grid (so it is a sharp ridge, not a blob).
        private val rootPhi = DoubleArray(k)
        init {
            val used = BooleanArray(n)
            for (i in 0 until k) {
                var c = (Math.round((i + (r(210 + i) - .5) * TREE_ROOT_SPREAD[sp]) * n / k) % n).toInt()
                if (c < 0) c += n
                while (used[c]) c = (c + 1) % n
                used[c] = true
                rootPhi[i] = c.toDouble() / n * 2 * PI
            }
        }
        private val rootReach = DoubleArray(k) {
            1.6 * TREE_ROOT_LEN[sp] * (TREE_ROOT_LEN_MIN[sp] + r(230 + it) * TREE_ROOT_LEN_RAND[sp]) *
                (if (r(250 + it) < TREE_ROOT_STUB[sp]) TREE_ROOT_STUB_SCALE[sp] else 1.0)
        }
        // How high each buttress ridge climbs the trunk, and how concave (peaked) its profile is.
        private val rootHeight = DoubleArray(k) { maxOf(.05, TREE_ROOT_H[sp] + r(260 + it) * TREE_ROOT_H_RAND[sp]) }
        private val rootSteep = DoubleArray(k) { TREE_ROOT_STEEP[sp] + r(270 + it) * TREE_ROOT_STEEP_RAND[sp] }
        private val rootSigma = (2 * PI / n) * TREE_ROOT_SIGMA[sp]
        private val rootAngleTan = sin(TREE_ROOT_ANGLE[sp] * PI / 180.0) / cos(TREE_ROOT_ANGLE[sp] * PI / 180.0)

        fun cx(y: Double) = sin(y * .3 + ph[0]) * swayA + sin(y * .71 + ph[1]) * swayB
        fun cz(y: Double) = cos(y * .26 + ph[2]) * swayZ + sin(y * .5 + ph[3]) * swayC

        /** Radius of the trunk surface at angle [a] and height [y]: bark swell, a burl, fluting, the foot flare and the root fins. */
        fun radius(a: Double, y: Double): Double {
            val r0 = (TREE_TRUNK_RADIUS[sp] + TREE_TRUNK_TAPER[sp] * (1.0 - y / 22.0)) * taper
            var sw = 1.0 + sin(a * 3 + y * .9 + ph[0]) * swell + sin(a * 2 + y * .23 + ph[1]) * swell
            val bd = wrapAngle(a - burlA)
            sw += burlH * exp(-(bd / .5) * (bd / .5) - ((y - burlY) / 1.6) * ((y - burlY) / 1.6))
            // Longitudinal bark fluting.
            val fluting = (sin(a * 16.0 + y * .3) * .45 + sin(a * 8.0 - y * .15) * .55) * TREE_FLUTE[sp]
            val foot = minOf(1.0, maxOf(0.0, 1.0 - (y - TREE_GROUND) / TREE_FOOT_H[sp]))
            val trunk = (r0 * sw + fluting) * (1.0 + foot * foot * TREE_FOOT_FLARE[sp]) * TREE_TRUNK_SCALE[sp]
            var ext = 0.0
            for (i in 0 until k) {
                val d = wrapAngle(a - rootPhi[i])
                // How far this root still reaches at height y: its crest falls from rootHeight above the soil to the soil.
                val f = maxOf(0.0, if (y >= TREE_GROUND) {
                    if (y < TREE_GROUND + rootHeight[i]) (1.0 - (y - TREE_GROUND) / rootHeight[i]).pow(rootSteep[i]) else 0.0
                } else 1.0 + (TREE_GROUND - y) * TREE_ROOT_DEPTH[sp])
                var crest = rootReach[i] * f
                if (TREE_ROOT_ANGLE[sp] < 90.0 && f > 0.0 && y > TREE_GROUND) {
                    // Joint angle: near the joint the crest may leave the trunk at most TREE_ROOT_ANGLE off vertical
                    // (a soft minimum with a cone that opens from the joint), so it never meets the trunk like a pipe.
                    val t = (y - TREE_GROUND) / rootHeight[i]
                    val cap = rootAngleTan * rootHeight[i] * (1.0 - t) / (t * t)
                    val q = crest / cap
                    crest /= (1.0 + q * q * q).pow(1.0 / 3.0)
                }
                ext = maxOf(ext, crest * exp(-(d / rootSigma) * (d / rootSigma)))
            }
            return trunk + ext
        }
    }

    /** Minimal rotation that takes unit vector [a] onto unit vector [b], applied to [v]. */
    private fun rotateOnto(v: DoubleArray, a: DoubleArray, b: DoubleArray): DoubleArray {
        var ax = a[1] * b[2] - a[2] * b[1]; var ay = a[2] * b[0] - a[0] * b[2]; var az = a[0] * b[1] - a[1] * b[0]
        val s = sqrt(ax * ax + ay * ay + az * az)
        if (s < 1e-6) return v
        ax /= s; ay /= s; az /= s
        val c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
        val d = ax * v[0] + ay * v[1] + az * v[2]
        return doubleArrayOf(
            v[0] * c + (ay * v[2] - az * v[1]) * s + ax * d * (1 - c),
            v[1] * c + (az * v[0] - ax * v[2]) * s + ay * d * (1 - c),
            v[2] * c + (ax * v[1] - ay * v[0]) * s + az * d * (1 - c),
        )
    }

    /** Area-weighted vertex normals, computed once. The seam column of every ring (first and last vertex) is welded. */
    private fun gridNormals(m: MeshData, rows: Int, radial: Int) {
        val nor = FloatArray(m.pos.size)
        var i = 0
        while (i < m.idx.size) {
            val a = m.idx[i].toInt() and 0xFFFF; val b = m.idx[i + 1].toInt() and 0xFFFF; val c = m.idx[i + 2].toInt() and 0xFFFF
            val ux = m.pos[b * 3] - m.pos[a * 3]; val uy = m.pos[b * 3 + 1] - m.pos[a * 3 + 1]; val uz = m.pos[b * 3 + 2] - m.pos[a * 3 + 2]
            val vx = m.pos[c * 3] - m.pos[a * 3]; val vy = m.pos[c * 3 + 1] - m.pos[a * 3 + 1]; val vz = m.pos[c * 3 + 2] - m.pos[a * 3 + 2]
            val nx = uy * vz - uz * vy; val ny = uz * vx - ux * vz; val nz = ux * vy - uy * vx
            nor[a * 3] += nx; nor[a * 3 + 1] += ny; nor[a * 3 + 2] += nz
            nor[b * 3] += nx; nor[b * 3 + 1] += ny; nor[b * 3 + 2] += nz
            nor[c * 3] += nx; nor[c * 3 + 1] += ny; nor[c * 3 + 2] += nz
            i += 3
        }
        for (r in 0 until rows) {
            val first = r * (radial + 1); val last = first + radial
            for (k in 0..2) { val s = nor[first * 3 + k] + nor[last * 3 + k]; nor[first * 3 + k] = s; nor[last * 3 + k] = s }
        }
        for (v in 0 until m.vertexCount) {
            val l = sqrt(nor[v * 3] * nor[v * 3] + nor[v * 3 + 1] * nor[v * 3 + 1] + nor[v * 3 + 2] * nor[v * 3 + 2])
            if (l > 1e-8f) { nor[v * 3] /= l; nor[v * 3 + 1] /= l; nor[v * 3 + 2] /= l }
        }
        m.nor = nor
    }

    /**
     * The tree body (trunk, root flare, limbs and their forks) as one mesh; see the note above.
     *
     * [shape] picks one of several different trees of the species (0..15): sway, burl, roots, number and place of the limbs
     * and each limb's length, thickness, rise and curl all change with it. Each limb takes a hole in a ring pair of the
     * trunk grid and grows out of the loop around it through TREE_LIMB_RINGS rings to a tip. Forks (TREE_FORK_COUNT per
     * limb) are tapered swept tubes whose first ring sits on the limb's centre line, merged into the same mesh.
     * The shadow variant has no limbs.
     */
    fun treeBody(lifelike: Boolean, shadow: Boolean = false, variant: Int = 0, shape: Int = 0): MeshData {
        val sp = variant.coerceIn(0, 3) // oak, pine, ancient, birch
        val ridges = TREE_RIDGES[sp]
        val n = if (shadow) 2 * ridges else if (lifelike) maxOf(12, TREE_RADIAL[sp] * ridges) else maxOf(12, 2 * ridges)
        val ts = TreeShape(sp, shape.coerceIn(0, 15), n)
        val loopW = if (lifelike) 4 else 3

        // Limbs: heights and lengths from the tuned per-species formulas, then grouped into levels that share a pair of rows.
        val limbCount = if (shadow) 0 else TREE_LIMB_COUNT[sp]
        val per = TREE_LIMBS_PER_LEVEL[sp]
        val limbY = DoubleArray(limbCount); val limbLen = DoubleArray(limbCount)
        for (b in 0 until limbCount) {
            limbY[b] = TREE_LIMB_START[sp] + b * TREE_LIMB_SPACING[sp] + ts.r(60 + b) * TREE_LIMB_JITTER[sp]
            val raw = TREE_LIMB_LEN_BASE[sp] + b * TREE_LIMB_LEN_SLOPE[sp] + ts.r(95 + b) * TREE_LIMB_LEN_RAND[sp]
            limbLen[b] = maxOf(raw, 1.0) * TREE_LIMB_LEN[sp]
        }
        val groupFrom = ArrayList<Int>(); val groupSize = ArrayList<Int>()
        var nextLimb = 0
        while (nextLimb < limbCount) {
            val want = if (ts.r(320 + groupFrom.size) > .25) per else maxOf(1, per - 1)
            val cnt = minOf(want, limbCount - nextLimb)
            groupFrom += nextLimb; groupSize += cnt
            nextLimb += cnt
        }
        val levels = groupFrom.size

        // Rows, bottom to top: dense through the root flare (up to TREE_FLARE_TOP), then a pair per limb level.
        // The body ends in a flat cut TREE_CUT_DEPTH below the soil (the default .6 keeps the bottom row at .5).
        val bottom = .5 + (.6 - TREE_CUT_DEPTH[sp])
        val ys = ArrayList<Double>()
        ys += bottom
        if (shadow) {
            for (y in doubleArrayOf(.5, 1.1, 1.8, 2.8, 4.2, 7.5, 14.0)) if (y > bottom + .05) ys += y
            ys += ts.topY
        } else {
            val flareTop = maxOf(TREE_FLARE_TOP[sp], TREE_GROUND + TREE_ROOT_H[sp] + TREE_ROOT_H_RAND[sp] + .4)
            for (y in doubleArrayOf(.5, .8, 1.1, 1.25, 1.45, 1.7, 2.05, 2.45, 2.95, 3.55, 4.2, 5.0)) {
                val v = .5 + (y - .5) * (flareTop - .5) / 4.5
                if (v > bottom + .05) ys += v
            }
        }
        val gap = TREE_LIMB_HOLE[sp]        // half the height of a limb's hole
        val levelRow = IntArray(levels)
        var prevTop = ys[ys.size - 1]
        for (l in 0 until levels) {
            var y = 0.0
            for (b in groupFrom[l] until groupFrom[l] + groupSize[l]) y += limbY[b]
            y = y / groupSize[l] + (ts.r(330 + l) - .5) * TREE_LEVEL_JITTER[sp]
            y = maxOf(y, prevTop + 2 * gap + .5 + (if (l == 0) 1.0 else 0.0))
            if ((y - gap) - ys[ys.size - 1] > 3.2) ys += (ys[ys.size - 1] + y - gap) / 2
            levelRow[l] = ys.size
            ys += y - gap; ys += y + gap
            prevTop = y + gap
        }
        if (!shadow) ys += maxOf(ts.topY, ys[ys.size - 1] + 3.0)
        ys += ys[ys.size - 1] + .7           // the stem narrows over this last row and is closed by a fan
        val rows = ys.size
        val stride = n + 1

        val sb = SurfaceBuilder()
        for (r in 0 until rows) {
            val y = ys[r]
            val wx = ts.cx(y); val wz = ts.cz(y)
            for (c in 0..n) {
                val th = c.toDouble() / n * 2 * PI
                val rr = ts.radius(th, y) * (if (r == rows - 1) .3 else 1.0)
                sb.vertex(sin(th) * rr + wx, y, cos(th) * rr + wz, c.toDouble() / n, y / 22.0)
            }
        }

        val yTop = ys[rows - 1]
        val cap = sb.vertex(ts.cx(yTop), yTop + .25, ts.cz(yTop), .5, yTop / 22.0)
        for (c in 0 until n) sb.tri((rows - 1) * stride + c, (rows - 1) * stride + c + 1, cap)

        // Limbs: cut a hole in the ring pair, then sprout TREE_LIMB_RINGS rings and a tip from the loop around it.
        val forks = ArrayList<MeshData>()
        val hole = BooleanArray((rows - 1) * n)
        val ringCount = maxOf(1, TREE_LIMB_RINGS[sp])
        for (l in 0 until levels) {
            val count = groupSize[l]
            val span = n / count
            val we = maxOf(1, minOf(loopW, span - 1))   // columns the hole spans (neighbours never share a vertex)
            val r0 = levelRow[l]
            for (j in 0 until count) {
                val b = groupFrom[l] + j
                // Anywhere inside this limb's own stretch of the ring, so the limbs are not evenly spread around the stem.
                val c0 = minOf(j * span + (ts.r(380 + b) * (span - we)).toInt(), n - we)
                for (c in c0 until c0 + we) hole[r0 * n + c] = true
                val kb = 2 * (we + 1)
                val loop = IntArray(kb)
                for (i in 0..we) { loop[i] = r0 * stride + c0 + i; loop[we + 1 + i] = (r0 + 1) * stride + c0 + we - i }
                var px = 0.0; var py = 0.0; var pz = 0.0
                for (v in loop) { px += sb.x(v); py += sb.y(v); pz += sb.z(v) }
                px /= kb; py /= kb; pz /= kb
                // Outward (horizontal) direction at the hole, and its sideways direction.
                var nx = px - ts.cx(py); var nz = pz - ts.cz(py)
                val nl = sqrt(nx * nx + nz * nz).coerceAtLeast(1e-9)
                nx /= nl; nz /= nl
                val n0 = doubleArrayOf(nx, 0.0, nz)
                val sx = -nz; val sz = nx
                val len = limbLen[b] * (.9 + ts.r(340 + b) * .8)
                val rise = TREE_LIMB_RISE[sp] + ts.r(350 + b) * TREE_LIMB_RISE_RAND[sp]   // some limbs droop, some reach up
                val bend = (ts.r(360 + b) - .5) * TREE_LIMB_BEND[sp]
                val curl = (ts.r(365 + b) - .5) * TREE_LIMB_CURL[sp]
                val thick = (.55 + ts.r(370 + b) * .4) * TREE_LIMB_THICK[sp]
                // Centre line: ringCount rings and a tip. It bends sideways, curls and rises or droops.
                val along = DoubleArray(ringCount + 1) { if (it == ringCount) 1.0 else .14 + it * .82 / ringCount }
                fun lineAt(s: Double): DoubleArray {
                    val side = bend * s.pow(1.5) + curl * sin(s * 2.8)
                    return doubleArrayOf(px + nx * (s * len) + sx * side, py + rise * s.pow(1.8) - .15 * (1.0 - s), pz + nz * (s * len) + sz * side)
                }
                val cx = DoubleArray(ringCount + 1); val cy = DoubleArray(ringCount + 1); val cz = DoubleArray(ringCount + 1)
                for (j2 in 0..ringCount) { val q = lineAt(along[j2]); cx[j2] = q[0]; cy[j2] = q[1]; cz[j2] = q[2] }
                val tx = DoubleArray(ringCount + 1); val ty = DoubleArray(ringCount + 1); val tz = DoubleArray(ringCount + 1)
                for (j2 in 0..ringCount) {
                    val a = minOf(j2 + 1, ringCount); val z = maxOf(j2 - 1, 0)
                    var dx = cx[a] - cx[z]; var dy = cy[a] - cy[z]; var dz = cz[a] - cz[z]
                    val dl = sqrt(dx * dx + dy * dy + dz * dz).coerceAtLeast(1e-9)
                    dx /= dl; dy /= dl; dz /= dl
                    tx[j2] = dx; ty[j2] = dy; tz[j2] = dz
                }
                // The hole is taller than wide; the rings are rounded off towards the tip.
                var sMin = 1e9; var sMax = -1e9; var yMin = 1e9; var yMax = -1e9
                var holeR = 0.0
                for (v in loop) {
                    val sd = (sb.x(v) - px) * sx + (sb.z(v) - pz) * sz
                    sMin = minOf(sMin, sd); sMax = maxOf(sMax, sd)
                    yMin = minOf(yMin, sb.y(v)); yMax = maxOf(yMax, sb.y(v))
                    val ex = sb.x(v) - px; val ey = sb.y(v) - py; val ez = sb.z(v) - pz
                    holeR += sqrt(ex * ex + ey * ey + ez * ez)
                }
                holeR /= kb
                val round = minOf(1.0, (sMax - sMin) * 1.15 / maxOf(1e-6, yMax - yMin))
                val ring = Array(ringCount) { IntArray(kb) }
                var meanU = 0.0
                for (v in loop) meanU += sb.uv[v * 2]
                meanU /= kb
                for (j2 in 0 until ringCount) {
                    val vScale = if (j2 == 0) (1.0 + round) / 2 else round
                    val ringScale = (.8 - .76 * j2 / ringCount) * thick
                    for (i in 0 until kb) {
                        val lv = loop[i]
                        val rv = rotateOnto(
                            doubleArrayOf((sb.x(lv) - px) * ringScale, (sb.y(lv) - py) * vScale * ringScale, (sb.z(lv) - pz) * ringScale),
                            n0, doubleArrayOf(tx[j2], ty[j2], tz[j2]))
                        val u = sb.uv[lv * 2].toDouble(); val v = sb.uv[lv * 2 + 1].toDouble()
                        ring[j2][i] = sb.vertex(cx[j2] + rv[0], cy[j2] + rv[1], cz[j2] + rv[2], u, v + along[j2] * len / 22.0)
                    }
                }
                val tip = sb.vertex(cx[ringCount], cy[ringCount], cz[ringCount], meanU, sb.uv[loop[0] * 2 + 1] + len / 22.0)
                // The loop runs counter-clockwise seen from outside, so the faces built in loop order already face outward.
                val rings = arrayOf(loop) + ring
                for (j2 in 0 until ringCount) {
                    val lower = rings[j2]; val upper = rings[j2 + 1]
                    for (i in 0 until kb) {
                        val i2 = (i + 1) % kb
                        sb.tri(lower[i], lower[i2], upper[i]); sb.tri(lower[i2], upper[i2], upper[i])
                    }
                }
                val lastRing = ring[ringCount - 1]
                for (i in 0 until kb) sb.tri(lastRing[i], lastRing[(i + 1) % kb], tip)

                // Forks: tapered tubes whose first ring sits on the limb's centre line (embedded in the limb).
                val forkCount = TREE_FORK_COUNT[sp]
                if (!shadow && forkCount > 0) {
                    fun limbRadiusAt(s: Double): Double {
                        val sl = along[ringCount - 1]
                        if (s >= sl) return holeR * (.8 - .76 * (ringCount - 1) / ringCount) * thick * maxOf(0.0, (1 - s) / (1 - sl))
                        val j2 = maxOf(0, minOf(ringCount - 2, Math.floor((s - .14) * ringCount / .82).toInt()))
                        val sa = along[j2]; val sb2 = along[j2 + 1]
                        val t = maxOf(0.0, minOf(1.0, (s - sa) / (sb2 - sa)))
                        val ra = .8 - .76 * j2 / ringCount; val rb = .8 - .76 * (j2 + 1) / ringCount
                        return holeR * (ra + (rb - ra) * t) * thick
                    }
                    for (f in 0 until forkCount) {
                        val salt = 400 + b * 8 + f
                        val off = if (forkCount > 1) f.toDouble() / (forkCount - 1) - .5 else 0.0
                        val s = minOf(.92, maxOf(.1, TREE_FORK_START[sp] + off * TREE_FORK_SPREAD[sp] + (ts.r(salt) - .5) * .08))
                        val base = lineAt(s)
                        val ahead = lineAt(minOf(1.0, s + .02))
                        var dx = ahead[0] - base[0]; var dy = ahead[1] - base[1]; var dz = ahead[2] - base[2]
                        val dl = sqrt(dx * dx + dy * dy + dz * dz).coerceAtLeast(1e-9)
                        dx /= dl; dy /= dl; dz /= dl
                        var qx = -dz; var qz = dx
                        val ql = sqrt(qx * qx + qz * qz).coerceAtLeast(1e-9)
                        qx /= ql; qz /= ql
                        val sign = (if (f % 2 == 0) 1.0 else -1.0) * (if (ts.r(salt + 1) < .5) -1.0 else 1.0)
                        var ex = dx + qx * TREE_FORK_ANGLE[sp] * sign; var ey = dy + TREE_FORK_RISE[sp]; var ez = dz + qz * TREE_FORK_ANGLE[sp] * sign
                        val el = sqrt(ex * ex + ey * ey + ez * ez).coerceAtLeast(1e-9)
                        ex /= el; ey /= el; ez /= el
                        val fl = TREE_FORK_LEN[sp] * len * (1.0 - s * .5) * (.8 + ts.r(salt + 2) * .4)
                        val pts = ArrayList<FloatArray>(4)
                        for (k2 in doubleArrayOf(0.0, .3, .65, 1.0)) {
                            pts += floatArrayOf(
                                (base[0] + ex * fl * k2 + dx * fl * .15 * k2 * k2).toFloat(),
                                (base[1] + ey * fl * k2 + dy * fl * .15 * k2 * k2).toFloat(),
                                (base[2] + ez * fl * k2 + dz * fl * .15 * k2 * k2).toFloat())
                        }
                        val fr = limbRadiusAt(s) * TREE_FORK_THICK[sp]
                        forks += sweptTube(pts, floatArrayOf(fr.toFloat(), (fr * .72).toFloat(), (fr * .42).toFloat(), .012f), if (lifelike) 8 else 5)
                    }
                }
            }
        }

        // The trunk grid itself (the quads under the limbs are the holes). Rows run upward, so this order faces outward.
        for (r in 0 until rows - 1) for (c in 0 until n) {
            if (hole[r * n + c]) continue
            val a = r * stride + c; val b = (r + 1) * stride + c
            val c2 = (r + 1) * stride + c + 1; val d = r * stride + c + 1
            sb.tri(a, d, b); sb.tri(b, d, c2)
        }

        val surface = MeshData(sb.pos.copyOf(sb.n * 3), sb.uv.copyOf(sb.n * 2), sb.idx.copyOf(sb.ni))
        gridNormals(surface, rows, n)
        // The whole body leans together (a little differently for every shape), so the limbs stay attached to the stem.
        val lean = TREE_LEAN[sp] * (.4 + ts.r(313) * 1.8)
        val m = FloatArray(16)
        Mat.compose(m, 0, 0.0, 0.0, 0.0, lean * (ts.r(314) * 2 - 1), 0.0, -lean * (ts.r(315) * 2 - 1), Mat.XYZ, 1.0, 1.0, 1.0)
        val parts = ArrayList<Pair<MeshData, FloatArray>>()
        parts += surface to m
        for (f in forks) parts += f to m
        if (TREE_BOTTOM_CAP[sp] > 0) {
            // Bottom cap: a flat fan over a copy of the lowest ring, facing down, so the body cannot be seen into from below.
            val cp = FloatArray((n + 2) * 3); val cu = FloatArray((n + 2) * 2); val ci = ShortArray(n * 3)
            for (c in 0..n) {
                cp[c * 3] = surface.pos[c * 3]; cp[c * 3 + 1] = surface.pos[c * 3 + 1]; cp[c * 3 + 2] = surface.pos[c * 3 + 2]
                cu[c * 2] = surface.uv[c * 2]; cu[c * 2 + 1] = surface.uv[c * 2 + 1]
            }
            val y0 = ys[0]
            cp[(n + 1) * 3] = ts.cx(y0).toFloat(); cp[(n + 1) * 3 + 1] = y0.toFloat(); cp[(n + 1) * 3 + 2] = ts.cz(y0).toFloat()
            cu[(n + 1) * 2] = .5f; cu[(n + 1) * 2 + 1] = (y0 / 22.0).toFloat()
            for (c in 0 until n) { ci[c * 3] = (c + 1).toShort(); ci[c * 3 + 1] = c.toShort(); ci[c * 3 + 2] = (n + 1).toShort() }
            val capMesh = MeshData(cp, cu, ci)
            val cn = FloatArray(cp.size)
            for (v in 0 until n + 2) cn[v * 3 + 1] = -1f
            capMesh.nor = cn
            parts += capMesh to m
        }
        return mergeTreeParts(parts)
    }

`;
}

/** The reference Meshes.kt with its tree section replaced by the tuned one. */
export function buildMeshesKt(template: string, species: SpeciesParams, stamp: string): string {
  const a = template.indexOf(SECTION_START);
  const b = template.indexOf(SECTION_END);
  if (a < 0 || b < 0 || b < a) throw new Error("A Meshes.kt sablonban nem található a fa szakasz.");
  return template.slice(0, a) + kotlinTreeSection(species, stamp) + template.slice(b);
}
