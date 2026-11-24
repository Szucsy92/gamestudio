import { describe, expect, it } from "vitest";
import { autoRange, formatLiteral, patchSource, scanKotlin } from "@/studio/scan";
import { patternRegex, resolveCurated, type CuratedDef, type FileIndex } from "@/studio/curated";
import { buildModel, codeRef, treeEdits } from "@/studio/catalog";
import { applyPatch, buildPatch, editsFromPatched, fileDiffs, folderTree, restorePatch, treeText } from "@/studio/diff";
import { fileDefaults, scaleRootJoint } from "@/tree/params";

const SIM = `package x
const val GATE_HALF = 2.4
const val MAX_HEADING = 37.5 * PI / 180.0
private const val PLAYER = .16
object Palette {
    val fog = lin(0x0b1424); val moon = lin(0x829ff0)
}
object SkyLights {
    val SUN = SkyLight(startCyc = .25, lenCyc = .5, minElDeg = 4.0, maxElDeg = 23.0, intensityLow = 1.75f, intensityHigh = 2.75f)
}
class Features(val q: Int) {
    val bloomStrength = if (r >= 2) 0.20f else 0.23f
    var counter = 5
}
fun draw() {
    val s = "label 12 ${"$"}{3}"
    prim(box, parent, side * (GATE_HALF + .2), 2.1, 0.0, -0.5, 0.0, 0.0, .4, 4.6, .4)
    val x = hash(cx, cz, 719) + pos[3] + a - 2
    for (m in 0 until 11) {}
}
`;

describe("Kotlin number scanner", () => {
  const lits = scanKotlin("app/sim/Simulation.kt", SIM);
  const byDecl = (d: string) => lits.filter((l) => l.decl === d);

  it("names class- and file-level values, with named arguments and indices", () => {
    expect(byDecl("GATE_HALF")[0]?.value).toBe(2.4);
    expect(byDecl("PLAYER")[0]?.value).toBe(0.16);
    expect(byDecl("MAX_HEADING[0]")[0]?.value).toBe(37.5);
    expect(byDecl("SUN.maxElDeg")[0]?.value).toBe(23);
    expect(byDecl("SUN.intensityHigh")[0]?.kind).toBe("float");
    expect(byDecl("fog")[0]?.value).toBe(0x0b1424);
    expect(byDecl("moon")[0]?.kind).toBe("hex");
  });

  it("skips thresholds, vars, strings, hash seeds and array indices", () => {
    expect(byDecl("bloomStrength[0]")[0]?.value).toBeCloseTo(0.2);
    expect(byDecl("bloomStrength[1]")[0]?.value).toBeCloseTo(0.23);
    expect(lits.some((l) => l.decl === "counter")).toBe(false);
    expect(lits.some((l) => l.raw === "12" || l.raw === "719" || l.raw === "3")).toBe(false);
  });

  it("reads unary minus but not a binary one, and finds loop counts", () => {
    expect(lits.find((l) => l.raw === "-0.5")?.value).toBe(-0.5);
    const two = lits.find((l) => l.raw === "2" && l.inFunction);
    expect(two?.value).toBe(2);
    expect(lits.some((l) => l.raw === "11" && l.inFunction)).toBe(true);
  });

  it("writes numbers back in the original style and leaves the rest untouched", () => {
    expect(formatLiteral({ kind: "double", suffix: "", leadingDot: true, upperHex: false, glsl: false }, 0.35)).toBe(".35");
    expect(formatLiteral({ kind: "double", suffix: "", leadingDot: false, upperHex: false, glsl: false }, 3)).toBe("3.0");
    expect(formatLiteral({ kind: "float", suffix: "f", leadingDot: false, upperHex: false, glsl: false }, 2.5)).toBe("2.5f");
    expect(formatLiteral({ kind: "int", suffix: "", leadingDot: false, upperHex: false, glsl: false }, 7.6)).toBe("8");
    expect(formatLiteral({ kind: "hex", suffix: "", leadingDot: false, upperHex: false, glsl: false }, 0xff0000)).toBe("0xff0000");
    const gate = byDecl("GATE_HALF")[0]!;
    const fog = byDecl("fog")[0]!;
    const out = patchSource(SIM, lits, new Map([[gate.id, 3.1], [fog.id, 0x112233]]));
    expect(out).toContain("const val GATE_HALF = 3.1\n");
    expect(out).toContain("val fog = lin(0x112233); val moon = lin(0x829ff0)");
    expect(out.length).toBe(SIM.length);
    expect(patchSource(SIM, lits, new Map())).toBe(SIM);
  });

  it("slider range is 0…3× the repo value", () => {
    expect(autoRange({ kind: "double", value: 2.4 })).toMatchObject({ min: 0, max: 7.2, step: 0.01 });
    expect(autoRange({ kind: "int", value: 11 })).toMatchObject({ min: 0, max: 33, step: 1 });
  });
});

