import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hash } from "@/tree/hash";
import { buildMeshesKt, kotlinArrays } from "@/tree/kotlin";
import { buildTree } from "@/tree/mesh";
import { fileDefaults, PARAM_SPECS, referencePreset, type SpeciesParams } from "@/tree/params";

const template = readFileSync(path.resolve(__dirname, "../kotlin/Meshes_Reference_Tree.kt"), "utf8");
const fileSpecies = (): SpeciesParams => [fileDefaults(0), fileDefaults(1), fileDefaults(2), fileDefaults(3)];

describe("tree mesh", () => {
  it("hash matches Kotlin Int-overflow arithmetic", () => {
    // Reference values from an independent 32-bit two's-complement emulation of Simulation.kt's hash.
    expect(hash(34, 0, 230)).toBeCloseTo(0.6410538544042627, 14);
    expect(hash(7, -3, 12)).toBeCloseTo(0.833165041830662, 14);
    expect(hash(0, 0, 0)).toBe(0);
  });

  it("file defaults reproduce the reference tree vertex counts (verified against compiled Kotlin)", () => {
    // From the JVM run of the uploaded Meshes_Reference_Tree.kt: oak shape 0 lifelike = 762 vertices, 1449 triangles.
    const oak = buildTree(fileDefaults(0), 0, 0, { lifelike: true });
    expect(oak.vertexCount).toBe(762);
    expect(oak.triangleCount).toBe(1449);
    const oakLow = buildTree(fileDefaults(0), 0, 0, { lifelike: false });
    expect(oakLow.vertexCount).toBe(544);
  });

  it("root count changes the number of ring sides", () => {
    const p = { ...fileDefaults(2), rootCount: 10 };
    expect(buildTree(p, 2, 0).ringSides).toBe(30);
  });

  it("limb count and forks add geometry; zero limbs leaves only the trunk", () => {
    const base = referencePreset(2);
    const none = buildTree({ ...base, limbCount: 0, forkCount: 0 }, 2, 0);
    const some = buildTree({ ...base, limbCount: 6, forkCount: 0 }, 2, 0);
    const forked = buildTree({ ...base, limbCount: 6, forkCount: 2 }, 2, 0);
    expect(some.vertexCount).toBeGreaterThan(none.vertexCount);
    expect(forked.vertexCount).toBeGreaterThan(some.vertexCount);
  });

  it("height setting moves the top of the trunk", () => {
    const p = { ...referencePreset(2), heightRand: 0, height: 30 };
    expect(buildTree(p, 2, 0).topY).toBeCloseTo(30.7, 5);
  });

  it("generated Meshes.kt carries every tuned value and keeps the rest of the file", () => {
    const sp = fileSpecies();
    sp[2] = { ...sp[2], rootLength: 3.21, limbCount: 13 };
    const kt = buildMeshesKt(template, sp, "test");
    expect(kt).toContain("private val TREE_ROOT_LEN = doubleArrayOf(1.65, 0.9, 3.21, 0.85)");
    expect(kt).toContain("private val TREE_LIMB_COUNT = intArrayOf(9, 9, 13, 6)");
    for (const s of PARAM_SPECS) expect(kotlinArrays(sp)).toContain(`private val ${s.kt} =`);
    expect(kt.startsWith(template.slice(0, template.indexOf("    // ---- one-surface trees ----")))).toBe(true);
    expect(kt).toContain("fun treeCanopy(");
    expect(kt).toContain("class Mesh(");
  });

  it("joint angle: 90° leaves the reference tree untouched, a small angle pulls the root crest in near the joint", () => {
    expect(fileDefaults(2).rootAngle).toBe(90);
    const base = { ...fileDefaults(2), rootHMin: 3, rootHRand: 0, rootSteepMin: 0.6, rootSteepRand: 0 };
    const sharp = buildTree(base, 2, 0);
    const soft = buildTree({ ...base, rootAngle: 20 }, 2, 0);
    expect(soft.vertexCount).toBe(sharp.vertexCount);
    // Widest point of the surface in the upper part of the joint zone (2.1 m – 3 m above the soil).
    const widest = (m: typeof sharp) => {
      let w = 0;
      for (let i = 0; i < m.vertexCount; i++) {
        const y = m.pos[i * 3 + 1]! - 1.1;
        if (y > 2.1 && y < 3) w = Math.max(w, Math.hypot(m.pos[i * 3]!, m.pos[i * 3 + 2]!));
      }
      return w;
    };
    expect(widest(soft)).toBeLessThan(widest(sharp) - 0.3);
  });

  it("root joint settings are exported to Meshes.kt as their own arrays", () => {
    const sp = fileSpecies();
    sp[2] = { ...sp[2], rootCount: 11, rootWidth: 0.7, rootHMin: 3.25, rootAngle: 35 };
    const kt = buildMeshesKt(template, sp, "test");
    expect(kt).toContain("private val TREE_RIDGES = intArrayOf(7, 5, 11, 4)");
    expect(kt).toContain("private val TREE_ROOT_SIGMA = doubleArrayOf(0.42, 0.42, 0.7, 0.42)");
    expect(kt).toContain("private val TREE_ROOT_H = doubleArrayOf(1.5, 0.6, 3.25, 0.35)");
    expect(kt).toContain("private val TREE_ROOT_ANGLE = doubleArrayOf(90.0, 90.0, 35.0, 90.0)");
  });
  it("root count can be set separately for every species", () => {
    const sp = fileSpecies();
    sp[0] = { ...sp[0], rootCount: 3 };
    sp[1] = { ...sp[1], rootCount: 9 };
    sp[3] = { ...sp[3], rootCount: 12 };
    expect(buildMeshesKt(template, sp, "test")).toContain("private val TREE_RIDGES = intArrayOf(3, 9, 8, 12)");
    expect(buildTree(sp[3], 3, 0).ringSides).toBe(36);
  });

  it("underground cut: default 0.6 m keeps the reference bottom at 0.5, a deeper cut moves the flat bottom down", () => {
    expect(fileDefaults(0).cutDepth).toBe(0.6);
    const minY = (m: ReturnType<typeof buildTree>) => {
      let y = Infinity;
      for (let i = 0; i < m.vertexCount; i++) y = Math.min(y, m.pos[i * 3 + 1]!);
      return y;
    };
    const p = { ...fileDefaults(0), lean: 0 };
    expect(minY(buildTree(p, 0, 0))).toBeCloseTo(0.5, 5);
    expect(minY(buildTree({ ...p, cutDepth: 1.5 }, 0, 0))).toBeCloseTo(1.1 - 1.5, 5);
    expect(minY(buildTree({ ...p, cutDepth: 0 }, 0, 0))).toBeCloseTo(1.1, 5);
  });

  it("closed bottom: off by default, on adds a downward fan of ringSides triangles", () => {
    expect(fileDefaults(0).bottomCap).toBe(0);
    const p = fileDefaults(0);
    const open = buildTree(p, 0, 0);
    const closed = buildTree({ ...p, bottomCap: 1 }, 0, 0);
    expect(closed.triangleCount - open.triangleCount).toBe(open.ringSides);
    expect(closed.vertexCount - open.vertexCount).toBe(open.ringSides + 2);
    // Every cap vertex normal points down (the body has a slight lean, so allow a small tilt).
    for (let v = open.vertexCount; v < closed.vertexCount; v++) expect(closed.nor[v * 3 + 1]!).toBeLessThan(-0.99);
    const sp = fileSpecies();
    sp[1] = { ...sp[1], bottomCap: 1, cutDepth: 1.2 };
    const kt = buildMeshesKt(template, sp, "test");
    expect(kt).toContain("private val TREE_BOTTOM_CAP = intArrayOf(0, 1, 0, 0)");
    expect(kt).toContain("private val TREE_CUT_DEPTH = doubleArrayOf(0.6, 1.2, 0.6, 0.6)");
  });
});
