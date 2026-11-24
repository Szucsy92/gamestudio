/**
 * Differences between the base repo and the tuned values: per-file unified diffs (git style, `a/` and `b/` paths
 * relative to the repo root, so `git apply` / `patch -p1` work in the repo folder), a folder tree summary, and the
 * way back: applying such a patch onto the base and reading the changed numbers out of it.
 */
import { patchSource, scanKotlin, type Literal } from "./scan";
import type { Model } from "./catalog";

export interface Change {
  lit: Literal;
  to: number;
}

/** Deletions on top of the number edits (removals.ts): the texts they give and which numbers went with them. */
export interface Removal {
  render: (edits: ReadonlyMap<string, number>) => Map<string, string>;
  litDead: (id: string) => boolean;
}

export interface FileDiff {
  path: string;
  before: string;
  after: string;
  changes: Change[];
  /** Lines deleted from this file (code taken out, not number edits). */
  removed: number;
  /** Something else than numbers changed (a deletion). */
  structural: boolean;
  /** The unified diff of this file alone ("" when nothing changed). */
  patch: string;
  /** The restore diff: tuned → base, for undoing the patch on a repo it was applied to. */
  revert: string;
  /** Changed lines. */
  lines: number;
}

export function changeList(model: Model, edits: ReadonlyMap<string, number>): Change[] {
  const out: Change[] = [];
  for (const [id, to] of edits) {
    const lit = model.lits.get(id);
    if (lit && Math.abs(lit.value - to) > 1e-12) out.push({ lit, to });
  }
  return out.sort((a, b) => a.lit.file.localeCompare(b.lit.file) || a.lit.start - b.lit.start);
}

