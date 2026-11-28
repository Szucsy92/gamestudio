/**
 * A TS motor adattábláiból (kurált sorok, magyar címkék, a fa-szakasz jelölői) Kotlin forrást állít elő:
 *   tsx --tsconfig tsconfig.json android/tools/gen-studio-data.ts
 * Futtasd újra, ha a src/studio/curated.ts vagy a catalog.ts címketáblái változnak.
 */
import { writeFileSync } from "node:fs";
import { COMMON_WORDS, LABELS } from "../../src/studio/catalog";
import { CURATED } from "../../src/studio/curated";
import { SECTION_END, SECTION_START } from "../../src/tree/kotlin";
import { PARAM_SPECS } from "../../src/tree/params";

const s = (v: string) => '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/\n/g, "\\n") + '"';
const num = (v: number | undefined) => (v === undefined ? "null" : Number.isInteger(v) ? `${v}.0` : String(v));
const opt = (v: string | undefined) => (v === undefined ? "null" : s(v));

const lines: string[] = [];
lines.push("// GENERÁLT FÁJL – ne szerkeszd kézzel. Forrás: android/tools/gen-studio-data.ts (src/studio/curated.ts, catalog.ts).");
lines.push("package hu.gamestudio.app.studio");
lines.push("");
lines.push(`const val SECTION_START = ${s(SECTION_START)}`);
lines.push(`const val SECTION_END = ${s(SECTION_END)}`);
lines.push("");
lines.push("/** A fa-szerkesztő tömbjeinek Kotlin-nevei (TREE_*): ezek jelzik, hogy a repó fa-szakasza hangolható. */");
lines.push(`val TREE_ARRAYS: Set<String> = setOf(${PARAM_SPECS.map((p) => s(p.kt)).join(", ")})`);
lines.push("");
lines.push("val CURATED: List<CuratedDef> = listOf(");
for (const c of CURATED) {
  const src =
    "decl" in c.src
      ? `CuratedSrc.Decl(${s(c.src.file)}, ${s(c.src.decl)})`
      : `CuratedSrc.Pattern(${s(c.src.file)}, ${s(c.src.find)}, listOf(${c.src.pick.join(", ")}), ${opt(c.src.after)}, ${c.src.nth ?? "null"}, ${c.src.all ? "true" : "false"})`;
  lines.push(`    CuratedDef(${s(c.key)}, ${s(c.element)}, ${s(c.group)}, ${s(c.label)}, ${opt(c.hint)}, ${opt(c.unit)}, ${s(c.kind ?? "num")}, ${num(c.min)}, ${num(c.max)}, ${num(c.step)}, ${src}),`);
}
lines.push(")");
lines.push("");
lines.push("/** A játék névvel ellátott értékeinek magyar neve (és mértékegysége). */");
lines.push("val LABELS: Map<String, Pair<String, String?>> = mapOf(");
for (const [k, v] of Object.entries(LABELS)) lines.push(`    ${s(k)} to Pair(${s(v[0])}, ${opt(v[1])}),`);
lines.push(")");
lines.push("");
lines.push("val COMMON_WORDS: Map<String, String> = mapOf(");
for (const [k, v] of Object.entries(COMMON_WORDS)) lines.push(`    ${s(k)} to ${s(v)},`);
lines.push(")");
lines.push("");
writeFileSync(new URL("../app/src/main/java/hu/gamestudio/app/studio/StudioData.kt", import.meta.url), lines.join("\n"));
console.log("kész:", CURATED.length, "kurált sor,", Object.keys(LABELS).length, "címke,", Object.keys(COMMON_WORDS).length, "szó");
