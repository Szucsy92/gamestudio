import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildModel, labelIndex } from "@/studio/catalog";
import { fileDiffs } from "@/studio/diff";
import { extraRows, kindOfId, previewEdits, removedViews, splitByObject, tryRemove, validRemovals } from "@/studio/removal-state";
import { catalogFor, computeRemoval, valueItemId } from "@/studio/removals";

const kt = (f: string) => readFileSync(path.resolve(__dirname, "../kotlin", f), "utf8");

/** The bundled Kotlin sources laid out like the game repo (the folder names the studio looks for). */
const model = buildModel(
  new Map([
    ["app/src/main/java/x/gl/GameRenderer.kt", kt("GameRenderer.kt")],
    ["app/src/main/java/x/sim/Simulation.kt", kt("Simulation.kt")],
    ["app/src/main/java/x/gl/Quality.kt", kt("Quality.kt")],
    ["app/src/main/java/x/gl/Shaders.kt", kt("Shaders.kt")],
    ["app/src/main/java/x/gl/Meshes.kt", kt("Meshes_Reference_Tree.kt")],
  ]),
);
const cat = catalogFor(model);
const gateHalf = () => model.curated.get("gate.half")!;

describe("deleting from the workbench", () => {
  it("finds the elements, objects, parts and animations to put buttons on", () => {
    const kinds = new Map<string, number>();
    for (const it of cat.items.values()) kinds.set(it.kind, (kinds.get(it.kind) ?? 0) + 1);
    expect(kinds.get("element")).toBe(3);
    expect(kinds.get("object")).toBeGreaterThanOrEqual(9);
    expect(kinds.get("part")).toBeGreaterThanOrEqual(20);
    expect(kinds.get("anim")).toBeGreaterThanOrEqual(50);
    expect(cat.items.has("e:gates") && cat.items.has("e:hole") && cat.items.has("e:orbs")).toBe(true);
    expect(cat.items.has("p:gate.posts") && cat.items.has("p:hole.veil")).toBe(true);
  });

  it("adds a part once, and leaves out what an earlier deletion already took", () => {
    const first = tryRemove(model, [], ["p:hole.veil"]);
    expect(first.failed).toEqual([]);
    expect(first.next).toEqual(["p:hole.veil"]);
    expect(tryRemove(model, first.next, ["p:hole.veil"]).added).toEqual([]);
    const whole = tryRemove(model, first.next, ["e:hole"]);
    expect(whole.next).toEqual(["p:hole.veil", "e:hole"]);
    // the body went with the whole element: deleting it again changes nothing
    expect(tryRemove(model, ["e:hole"], ["p:hole.body"]).added).toEqual([]);
  });

  it("undo is just a smaller list: the code is back byte for byte", () => {
    const withIt = computeRemoval(model, ["p:hole.veil"]);
    expect([...withIt.render(new Map()).keys()].length).toBe(1);
    const without = computeRemoval(model, []);
    expect(without.render(new Map()).size).toBe(0);
    expect(without.hidden.size).toBe(0);
  });

  it("hides the preview pieces of what was deleted", () => {
    expect(computeRemoval(model, ["p:gate.veil"]).hidden.has("gate.veil")).toBe(true);
    const el = computeRemoval(model, ["e:hole"]);
    expect(el.hidden.has("hole")).toBe(true);
    expect(el.gone("p:hole.veil")).toBe(true);
  });

  it("deletes a single value with its references and gives the preview the neutral number", () => {
    const id = valueItemId(gateHalf());
    const r = tryRemove(model, [], [id]);
    expect(r.failed).toEqual([]);
    expect(r.added).toEqual([id]);
    const state = computeRemoval(model, r.next);
    expect(state.litDead(gateHalf()[0]!)).toBe(true);
    const edits = { [gateHalf()[0]!]: 3 };
    const preview = previewEdits(model, edits, state);
    expect(preview[gateHalf()[0]!]).toBe(state.neutral(gateHalf()[0]!));
    expect(previewEdits(model, edits, null)).toBe(edits);
    // a value that is gone is not deleted twice
    expect(tryRemove(model, r.next, [id]).added).toEqual([]);
  });

  it("puts the deletions into the diff, as removed lines, and the revert patch undoes them", () => {
    const state = computeRemoval(model, ["p:gate.posts"]);
    const diffs = fileDiffs(model, new Map(), state);
    expect(diffs.length).toBe(1);
    const d = diffs[0]!;
    expect(d.structural).toBe(true);
    expect(d.removed).toBeGreaterThan(0);
    expect(d.patch).toContain("-");
    expect(d.revert.length).toBeGreaterThan(0);
    expect(d.after).not.toBe(d.before);
    expect(fileDiffs(model, new Map(), computeRemoval(model, [])).length).toBe(0);
  });

  it("lists the deleted items elements first, with their place in the code", () => {
    const ids = [valueItemId(gateHalf()), "p:hole.veil", "e:orbs"];
    const state = computeRemoval(model, ids);
    const views = removedViews(model, cat, state, ids, labelIndex(model));
    expect(views.map((v) => v.kind)).toEqual(["element", "part", "value"]);
    expect(views[1]!.where).toMatch(/GameRenderer\.kt:\d+/);
    expect(views[2]!.where).toMatch(/Simulation\.kt:\d+/);
    expect(views.every((v) => v.problem === undefined)).toBe(true);
  });

  it("keeps only saved ids this repo still has", () => {
    const ok = valueItemId(gateHalf());
    expect(validRemovals(model, cat, ["p:gate.posts", "p:nincs.ilyen", ok, "v:nincs", 7, "p:gate.posts"])).toEqual(["p:gate.posts", ok]);
    expect(kindOfId("a:x@1-2")).toBe("anim");
  });

  it("puts the value groups under the object they belong to", () => {
    const gates = model.elements.find((e) => e.id === "gates")!;
    const present = new Set(["gate", "mono", "ring", "lant"]);
    const { byObject, rest } = splitByObject(gates.groups, present);
    expect(byObject.get("gate")?.map((g) => g.label)).toContain("Kőkapu");
    expect(byObject.get("gate")?.map((g) => g.label)).toContain("Kapu energiahártyája");
    expect(rest.some((g) => g.label === "Kőkapu")).toBe(false);
    // an object this repo lacks takes no groups
    expect(splitByObject(gates.groups, new Set()).byObject.size).toBe(0);
  });

  it("lists every number of a part's code as sliders, across files, minus the curated ones", () => {
    const shown = new Set<string>();
    for (const key of ["ring.count", "ring.spin", "ring.r", "ring.y", "ring.w", "ring.h"]) for (const id of model.curated.get(key) ?? []) shown.add(id);
    // the fog of the fairy ring (GameRenderer.kt bGlowFog.add) had no sliders next to the ring's own values
    const fog = extraRows(model, cat, "p:ring.glow", shown);
    expect(fog.length).toBeGreaterThanOrEqual(6);
    expect(fog.every((r) => r.ids.length === 1 && r.code)).toBe(true);
    expect(fog.some((r) => r.label.startsWith("bGlowFog.add"))).toBe(true);
    const values = fog.map((r) => model.lits.get(r.ids[0]!)!.value);
    expect(values).toContain(2.6);
    expect(values).toContain(0.9);
    // curated numbers are not listed twice, and every row is a real literal of the repo
    const again = extraRows(model, cat, "p:ring.glow", new Set([...shown, ...fog.map((r) => r.ids[0]!)]));
    expect(again).toEqual([]);
    expect(fog.every((r) => model.lits.has(r.ids[0]!))).toBe(true);
    // items without code of their own (animations, elements) list nothing
    expect(extraRows(model, cat, "e:gates", shown)).toEqual([]);
  });
});