export function fileDiffs(model: Model, edits: ReadonlyMap<string, number>, removal?: Removal | null): FileDiff[] {
  if (removal) return removalDiffs(model, edits, removal);
  const byFile = new Map<string, Change[]>();
  for (const c of changeList(model, edits)) {
    const a = byFile.get(c.lit.file);
    if (a) a.push(c);
    else byFile.set(c.lit.file, [c]);
  }
  const out: FileDiff[] = [];
  for (const [path, changes] of byFile) {
    const before = model.files.get(path)?.src;
    if (before === undefined) continue;
    const after = patchSource(
      before,
      changes.map((c) => c.lit),
      edits,
    );
    const patch = unifiedDiff(path, before, after);
    const revert = unifiedDiff(path, after, before);
    out.push({ path, before, after, changes, patch, revert, lines: new Set(changes.map((c) => c.lit.line)).size, removed: 0, structural: false });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function removalDiffs(model: Model, edits: ReadonlyMap<string, number>, removal: Removal): FileDiff[] {
  const texts = removal.render(edits);
  const byFile = new Map<string, Change[]>();
  for (const c of changeList(model, edits)) {
    if (removal.litDead(c.lit.id)) continue;
    const a = byFile.get(c.lit.file);
    if (a) a.push(c);
    else byFile.set(c.lit.file, [c]);
  }
  const out: FileDiff[] = [];
  for (const [path, after] of texts) {
    const before = model.kt.get(path) ?? model.files.get(path)?.src;
    if (before === undefined || before === after) continue;
    const changes = byFile.get(path) ?? [];
    const patch = unifiedDiff(path, before, after);
    const revert = unifiedDiff(path, after, before);
    const minus = patch.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
    const plus = patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    const numberLines = new Set(changes.map((c) => c.lit.line)).size;
    const structural = minus !== numberLines || plus !== numberLines;
    out.push({ path, before, after, changes, patch, revert, lines: Math.max(minus, plus), removed: Math.max(0, minus - plus), structural });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// ---- unified diff
interface Lines {
  lines: string[];
  /** The text ends with a newline. */
  eol: boolean;
}

function splitLines(s: string): Lines {
  const lines = s.split("\n");
  const eol = lines[lines.length - 1] === "";
  if (eol) lines.pop();
  return { lines, eol };
}

interface Op {
  t: " " | "-" | "+";
  text: string;
  a: number;
  b: number;
}

/** Line operations from a to b: common head and tail, the middle line by line when the counts match, else by LCS. */
function lineOps(A: string[], B: string[]): Op[] {
  let head = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head++;
  let tail = 0;
  while (tail < A.length - head && tail < B.length - head && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail++;
  const ops: Op[] = [];
  for (let i = 0; i < head; i++) ops.push({ t: " ", text: A[i]!, a: i, b: i });
  const a0 = head, a1 = A.length - tail, b0 = head, b1 = B.length - tail;
  if (a1 - a0 === b1 - b0) {
    for (let i = a0; i < a1; ) {
      if (A[i] === B[i - a0 + b0]) {
        ops.push({ t: " ", text: A[i]!, a: i, b: i - a0 + b0 });
        i++;
        continue;
      }
      let j = i;
      while (j < a1 && A[j] !== B[j - a0 + b0]) j++;
      for (let k = i; k < j; k++) ops.push({ t: "-", text: A[k]!, a: k, b: -1 });
      for (let k = i; k < j; k++) ops.push({ t: "+", text: B[k - a0 + b0]!, a: -1, b: k - a0 + b0 });
      i = j;
    }
  } else {
    const n = a1 - a0, m = b1 - b0;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = A[a0 + i] === B[b0 + j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[a0 + i] === B[b0 + j]) ops.push({ t: " ", text: A[a0 + i]!, a: a0 + i++, b: b0 + j++ });
      else if (j < m && (i === n || L[i]![j + 1]! >= L[i + 1]![j]!)) ops.push({ t: "+", text: B[b0 + j]!, a: -1, b: b0 + j++ });
      else ops.push({ t: "-", text: A[a0 + i]!, a: a0 + i++, b: -1 });
    }
  }
  for (let i = 0; i < tail; i++) ops.push({ t: " ", text: A[a1 + i]!, a: a1 + i, b: b1 + i });
  return ops;
}

const FUN_LINE = /^\s*(?:(?:private|internal|public|protected|override|inline|suspend|data|enum|abstract|open)\s+)*(?:fun|object|class|interface)\b/;

/** One file's unified diff with `context` lines around each change; "" when the texts are equal. */
export function unifiedDiff(path: string, before: string, after: string, context = 3): string {
  if (before === after) return "";
  const A = splitLines(before), B = splitLines(after);
  const ops = lineOps(A.lines, B.lines);
  const changed = ops.flatMap((o, i) => (o.t === " " ? [] : [i]));
  if (!changed.length) {
    // Only the newline at the end differs.
    changed.push(ops.length - 1);
  }
  const ranges: [number, number][] = [];
  for (const i of changed) {
    const s = Math.max(0, i - context), e = Math.min(ops.length, i + context + 1);
    const last = ranges[ranges.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else ranges.push([s, e]);
  }
  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  let aSeen = 0, bSeen = 0, cursor = 0;
  for (const [s, e] of ranges) {
    for (; cursor < s; cursor++) {
      if (ops[cursor]!.t !== "+") aSeen++;
      if (ops[cursor]!.t !== "-") bSeen++;
    }
    const body: string[] = [];
    let aLen = 0, bLen = 0;
    for (let i = s; i < e; i++) {
      const o = ops[i]!;
      body.push(o.t + o.text);
      if (o.t !== "+") aLen++;
      if (o.t !== "-") bLen++;
      const lastA = o.t !== "+" && o.a === A.lines.length - 1 && !A.eol;
      const lastB = o.t !== "-" && o.b === B.lines.length - 1 && !B.eol;
      if (lastA || lastB) body.push("\\ No newline at end of file");
    }
    let fn = "";
    for (let k = (ops[s]!.a >= 0 ? ops[s]!.a : aSeen) - 1; k >= 0 && k > aSeen - 400; k--) {
      if (FUN_LINE.test(A.lines[k]!)) {
        fn = " " + A.lines[k]!.trim().slice(0, 60);
        break;
      }
    }
    out.push(`@@ -${aLen ? aSeen + 1 : aSeen},${aLen} +${bLen ? bSeen + 1 : bSeen},${bLen} @@${fn}`, ...body);
    for (; cursor < e; cursor++) {
      if (ops[cursor]!.t !== "+") aSeen++;
      if (ops[cursor]!.t !== "-") bSeen++;
    }
  }
  return out.join("\n") + "\n";
}

/** All files' diffs as one patch (or, with `revert`, the restore patch), with a comment header (ignored by git apply and patch). */
export function buildPatch(diffs: FileDiff[], header: string[] = [], revert = false): string {
  const head = header.length ? header.map((l) => `# ${l}`).join("\n") + "\n\n" : "";
  return head + diffs.map((d) => (revert ? d.revert : d.patch)).join("");
}

/** Restore patch for files changed outside the slider edits (a patch applied as a new base): new → old text. */
export function restorePatch(oldTexts: ReadonlyMap<string, string>, newTexts: ReadonlyMap<string, string>, header: string[] = []): string {
  const head = header.length ? header.map((l) => `# ${l}`).join("\n") + "\n\n" : "";
  return head + [...newTexts.keys()].sort().map((p) => unifiedDiff(p, newTexts.get(p)!, oldTexts.get(p) ?? "")).join("");
}

// ---- folder tree
export interface DirNode {
  name: string;
  path: string;
  dirs: DirNode[];
  files: FileDiff[];
  /** Changed values below this folder. */
  count: number;
  fileCount: number;
}

export function folderTree(diffs: FileDiff[]): DirNode {
  const root: DirNode = { name: "", path: "", dirs: [], files: [], count: 0, fileCount: 0 };
  for (const d of diffs) {
    const parts = d.path.split("/");
    parts.pop();
    let node = root;
    node.count += d.changes.length;
    node.fileCount++;
    for (const p of parts) {
      let next = node.dirs.find((x) => x.name === p);
      if (!next) node.dirs.push((next = { name: p, path: node.path ? `${node.path}/${p}` : p, dirs: [], files: [], count: 0, fileCount: 0 }));
      next.count += d.changes.length;
      next.fileCount++;
      node = next;
    }
    node.files.push(d);
  }
  // app/src/main/java/com/… → one entry when the folders in between hold nothing else.
  const squash = (n: DirNode): DirNode => {
    n.dirs = n.dirs.map(squash);
    if (n.name && n.files.length === 0 && n.dirs.length === 1) {
      const c = n.dirs[0]!;
      return { ...c, name: `${n.name}/${c.name}` };
    }
    return n;
  };
  root.dirs = root.dirs.map(squash);
  const sort = (n: DirNode) => {
    n.dirs.sort((a, b) => a.name.localeCompare(b.name));
    n.files.sort((a, b) => a.path.localeCompare(b.path));
    n.dirs.forEach(sort);
  };
  sort(root);
  return root;
}

export function countDirs(n: DirNode): number {
  return n.dirs.reduce((a, d) => a + 1 + countDirs(d), 0);
}

/** The folder tree as text (for CHANGES.md and the clipboard). */
export function treeText(root: DirNode): string {
  const out: string[] = [];
  const walk = (n: DirNode, prefix: string) => {
    const items: ({ dir: DirNode } | { file: FileDiff })[] = [...n.dirs.map((dir) => ({ dir })), ...n.files.map((file) => ({ file }))];
    items.forEach((it, i) => {
      const last = i === items.length - 1;
      const branch = prefix + (last ? "└─ " : "├─ ");
      if ("dir" in it) {
        out.push(`${branch}${it.dir.name}/  (${it.dir.count} érték, ${it.dir.fileCount} fájl)`);
        walk(it.dir, prefix + (last ? "   " : "│  "));
      } else out.push(`${branch}${it.file.path.split("/").pop()}  (${it.file.changes.length} érték, ${it.file.lines} sor)`);
    });
  };
  walk(root, "");
  return out.join("\n");
}

// ---- applying a patch
interface Hunk {
  oldStart: number;
  old: string[];
  neu: string[];
  noEolOld: boolean;
  noEolNew: boolean;
}

interface FilePatch {
  path: string;
  hunks: Hunk[];
}

function patchPath(s: string): string {
  let p = s.replace(/\r$/, "").split("\t")[0]!.trim();
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  return p;
}

export function parsePatch(text: string): FilePatch[] {
  const L = text.split("\n");
  const files: FilePatch[] = [];
  for (let i = 0; i < L.length; i++) {
    if (!L[i]!.startsWith("--- ") || !L[i + 1]?.startsWith("+++ ")) continue;
    const from = patchPath(L[i]!.slice(4));
    const to = patchPath(L[i + 1]!.slice(4));
    if (from === "/dev/null" || to === "/dev/null") throw new Error(`A patch új vagy törölt fájlt tartalmaz (${from === "/dev/null" ? to : from}); csak meglévő fájlok módosítása alkalmazható.`);
    const fp: FilePatch = { path: to.replace(/^b\//, ""), hunks: [] };
    i += 2;
    while (i < L.length && L[i]!.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(L[i]!);
      if (!m) throw new Error(`Hibás @@ sor: ${L[i]}`);
      let oldLeft = m[2] === undefined ? 1 : Number(m[2]);
      let newLeft = m[4] === undefined ? 1 : Number(m[4]);
      const h: Hunk = { oldStart: Number(m[1]), old: [], neu: [], noEolOld: false, noEolNew: false };
      let lastKind = " ";
      i++;
      while (i < L.length && (oldLeft > 0 || newLeft > 0 || L[i]!.startsWith("\\"))) {
        const line = L[i]!;
        const c = line[0] ?? " ";
        const body = line.slice(1);
        if (c === "\\") {
          if (lastKind !== "+") h.noEolOld = true;
          if (lastKind !== "-") h.noEolNew = true;
        } else if (c === " " || line === "") {
          h.old.push(body);
          h.neu.push(body);
          oldLeft--;
          newLeft--;
        } else if (c === "-") {
          h.old.push(body);
          oldLeft--;
        } else if (c === "+") {
          h.neu.push(body);
          newLeft--;
        } else break;
        lastKind = c === "\\" ? lastKind : c === "" ? " " : c;
        i++;
      }
      fp.hunks.push(h);
    }
    i--;
    files.push(fp);
  }
  if (!files.length) throw new Error("Ebben a fájlban nincs alkalmazható diff (--- / +++ / @@ sorok).");
  return files;
}

/** The repo file a patch path means: exact, without leading folders (a patch made one level up), or by its tail. */
export function resolvePatchPath(path: string, paths: readonly string[]): string | undefined {
  const set = new Set(paths);
  const clean = path.replace(/^a\//, "");
  if (set.has(clean)) return clean;
  const parts = clean.split("/");
  for (let k = 1; k < parts.length; k++) {
    const p = parts.slice(k).join("/");
    if (set.has(p)) return p;
  }
  const tail = paths.filter((p) => p.endsWith(`/${clean}`));
  return tail.length === 1 ? tail[0] : undefined;
}

/** Applies every hunk of the patch; returns the new text of each touched file. Throws when a hunk does not fit. */
export function applyPatch(patch: string, paths: readonly string[], read: (path: string) => string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const fp of parsePatch(patch)) {
    const path = resolvePatchPath(fp.path, paths);
    const src = path ? out.get(path) ?? read(path) : undefined;
    if (!path || src === undefined) throw new Error(`A patch fájlja nincs a repóban: ${fp.path}`);
    const crlf = src.includes("\r\n");
    const doc = splitLines(crlf ? src.replace(/\r\n/g, "\n") : src);
    const strip = (l: string) => (l.endsWith("\r") ? l.slice(0, -1) : l);
    let delta = 0;
    for (const h of fp.hunks) {
      const old = h.old.map(strip), neu = h.neu.map(strip);
      const want = Math.max(0, h.oldStart - 1 + delta - (old.length ? 0 : -1));
      const fits = (at: number) => at >= 0 && at + old.length <= doc.lines.length && old.every((l, k) => doc.lines[at + k] === l);
      let at = -1;
      for (let d = 0; d <= doc.lines.length; d++) {
        if (fits(want - d)) {
          at = want - d;
          break;
        }
        if (fits(want + d)) {
          at = want + d;
          break;
        }
      }
      if (at < 0) throw new Error(`A patch nem illeszkedik: ${path}, ${h.oldStart}. sor környéke eltér a repótól.`);
      doc.lines.splice(at, old.length, ...neu);
      delta += neu.length - old.length;
      if (h.noEolNew) doc.eol = false;
      else if (h.noEolOld) doc.eol = true;
    }
    let text = doc.lines.join("\n") + (doc.eol ? "\n" : "");
    if (crlf) text = text.replace(/\n/g, "\r\n");
    out.set(path, text);
  }
  return out;
}

/** The source with every number cut out: equal skeletons mean only numbers differ. */
function skeleton(src: string, lits: readonly { start: number; end: number }[]) {
  let s = "", at = 0;
  for (const l of lits) {
    s += src.slice(at, l.start) + "\u0000";
    at = l.end;
  }
  return s + src.slice(at);
}

/**
 * Reads the patched files back as value edits on the base repo. Files where more than numbers changed (or that
 * the studio does not scan) are listed in `structural`; their numbers cannot become slider values.
 */
export function editsFromPatched(model: Model, patched: ReadonlyMap<string, string>): { edits: Map<string, number>; structural: string[] } {
  const edits = new Map<string, number>();
  const structural: string[] = [];
  for (const [path, after] of patched) {
    const f = model.files.get(path);
    if (!f) {
      structural.push(path);
      continue;
    }
    const oldLits = [...f.byStart.values()].sort((a, b) => a.start - b.start);
    const newLits = scanKotlin(path, after).sort((a, b) => a.start - b.start);
    if (oldLits.length !== newLits.length || skeleton(f.src, oldLits) !== skeleton(after, newLits)) {
      structural.push(path);
      continue;
    }
    oldLits.forEach((l, i) => {
      const v = newLits[i]!.value;
      if (Math.abs(v - l.value) > 1e-12) edits.set(l.id, v);
    });
  }
  return { edits, structural };
}