describe("named controls", () => {
  it("find their numbers by pattern even after the values changed", () => {
    const src = "fun f() {\n    prim(box, parent, side * (GATE_HALF + .25), 3.0, 0.0, 0.0, 0.0, 0.0, .5, 5.2, .5)\n}\n";
    const lits = scanKotlin("gl/GameRenderer.kt", src);
    const files = new Map<string, FileIndex>([["app/gl/GameRenderer.kt", { path: "app/gl/GameRenderer.kt", src, byStart: new Map(lits.map((l) => [l.start, l])), byDecl: new Map() }]]);
    const def: CuratedDef = { key: "k", element: "gates", group: "g", label: "l", src: { file: "gl/GameRenderer.kt", find: "prim(box, parent, side * (GATE_HALF + #), #, #, #, #, #, #, #, #)", pick: [7] } };
    const ids = resolveCurated(def, files);
    expect(ids.length).toBe(1);
    expect(lits.find((l) => l.id === ids[0])?.value).toBe(5.2);
    expect(patternRegex("a(#)").test("a(-.5f)")).toBe(true);
  });
});

describe("tree in the repo", () => {
  const meshes = `object Geo {
    // ---- one-surface trees ----
    private val TREE_RIDGES = intArrayOf(7,  7,  7)
    private val TREE_ROOT_LEN = doubleArrayOf(1.09,  4.24,  0.49)
    /** How far a crown lump bulges */
}
`;
  it("reads the per-species arrays as the base and writes only changed values", () => {
    const model = buildModel(new Map([["app/gl/Meshes.kt", meshes]]));
    expect(model.tree.count).toBe(3);
    expect(model.tree.species[1]!.rootLength).toBe(4.24);
    const sp = model.tree.species.map((p) => ({ ...p })) as typeof model.tree.species;
    sp[2] = { ...sp[2]!, rootLength: 0.8 };
    const edits = treeEdits(model.tree, sp, model.lits);
    expect([...edits.values()]).toEqual([0.8]);
  });
});

describe("proportional root length", () => {
  it("doubling the root length doubles the joint height and foot flare height, thickness by √2", () => {
    const p = { ...fileDefaults(0), rootLength: 1, rootHMin: 1.5, rootHRand: 0.6, footHeight: 1.7, rootWidth: 0.4 };
    const q = scaleRootJoint(p, 2);
    expect(q.rootLength).toBe(2);
    expect(q.rootHMin).toBeCloseTo(3);
    expect(q.rootHRand).toBeCloseTo(1.2);
    expect(q.footHeight).toBeCloseTo(3.4);
    expect(q.rootWidth).toBeCloseTo(0.4 * Math.SQRT2);
  });
});

