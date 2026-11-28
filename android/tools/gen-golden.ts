/**
 * A natív port ellenőrző adatai: a TS motor kimenete a src/kotlin mintafájlokon. A Kotlin teszt (StudioGoldenTest)
 * ugyanezeket számolja ki, és összeveti. Újragenerálás, ha a TS motor viselkedése szándékosan változik:
 *   tsx --tsconfig tsconfig.json android/tools/gen-golden.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildModel, type Group } from "../../src/studio/catalog";
import { formatLiteral, patchSource } from "../../src/studio/scan";

const FIXTURES: [string, string][] = [
  ["app/src/main/java/x/gl/GameRenderer.kt", "GameRenderer.kt"],
  ["app/src/main/java/x/sim/Simulation.kt", "Simulation.kt"],
  ["app/src/main/java/x/gl/Quality.kt", "Quality.kt"],
  ["app/src/main/java/x/gl/Shaders.kt", "Shaders.kt"],
  ["app/src/main/java/x/gl/Meshes.kt", "Meshes_Reference_Tree.kt"],
];
const texts = new Map(FIXTURES.map(([p, f]) => [p, readFileSync(new URL(`../../src/kotlin/${f}`, import.meta.url), "utf8")]));
const model = buildModel(texts);
const out = new URL("../app/src/test/resources/golden/", import.meta.url);
mkdirSync(out, { recursive: true });
const n = (v: number) => String(v);
const o = (v: string | undefined) => v ?? "-";

// 1. literálok
const scan: string[] = [];
for (const l of model.lits.values()) {
  scan.push([l.id, l.start, l.end, l.raw, n(l.value), l.kind, l.suffix || "-", l.leadingDot, l.upperHex, l.glsl, l.section, o(l.decl), o(l.declBase), l.inFunction, l.line, l.stmtLine].join("\t"));
}
writeFileSync(new URL("scan.tsv", out), scan.join("\n") + "\n");

// 2. katalógus
const cat: string[] = [];
const walk = (gs: Group[], depth: number, withRows: boolean) => {
  for (const g of gs) {
    cat.push(["G", depth, g.id, g.label, g.rows.length].join("\t"));
    // a Kód elem sorai a literálokból következnek (a scan.tsv már ellenőrzi őket): csak a csoportok számítanak
    if (withRows) for (const r of g.rows) cat.push(["R", r.key, r.label, o(r.hint), o(r.unit), r.kind, r.ids.join(","), n(r.range.min), n(r.range.max), n(r.range.step), r.range.int, r.code].join("\t"));
    if (g.sub) walk(g.sub, depth + 1, withRows);
  }
};
for (const e of model.elements) {
  cat.push(["E", e.id, e.label, e.short, e.scene, o(e.section), o(e.file)].join("\t"));
  walk(e.groups, 0, e.id !== "code");
}
for (const [k, ids] of model.curated) cat.push(["C", k, ids.join(",")].join("\t"));
writeFileSync(new URL("model.tsv", out), cat.join("\n") + "\n");

// 3. kiírás és átírás: minden 7. literál új értéket kap
const edits = new Map<string, number>();
let i = 0;
for (const l of model.lits.values()) if (i++ % 7 === 0) edits.set(l.id, l.kind === "bool" ? (l.value >= 0.5 ? 0 : 1) : l.kind === "hex" ? 0x123456 + (i % 200) : l.value * 1.37 + 0.123);
const ed: string[] = [];
for (const [id, v] of edits) ed.push(["F", id, n(v), formatLiteral(model.lits.get(id)!, v)].join("\t"));
for (const [path, src] of texts) {
  const lits = [...model.files.get(path)!.byStart.values()];
  const patched = patchSource(src, lits, edits);
  ed.push(["P", path, createHash("sha256").update(patched, "utf8").digest("hex"), patched.length].join("\t"));
}
writeFileSync(new URL("edits.tsv", out), ed.join("\n") + "\n");
console.log("literálok:", scan.length, "· katalógus-sorok:", cat.length, "· szerkesztések:", edits.size);
