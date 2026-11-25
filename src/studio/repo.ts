/**
 * The loaded game repo: read from a ZIP, kept in the browser (IndexedDB) so it survives a reload, and written back as
 * a ZIP with the changed Kotlin files patched in place. Everything else in the repo is copied byte for byte.
 */
import JSZip from "jszip";
import defaultRepoAsset from "@/assets/repo/default-repo.zip.asset.json";
import { formatLiteral, type Literal } from "./scan";
import { buildPatch, changeList, countDirs, fileDiffs, folderTree, treeText, type Removal } from "./diff";
import type { Model } from "./catalog";
import { buildTree, MAX_VERTICES } from "@/tree/mesh";
import { toObj } from "@/tree/obj";
import { upgradeTreeKotlin } from "@/tree/kotlin";
import { PARAM_SPECS, SPECIES, type SpeciesParams } from "@/tree/params";

export interface RepoData {
  name: string;
  /** Top folder inside the ZIP ("" when the files sit at the top level). */
  root: string;
  files: Map<string, Uint8Array>;
  texts: Map<string, string>;
  size: number;
  source: "builtin" | "upload";
  loadedAt: string;
  /** Files whose code the studio brought up to date when loading (e.g. the tree section of Meshes.kt got its triangle-count arrays). */
  upgraded?: string[];
}

/** Folder the studio adds next to the repo in its export; ignored when such a ZIP is loaded back. */
export const STUDIO_DIR = "GameStudio";
export const DEFAULT_REPO_URL = defaultRepoAsset.url;
export const DEFAULT_REPO_NAME = "woodland-weave-run 2.0.0 (build 586)";

export function repoKey(r: Pick<RepoData, "name" | "size" | "loadedAt">) {
  return `${r.name}|${r.size}|${r.loadedAt}`;
}

export async function parseRepoZip(data: ArrayBuffer, name: string, source: RepoData["source"], loadedAt = new Date().toISOString()): Promise<RepoData> {
  const zip = await JSZip.loadAsync(data);
  const entries = Object.values(zip.files).filter(
    (e) => !e.dir && !e.name.startsWith("__MACOSX/") && !/(^|\/)\.git\//.test(e.name) && !e.name.startsWith(`${STUDIO_DIR}/`) && !/(^|\/)\.DS_Store$/.test(e.name),
  );
  if (!entries.length) throw new Error("A ZIP üres.");
  const firsts = new Set(entries.map((e) => (e.name.includes("/") ? e.name.split("/")[0] : "")));
  const root = firsts.size === 1 && !firsts.has("") ? [...firsts][0]! : "";
  const files = new Map<string, Uint8Array>();
  const texts = new Map<string, string>();
  const dec = new TextDecoder();
  await Promise.all(
    entries.map(async (e) => {
      const rel = root ? e.name.slice(root.length + 1) : e.name;
      const bytes = await e.async("uint8array");
      files.set(rel, bytes);
      if (rel.endsWith(".kt")) texts.set(rel, dec.decode(bytes));
    }),
  );
  // An older tree section gets the arrays that make the triangle count tunable (same behaviour until they are changed).
  const upgraded: string[] = [];
  for (const [rel, text] of texts) {
    if (!rel.endsWith("/Meshes.kt")) continue;
    const up = upgradeTreeKotlin(text);
    if (up === null) continue;
    texts.set(rel, up);
    files.set(rel, new TextEncoder().encode(up));
    upgraded.push(rel);
  }
  if (![...texts.keys()].some((p) => p.endsWith("/Meshes.kt") || p.endsWith("/Simulation.kt") || p.endsWith("/GameRenderer.kt"))) {
    throw new Error("Ebben a ZIP-ben nincs a játék Kotlin kódja (Meshes.kt, GameRenderer.kt, Simulation.kt).");
  }
  return { name, root, files, texts, size: data.byteLength, source, loadedAt, ...(upgraded.length ? { upgraded } : {}) };
}

