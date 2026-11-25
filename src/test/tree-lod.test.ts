import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildMeshesKt, upgradeTreeKotlin } from "@/tree/kotlin";
import { avgTriangles, limbDeviation, LOD_KEYS, reduceTree, trunkDistance } from "@/tree/lod";
import { buildTree } from "@/tree/mesh";
import { fileDefaults, PARAM_KEYS, SPECIES, type ParamKey, type SpeciesParams } from "@/tree/params";

const template = readFileSync(path.resolve(__dirname, "../kotlin/Meshes_Reference_Tree.kt"), "utf8");
const all = new Set<ParamKey>(PARAM_KEYS);

describe("tree triangle budget", () => {
  it("the new settings default to the old hard-wired behaviour", () => {
    for (const s of SPECIES) {
      expect(fileDefaults(s.id).radialMin).toBe(12);
      expect(fileDefaults(s.id).flareRows).toBe(12);
    }
    expect(buildTree(fileDefaults(0), 0, 0).triangleCount).toBe(1449);
  });

  it("fewer flare rows remove rings of the trunk grid, the lowest and the highest stay", () => {
    const p = { ...fileDefaults(0), lean: 0 };
    const full = buildTree(p, 0, 0);
    const few = buildTree({ ...p, flareRows: 6 }, 0, 0);
    expect(few.rows).toBe(full.rows - 6);
    expect(few.triangleCount).toBeLessThan(full.triangleCount);
    let lo = 1e9;
    for (let i = 0; i < few.vertexCount; i++) lo = Math.min(lo, few.pos[i * 3 + 1]!);
    expect(lo).toBeCloseTo(0.5, 5);
  });

  it("the lowest side count and the multiplier set the sides", () => {
    const birch = fileDefaults(3);
    expect(buildTree({ ...birch, radialMult: 2 }, 3, 0).ringSides).toBe(12);
    expect(buildTree({ ...birch, radialMult: 2, radialMin: 8 }, 3, 0).ringSides).toBe(8);
    expect(buildTree({ ...birch, radialMult: 2, radialMin: 6 }, 3, 0).triangleCount).toBeLessThan(buildTree({ ...birch, radialMult: 2 }, 3, 0).triangleCount);
  });

  it("the Kotlin carries the same settings, and an older Meshes.kt is brought up to date without changing behaviour", () => {
    const sp = [0, 1, 2, 3].map(fileDefaults) as SpeciesParams;
    sp[1] = { ...sp[1], radialMin: 9, flareRows: 7 };
    const gen = buildMeshesKt(template, sp, "test");
    expect(gen).toContain("private val TREE_MIN_SIDES = intArrayOf(12, 9, 12, 12)");
    expect(gen).toContain("private val TREE_FLARE_ROWS = intArrayOf(12, 7, 12, 12)");
    expect(gen).toContain("maxOf(TREE_MIN_SIDES[sp], TREE_RADIAL[sp] * ridges)");
    // what the studio wrote before these settings existed
    const old = buildMeshesKt(template, [0, 1, 2, 3].map(fileDefaults) as SpeciesParams, "test")
      .replace(/^.*TREE_MIN_SIDES = .*\n/m, "")
      .replace(/^.*TREE_FLARE_ROWS = .*\n/m, "")
      .replace("maxOf(TREE_MIN_SIDES[sp], TREE_RADIAL[sp] * ridges) else maxOf(TREE_MIN_SIDES[sp], 2 * ridges)", "maxOf(12, TREE_RADIAL[sp] * ridges) else maxOf(12, 2 * ridges)")
      .replace(/ *\/\/ TREE_FLARE_ROWS of the 12[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*\n/, "")
      .replace("for ((fi, y) in doubleArrayOf(.5, .8, 1.1, 1.25, 1.45, 1.7, 2.05, 2.45, 2.95, 3.55, 4.2, 5.0).withIndex()) {\n                if (!keep[fi]) continue\n", "for (y in doubleArrayOf(.5, .8, 1.1, 1.25, 1.45, 1.7, 2.05, 2.45, 2.95, 3.55, 4.2, 5.0)) {\n");
    expect(old).not.toContain("TREE_MIN_SIDES");
    const up = upgradeTreeKotlin(old);
    expect(up).toBe(buildMeshesKt(template, [0, 1, 2, 3].map(fileDefaults) as SpeciesParams, "test"));
    expect(upgradeTreeKotlin(up!)).toBeNull();
    // code the studio does not recognise is left alone
    expect(upgradeTreeKotlin("class Nothing")).toBeNull();
  });

  it("measures how far a reduced tree is from the original", () => {
    const p = fileDefaults(0);
    expect(trunkDistance(p, p, 0, 0).mean).toBe(0);
    const near = trunkDistance(p, { ...p, flareRows: 10 }, 0, 0).mean;
    const far = trunkDistance(p, { ...p, flareRows: 4, radialMult: 2, radialMin: 6 }, 0, 0).mean;
    expect(far).toBeGreaterThan(near);
    expect(limbDeviation(p, 2)).toBeLessThan(limbDeviation(p, 1));
  });

  it("halves the triangles of every species, trunk and limbs together", () => {
    for (const s of SPECIES) {
      const o = fileDefaults(s.id);
      const r = reduceTree(o, o, s.id, { target: 0.5, allowed: all, soilBottom: true });
      expect(r.short).toBe(false);
      expect(r.triangles / r.baseline).toBeLessThanOrEqual(0.52);
      expect(r.triangles / r.baseline).toBeGreaterThan(0.3);
      expect(r.meanCm).toBeLessThan(15);
      expect(avgTriangles(r.params, s.id, { soilBottom: true })).toBeCloseTo(r.triangles, 6);
    }
  });

  it("keeps the settings it may not touch, and says when the target is out of reach", () => {
    const o = fileDefaults(3);
    const current = { ...o, radialMin: 11 };
    const allowed = new Set<ParamKey>(["radialMult", "limbRings"]);
    const r = reduceTree(o, current, 3, { target: 0.5, allowed, soilBottom: true });
    expect(r.knobs.radialMin).toBe(11);
    expect(r.knobs.flareRows).toBe(12);
    expect(r.short).toBe(true);
    // nothing to reduce at 100%
    const same = reduceTree(o, o, 0, { target: 1, allowed: all, soilBottom: true });
    for (const k of LOD_KEYS) expect(same.knobs[k]).toBe(fileDefaults(0)[k]);
  });
});