describe("diff and patch", () => {
  const texts = new Map([
    ["app/sim/Simulation.kt", SIM],
    ["app/gl/Palette.kt", "package x\nobject Pal {\n    val fog = lin(0x0b1424)\n}"],
  ]);
  const model = buildModel(texts);
  const gate = [...model.lits.values()].find((l) => l.decl === "GATE_HALF")!;
  const fog = [...model.lits.values()].find((l) => l.file.endsWith("Palette.kt") && l.decl === "fog")!;
  const edits = new Map([[gate.id, 3.1], [fog.id, 0x112233]]);
  const diffs = fileDiffs(model, edits);

  it("makes one git-style diff per changed file, paths relative to the repo root", () => {
    expect(diffs.map((d) => d.path)).toEqual(["app/gl/Palette.kt", "app/sim/Simulation.kt"]);
    const sim = diffs[1]!.patch;
    expect(sim).toContain("--- a/app/sim/Simulation.kt\n+++ b/app/sim/Simulation.kt\n");
    expect(sim).toContain("\n-const val GATE_HALF = 2.4\n+const val GATE_HALF = 3.1\n");
    expect(sim).toMatch(/@@ -1,5 \+1,5 @@/);
    // the Palette file has no newline at the end
    expect(diffs[0]!.patch).toContain("+    val fog = lin(0x112233)\n");
    expect(diffs[0]!.patch).toContain("\\ No newline at end of file");
  });

  it("applying the patch to the base gives exactly the tuned files, and reads back as the same edits", () => {
    const patch = buildPatch(diffs, ["header line"]);
    const out = applyPatch(patch, [...texts.keys()], (p) => texts.get(p));
    expect(out.get("app/sim/Simulation.kt")).toBe(diffs[1]!.after);
    expect(out.get("app/gl/Palette.kt")).toBe(diffs[0]!.after);
    const back = editsFromPatched(model, out);
    expect(back.structural).toEqual([]);
    expect(back.edits.get(gate.id)).toBe(3.1);
    expect(back.edits.get(fog.id)).toBe(0x112233);
    expect(back.edits.size).toBe(2);
  });

  it("a patch that changes code, not just numbers, is reported as structural", () => {
    const changed = new Map([["app/sim/Simulation.kt", SIM.replace("var counter = 5", "var counter2 = 5")]]);
    expect(editsFromPatched(model, changed).structural).toEqual(["app/sim/Simulation.kt"]);
  });

  it("a hunk that does not match the repo is refused", () => {
    const bad = diffs[1]!.patch.replace("-const val GATE_HALF = 2.4", "-const val GATE_HALF = 9.9");
    expect(() => applyPatch(bad, [...texts.keys()], (p) => texts.get(p))).toThrow(/nem illeszkedik/);
  });

  it("summarises the changes by folder", () => {
    const tree = folderTree(diffs);
    expect(tree.dirs.map((d) => d.name)).toEqual(["app"]);
    expect(tree.dirs[0]!.dirs.map((d) => [d.name, d.count])).toEqual([
      ["gl", 1],
      ["sim", 1],
    ]);
    expect(treeText(tree)).toContain("Simulation.kt  (1 érték, 1 sor)");
  });
});

describe("code names under the Hungarian labels", () => {
  const src = "object Pal {\n    val fog = lin(0x0b1424)\n}\nconst val GATE_HALF = 2.4\nfun f() {\n    material(prog, .3, rough = .8)\n    prim(box, side * (GATE_HALF + .25), 3.0)\n}\n";
  const model = buildModel(new Map([["app/gl/X.kt", src]]));
  const lit = (raw: string) => [...model.lits.values()].find((l) => l.raw === raw)!;
  const row = (raw: string, label: string) => ({ key: raw, label, kind: "num" as const, ids: [lit(raw).id], range: { min: 0, max: 1, step: 0.1, int: false }, code: false });

  it("names object members with the object, top-level values plainly, inline numbers by call and argument", () => {
    expect(codeRef(model, row("0x0b1424", "Köd"))?.name).toBe("Pal.fog");
    expect(codeRef(model, row("2.4", "Kapu fél szélessége"))?.name).toBe("GATE_HALF");
    expect(codeRef(model, row(".8", "Érdesség"))?.name).toBe("material(rough = …)");
    expect(codeRef(model, row(".25", "Oszlop kiállása"))?.name).toBe("prim(#2)");
    expect(codeRef(model, row("3.0", "Magasság"))?.where).toBe("X.kt:7");
  });

  it("shows nothing when the label already is the code name", () => {
    expect(codeRef(model, row("2.4", "GATE_HALF"))).toBeUndefined();
  });
});

describe("restore patch", () => {
  const texts = new Map([["app/sim/Simulation.kt", SIM]]);
  const model = buildModel(texts);
  const gate = [...model.lits.values()].find((l) => l.decl === "GATE_HALF")!;
  const diffs = fileDiffs(model, new Map([[gate.id, 3.1]]));

  it("applied after the patch, it brings back the base repo byte for byte", () => {
    const tuned = applyPatch(buildPatch(diffs), [...texts.keys()], (p) => texts.get(p));
    expect(tuned.get("app/sim/Simulation.kt")).toContain("GATE_HALF = 3.1");
    const restored = applyPatch(buildPatch(diffs, ["visszaállító"], true), [...texts.keys()], (p) => tuned.get(p));
    expect(restored.get("app/sim/Simulation.kt")).toBe(SIM);
  });

  it("does not fit the untouched base repo (it is meant for the patched one)", () => {
    expect(() => applyPatch(buildPatch(diffs, [], true), [...texts.keys()], (p) => texts.get(p))).toThrow(/nem illeszkedik/);
  });

  it("restorePatch turns a new base back into the old one", () => {
    const changed = new Map([["app/sim/Simulation.kt", SIM.replace("var counter = 5", "var counter2 = 5")]]);
    const back = applyPatch(restorePatch(texts, changed), [...texts.keys()], (p) => changed.get(p));
    expect(back.get("app/sim/Simulation.kt")).toBe(SIM);
  });
});