// ---- IndexedDB: one record, the raw ZIP of the current base repo.
const DB = "gamestudio";
const STORE = "repo";
interface Stored {
  name: string;
  data: ArrayBuffer;
  source: RepoData["source"];
  loadedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveStoredRepo(s: Stored): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(s, "current");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadStoredRepo(): Promise<Stored | null> {
  try {
    const db = await openDb();
    const out = await new Promise<Stored | null>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get("current");
      req.onsuccess = () => resolve((req.result as Stored | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return out;
  } catch {
    return null;
  }
}

export async function clearStoredRepo(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete("current");
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

/** The stored repo, or the built-in one on first start. */
export async function openStartRepo(onStatus: (s: string) => void): Promise<RepoData> {
  const stored = await loadStoredRepo();
  if (stored) {
    onStatus(`${stored.name} betöltése…`);
    try {
      return await parseRepoZip(stored.data, stored.name, stored.source, stored.loadedAt);
    } catch {
      await clearStoredRepo();
    }
  }
  onStatus("Beépített repo letöltése…");
  const res = await fetch(DEFAULT_REPO_URL);
  if (!res.ok) throw new Error(`A beépített repo nem tölthető le (${res.status}).`);
  const data = await res.arrayBuffer();
  onStatus("Repo kicsomagolása…");
  return parseRepoZip(data, DEFAULT_REPO_NAME, "builtin", "builtin");
}

// ---- Export
export interface ExportInput {
  repo: RepoData;
  model: Model;
  /** All literal edits, the tree's included. */
  edits: Map<string, number>;
  species: SpeciesParams;
  speciesCount: number;
  activeSpecies: number;
  soilBottom: boolean;
  /** Deleted elements, parts, animations and values (applied on top of the edits). */
  removal?: Removal | null;
  /** Names of what was deleted, for CHANGES.md. */
  removedLabels?: string[];
}

function stamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

function labelOf(l: Literal) {
  return l.decl ? `${l.section} · ${l.decl}` : l.section;
}

export { changeList };

export function tuningJson(species: SpeciesParams, count: number, active: number) {
  return JSON.stringify(
    {
      format: "gamestudio-tree/1",
      exportedAt: new Date().toISOString(),
      activeSpecies: active,
      species: SPECIES.slice(0, count).map((s, i) => ({ id: s.id, name: s.kt, label: s.label, params: species[i] })),
      kotlinNames: Object.fromEntries(PARAM_SPECS.map((s) => [s.key, s.kt])),
    },
    null,
    2,
  );
}

/** The header of a GameStudio patch: what it is based on and how to apply it. */
export function patchHeader(repo: RepoData, values: number, files: number, revert = false, removed: string[] = []): string[] {
  const del = removed.length ? [`Törölve (minden hivatkozásával): ${removed.join(", ")}`] : [];
  if (revert)
    return [
      `GameStudio VISSZAÁLLÍTÓ patch – ${stamp()}`,
      `Az alap (${repo.name}) eredeti állapotát állítja vissza egy olyan repón, amelyre a GameStudio patch-et már alkalmazták.`,
      `${values} érték${removed.length ? ` és ${removed.length} törlés` : ""} visszaállítása, ${files} fájlban.`,
      `Alkalmazás a repó gyökérmappájában: git apply <fájl>.patch   vagy   patch -p1 < <fájl>.patch`,
    ];
  return [
    `GameStudio patch – ${stamp()}`,
    `Alap: ${repo.name}${repo.upgraded?.length ? " (a fa-szakasz frissítve: TREE_MIN_SIDES, TREE_FLARE_ROWS – a patch a frissített Meshes.kt-ra készült)" : ""}`,
    `${values} módosított érték${removed.length ? `, ${removed.length} törlés` : ""}, ${files} fájlban.`,
    ...del,
    `Alkalmazás a repó gyökérmappájában: git apply <fájl>.patch   vagy   patch -p1 < <fájl>.patch`,
    `Visszavonás: a mellékelt revert.patch alkalmazása (vagy git apply -R <fájl>.patch)`,
  ];
}

export async function buildRepoZip(input: ExportInput): Promise<Blob> {
  const { repo, model, edits } = input;
  const diffs = fileDiffs(model, edits, input.removal);
  const removed = input.removedLabels ?? [];
  const changes = diffs.flatMap((d) => d.changes);
  const after = new Map(diffs.map((d) => [d.path, d.after]));
  const zip = new JSZip();
  const rootName = repo.root || "repo";
  const root = zip.folder(rootName)!;
  for (const [path, bytes] of repo.files) {
    const text = after.get(path);
    root.file(path, text ?? bytes);
  }
  const studio = zip.folder(STUDIO_DIR)!;
  const rows = changes.map(({ lit, to }) => `| \`${lit.file.split("/").pop()}:${lit.line}\` | ${labelOf(lit)} | \`${lit.raw}\` | \`${formatLiteral(lit, to)}\` |`);
  const warnings: string[] = [];
  const sp = SPECIES[input.activeSpecies]!;
  for (let shape = 0; shape < 4; shape++) {
    const m = buildTree(input.species[input.activeSpecies]!, input.activeSpecies, shape, { lifelike: true, soilBottom: input.soilBottom });
    if (m.vertexCount > MAX_VERTICES) warnings.push(`${sp.label}, shape ${shape}: ${m.vertexCount} csúcspont – több, mint a GLES határ (${MAX_VERTICES}).`);
    studio.file(`mesh/tree_body_${sp.kt}_shape${shape}.obj`, toObj(m, `tree_body_${sp.kt}_shape${shape}`, [`GameStudio – ${sp.label}, shape ${shape}`, "units: meters, Y up, soil at y = 1.1"]));
  }
  studio.file("TreeTuning.json", tuningJson(input.species, input.speciesCount, input.activeSpecies));
  if (diffs.length) {
    studio.file("changes.patch", buildPatch(diffs, patchHeader(repo, changes.length, diffs.length, false, removed)));
    for (const d of diffs) studio.file(`patches/${d.path}.patch`, d.patch);
    studio.file("revert.patch", buildPatch(diffs, patchHeader(repo, changes.length, diffs.length, true, removed), true));
    for (const d of diffs) studio.file(`patches-revert/${d.path}.patch`, d.revert);
  }
  const tree = folderTree(diffs);
  studio.file(
    "CHANGES.md",
    `# GameStudio export (${stamp()})

Alap: **${repo.name}**.${repo.upgraded?.length ? ` A betöltéskor a fa-kód frissült (${repo.upgraded.join(", ")}): új tömbök a háromszögszám állításához, az alapértékek az eredeti viselkedést adják.` : ""} A \`${rootName}/\` mappa a teljes repo; csak az alábbi ${removed.length ? "számok és törlések" : "számok"} változtak, minden más bájtra azonos.
${changes.length} módosított érték${removed.length ? `, ${removed.length} törlés` : ""}, ${diffs.length} fájlban, ${countDirs(tree)} mappában.
${removed.length ? `\n## Törölve (minden hivatkozásával együtt)\n\n${removed.map((r) => `- ${r}`).join("\n")}\n` : ""}
${warnings.length ? `\n> **Figyelem:**\n${warnings.map((w) => `> - ${w}`).join("\n")}\n` : ""}
Ha ezt a ZIP-et visszatöltöd a GameStudióba, ezek az értékek lesznek az új alapértékek.
${
  diffs.length
    ? `
## Mappák szerint

\`\`\`
${tree.dirs.length || tree.files.length ? treeText(tree) : ""}
\`\`\`

## Patch

- \`${STUDIO_DIR}/changes.patch\` – az összes változás egy fájlban (unified diff, git formátum).
- \`${STUDIO_DIR}/patches/<útvonal>.patch\` – ugyanez fájlonként, a repó mappaszerkezetében.
- \`${STUDIO_DIR}/revert.patch\` – **visszaállító patch**: ha a changes.patch alkalmazása után gond van, ez visszaállítja az alap repó eredeti értékeit.
- \`${STUDIO_DIR}/patches-revert/<útvonal>.patch\` – a visszaállító patch fájlonként.

Alkalmazás az eredeti repó gyökerében: \`git apply changes.patch\` vagy \`patch -p1 < changes.patch\`.
Visszaállítás: \`git apply revert.patch\` vagy \`patch -p1 < revert.patch\` (egyenértékű: \`git apply -R changes.patch\`).
A GameStudióba is visszatölthető (Változások → Patch alkalmazása).
`
    : ""
}
## Értékek

| Hely | Mi | Régi | Új |
| --- | --- | --- | --- |
${rows.join("\n") || "| – | nincs változás | | |"}
`,
  );
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/** A new base repo: the current one with some files replaced (a patch that changes more than numbers). */
export async function repoWithFiles(repo: RepoData, replaced: ReadonlyMap<string, string>, name: string): Promise<{ repo: RepoData; data: ArrayBuffer }> {
  const zip = new JSZip();
  const folder = repo.root ? zip.folder(repo.root)! : zip;
  const enc = new TextEncoder();
  for (const [path, bytes] of repo.files) folder.file(path, replaced.has(path) ? enc.encode(replaced.get(path)!) : bytes);
  const data = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { repo: await parseRepoZip(data, name, "upload"), data };
}

/** The text of any repo file (Kotlin from the cache, others decoded). */
export function readRepoText(repo: RepoData, path: string): string | undefined {
  const t = repo.texts.get(path);
  if (t !== undefined) return t;
  const b = repo.files.get(path);
  return b ? new TextDecoder().decode(b) : undefined;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
