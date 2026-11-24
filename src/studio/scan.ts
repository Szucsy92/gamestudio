/**
 * Finds every tunable number in a Kotlin source file (and in the GLSL inside its raw strings), with enough context to
 * label it, and writes changed values back into the exact same spot. Pure TypeScript: no React, no three.js.
 */

export type LitKind = "int" | "long" | "float" | "double" | "hex";

export interface Literal {
  /** `${file}#${ordinal}`: stable for one loaded repo. */
  id: string;
  file: string;
  ordinal: number;
  /** Span in the source, including a unary minus. */
  start: number;
  end: number;
  raw: string;
  value: number;
  kind: LitKind;
  suffix: string;
  leadingDot: boolean;
  upperHex: boolean;
  glsl: boolean;
  /** "GameRenderer.drawLandmarks", "Palette", "Shaders.LIT_FS" … */
  section: string;
  /** Declaration label for class-/file-level values: "GATE_HALF", "SUN.minElDeg", "odd[3]". */
  decl?: string;
  /** Declaration without the index: "odd" for "odd[3]". */
  declBase?: string;
  inFunction: boolean;
  line: number;
  /** Line where the statement starts (for the KDoc above it). */
  stmtLine: number;
}

const ID_CHAR = /[A-Za-z0-9_]/;
const NUM_RE = /0[xX][0-9a-fA-F_]+[lL]?|(?:\d[\d_]*)?\.\d[\d_]*(?:[eE][-+]?\d+)?[fF]?|\d[\d_]*(?:[eE][-+]?\d+)?[fFL]?/y;
const GLSL_NUM_RE = /(?:\d+)?\.\d+(?:[eE][-+]?\d+)?[fF]?|\d+\.(?![\d.A-Za-z_])(?:[eE][-+]?\d+)?|\d+(?:[eE][-+]?\d+)?/y;
/** Arguments of these calls are seeds, sizes or GL enums, not looks. */
const SKIP_CALLS = new Set([
  "hash", "rnd", "r", "h", "FloatArray", "IntArray", "ShortArray", "DoubleArray", "ByteArray", "BooleanArray", "LongArray",
  "ArrayList", "HashMap", "arrayOfNulls", "copyOf", "allocateDirect", "sleep", "layout", "Color", "toInt", "shl", "shr",
]);
const UNARY_BEFORE = new Set(["(", ",", "=", ":", "[", "{", "+", "-", "*", "/", "%", "<", ">", "!", "?", "&", "|", "^"]);

function lineStarts(src: string): number[] {
  const out = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}

export function lineAt(starts: number[], pos: number): number {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function parseValue(raw: string): { value: number; kind: LitKind; suffix: string } | null {
  const clean = raw.replace(/_/g, "");
  if (/^0[xX]/.test(clean)) {
    const digits = clean.slice(2).replace(/[lL]$/, "");
    if (digits.length !== 6) return null; // only RGB colours are tunable as hex
    return { value: parseInt(digits, 16), kind: "hex", suffix: "" };
  }
  const suffix = /[fFL]$/.test(clean) ? clean.slice(-1) : "";
  const body = suffix ? clean.slice(0, -1) : clean;
  const value = parseFloat(body);
  if (!Number.isFinite(value)) return null;
  const isFrac = /[.eE]/.test(body);
  const kind: LitKind = suffix === "f" || suffix === "F" ? "float" : suffix === "L" ? "long" : isFrac ? "double" : "int";
  return { value, kind, suffix };
}

interface Scope {
  kind: "class" | "fun" | "block";
  name: string;
}

function scopeFromHeader(header: string): Scope {
  const fun = [...header.matchAll(/\bfun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)\s*\(/g)].pop();
  const cls = [...header.matchAll(/\b(?:class|object|interface)\s+(\w+)/g)].pop();
  if (fun && (!cls || fun.index! > cls.index!)) return { kind: "fun", name: fun[1]! };
  if (cls) return { kind: "class", name: cls[1]! };
  if (/\bcompanion\s+object\b/.test(header)) return { kind: "class", name: "companion" };
  if (/\bobject\b/.test(header)) return { kind: "class", name: "object" };
  if (/\binit\s*$/.test(header.trim())) return { kind: "fun", name: "init" };
  return { kind: "block", name: "" };
}

function sectionName(scopes: Scope[], fileBase: string): string {
  const named = scopes.filter((s) => s.name && s.name !== "companion");
  const fun = [...named].reverse().find((s) => s.kind === "fun");
  const cls = [...named].reverse().find((s) => s.kind === "class");
  if (fun) return `${cls ? cls.name : fileBase}.${fun.name}`;
  return cls ? cls.name : fileBase;
}

interface Pending {
  lit: Omit<Literal, "id" | "ordinal" | "decl" | "declBase">;
  declName?: string | undefined;
  named?: string | undefined;
  stmt: number;
}

/** Scans one Kotlin file. `file` is the repo-relative path. */
export function scanKotlin(file: string, src: string): Literal[] {
  const starts = lineStarts(src);
  const fileBase = file.split("/").pop()!.replace(/\.kts?$/, "");
  const scopes: Scope[] = [];
  const calls: string[] = [];
  const pending: Pending[] = [];
  let stmtStart = 0;
  let stmtId = 0;
  let paren = 0;
  const n = src.length;
  let i = 0;

  const resetStmt = (at: number) => {
    stmtStart = at;
    stmtId++;
  };
  const prevNonSpace = (from: number) => {
    let j = from;
    while (j >= 0 && (src[j] === " " || src[j] === "\t")) j--;
    return j;
  };
  const isUnary = (minusAt: number) => {
    const j = prevNonSpace(minusAt - 1);
    if (j < 0 || src[j] === "\n") return true;
    if (UNARY_BEFORE.has(src[j]!)) return true;
    const word = /(\w+)$/.exec(src.slice(Math.max(0, j - 8), j + 1));
    return !!word && ["return", "else", "to", "in", "until", "downTo", "step"].includes(word[1]!);
  };
  const callBefore = (at: number) => {
    const m = /([A-Za-z_]\w*)\s*$/.exec(src.slice(Math.max(0, at - 40), at));
    return m ? m[1]! : "";
  };
  const skipping = () => calls.some((c) => c === "[" || SKIP_CALLS.has(c) || /^gl[A-Z]/.test(c));

  const emit = (start: number, end: number, raw: string, glsl: boolean, section: string, inFunction: boolean, declName: string | undefined, named: string | undefined) => {
    const parsed = parseValue(raw.replace(/^-\s*/, ""));
    if (!parsed) return;
    const neg = raw.startsWith("-");
    const body = raw.replace(/^-\s*/, "");
    pending.push({
      lit: {
        file,
        start,
        end,
        raw,
        value: neg ? -parsed.value : parsed.value,
        kind: parsed.kind,
        suffix: parsed.suffix,
        leadingDot: body.startsWith("."),
        upperHex: /^0[xX].*[A-F]/.test(body),
        glsl,
        section,
        inFunction,
        line: lineAt(starts, start),
        stmtLine: lineAt(starts, stmtStart),
      },
      declName,
      named,
      stmt: glsl ? -1 : stmtId,
    });
  };

  /** Declaration name and named argument for a literal at class/file level. */
  const declFor = (litStart: number): { declName?: string | undefined; named?: string | undefined } => {
    const header = src.slice(stmtStart, litStart);
    const vals = [...header.matchAll(/\b(val|var)\s+(\w+)/g)];
    const last = vals.pop();
    if (!last || last[1] === "var") return {};
    // Thresholds such as `if (r >= 2)` are logic, not looks.
    if (/(?:[<>!]=?|==)\s*-?\s*$/.test(header) && !/[^=!<>]=\s*-?\s*$/.test(header)) return {};
    const after = header.slice(last.index! + last[0].length);
    const eq = after.search(/(?<![=!<>])=(?!=)/);
    if (eq < 0) return {};
    const rest = after.slice(eq + 1);
    const cut = Math.max(rest.lastIndexOf(","), rest.lastIndexOf("("));
    const seg = cut >= 0 ? rest.slice(cut + 1) : "";
    const named = /^\s*(\w+)\s*=(?!=)/.exec(seg);
    return { declName: last[2], named: named ? named[1] : undefined };
  };

  const scanGlsl = (from: number, to: number, section: string, inFunction: boolean) => {
    let j = from;
    const brackets: string[] = [];
    let defineName: string | undefined;
    let lineStart = from;
    while (j < to) {
      const c = src[j]!;
      if (c === "\n") {
        defineName = undefined;
        lineStart = j + 1;
        j++;
        continue;
      }
      if (c === "/" && src[j + 1] === "/") {
        while (j < to && src[j] !== "\n") j++;
        continue;
      }
      if (c === "/" && src[j + 1] === "*") {
        const e = src.indexOf("*/", j + 2);
        j = e < 0 || e > to ? to : e + 2;
        continue;
      }
      if (c === "$" && src[j + 1] === "{") {
        let depth = 0;
        for (; j < to; j++) {
          if (src[j] === "{") depth++;
          else if (src[j] === "}" && --depth === 0) break;
        }
        j++;
        continue;
      }
      if (c === "#") {
        const lineText = src.slice(j, src.indexOf("\n", j) < 0 ? to : Math.min(to, src.indexOf("\n", j)));
        if (/^#(version|extension|if|ifdef|ifndef|elif|else|endif|line|pragma)\b/.test(lineText)) {
          while (j < to && src[j] !== "\n") j++;
          continue;
        }
        const d = /^#define\s+(\w+)\s+/.exec(lineText);
        if (d) defineName = d[1];
      }
      if (c === "[") brackets.push("[");
      if (c === "]") brackets.pop();
      if (c === "(") brackets.push(callBefore(j));
      if (c === ")") brackets.pop();
      const prev = src[j - 1] ?? " ";
      if ((/\d/.test(c) || (c === "." && /\d/.test(src[j + 1] ?? ""))) && !ID_CHAR.test(prev) && prev !== ".") {
        GLSL_NUM_RE.lastIndex = j;
        const m = GLSL_NUM_RE.exec(src);
        if (m && !ID_CHAR.test(src[j + m[0].length] ?? " ")) {
          let start = j;
          const k = prevNonSpace(j - 1);
          if (src[k] === "-" && isUnary(k)) start = k;
          const raw = src.slice(start, j + m[0].length);
          const constMatch = /\bconst\s+(?:float|int)\s+(\w+)\s*=\s*-?\s*$/.exec(src.slice(lineStart, start));
          const name = defineName ?? (constMatch ? constMatch[1] : undefined);
          if (!brackets.some((b) => b === "[" || b === "layout")) emit(start, j + m[0].length, raw.includes(".") || raw.includes("e") ? raw : raw, true, section, inFunction, name, undefined);
          j += m[0].length;
          continue;
        }
      }
      j++;
    }
  };

  while (i < n) {
    const c = src[i]!;
    // comments
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") { depth++; i += 2; }
        else if (src[i] === "*" && src[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      continue;
    }
    // strings
    if (c === '"' && src.startsWith('"""', i)) {
      let e = src.indexOf('"""', i + 3);
      if (e < 0) e = n;
      while (src[e + 3] === '"') e++;
      const body = src.slice(i + 3, e);
      if (/void\s+main|#version|\buniform\b|\bvec[234]\b/.test(body)) {
        const header = src.slice(stmtStart, i);
        const v = [...header.matchAll(/\b(?:val|var)\s+(\w+)/g)].pop();
        const base = sectionName(scopes, fileBase);
        scanGlsl(i + 3, e, v ? `${base}.${v[1]}` : base, scopes.some((s) => s.kind !== "class"));
      }
      i = e + 3;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"' && src[j] !== "\n") {
        if (src[j] === "\\") j += 2;
        else if (src[j] === "$" && src[j + 1] === "{") {
          let depth = 0;
          for (; j < n; j++) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}" && --depth === 0) break;
          }
          j++;
        } else j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "'") {
      const e = src.indexOf("'", i + (src[i + 1] === "\\" ? 3 : 2));
      i = e > i && e - i < 10 ? e + 1 : i + 1;
      continue;
    }
    if (c === "{") {
      scopes.push(scopeFromHeader(src.slice(stmtStart, i)));
      resetStmt(i + 1);
      i++;
      continue;
    }
    if (c === "}") {
      scopes.pop();
      resetStmt(i + 1);
      i++;
      continue;
    }
    if (c === ";") {
      resetStmt(i + 1);
      i++;
      continue;
    }
    if (c === "\n") {
      if (paren === 0) resetStmt(i + 1);
      i++;
      continue;
    }
    if (c === "(" || c === "[") {
      paren++;
      calls.push(c === "[" ? "[" : callBefore(i));
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      paren = Math.max(0, paren - 1);
      calls.pop();
      i++;
      continue;
    }
    if (c === "@") {
      // annotation: skip its name (and arguments are mostly strings)
      i++;
      while (i < n && ID_CHAR.test(src[i]!)) i++;
      continue;
    }
    const prev = src[i - 1] ?? " ";
    const digitStart = /\d/.test(c) && !ID_CHAR.test(prev);
    const dotStart = c === "." && /\d/.test(src[i + 1] ?? "") && !ID_CHAR.test(prev) && prev !== ".";
    if (digitStart || dotStart) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(src);
      if (m && !ID_CHAR.test(src[i + m[0].length] ?? " ")) {
        const end = i + m[0].length;
        let start = i;
        const k = prevNonSpace(i - 1);
        if (src[k] === "-" && isUnary(k)) start = k;
        if (!skipping()) {
          const inFunction = scopes.some((s) => s.kind !== "class");
          const header = src.slice(stmtStart, start);
          const ctor = /\bclass\s+(\w+)\s*(?:<[^>]*>)?\s*\(/.exec(header);
          const section = ctor && !inFunction ? ctor[1]! : sectionName(scopes, fileBase);
          const d = inFunction ? {} : declFor(start);
          emit(start, end, src.slice(start, end), false, section, inFunction, d.declName, d.named);
        }
        i = end;
        continue;
      }
    }
    if (ID_CHAR.test(c)) {
      while (i < n && ID_CHAR.test(src[i]!)) i++;
      continue;
    }
    i++;
  }

  // Labels: one literal per declaration keeps the plain name, several get an index.
  const groups = new Map<string, Pending[]>();
  for (const p of pending) {
    if (!p.declName) continue;
    const key = p.lit.glsl ? `g:${p.declName}:${p.lit.section}` : `${p.stmt}:${p.declName}:${p.named ?? ""}`;
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }
  const labelOf = new Map<Pending, { decl: string; declBase: string }>();
  for (const g of groups.values()) {
    g.forEach((p, k) => {
      const base = p.named ? `${p.declName}.${p.named}` : p.declName!;
      labelOf.set(p, { declBase: base, decl: g.length > 1 ? `${base}[${k}]` : base });
    });
  }
  return pending.map((p, ordinal) => {
    const l = labelOf.get(p);
    return { ...p.lit, id: `${file}#${ordinal}`, ordinal, ...(l ?? {}) } as Literal;
  });
}

function trimNumber(a: number): string {
  if (a !== 0 && (a < 1e-5 || a >= 1e9)) return a.toExponential(6).replace(/\.?0+e/, "e");
  return String(Number(a.toFixed(6)));
}

/** Writes `v` the way the original literal was written (suffix, leading dot, hex case). */
export function formatLiteral(l: Pick<Literal, "kind" | "suffix" | "leadingDot" | "upperHex" | "glsl">, v: number): string {
  if (l.kind === "hex") {
    const h = Math.max(0, Math.min(0xffffff, Math.round(v))).toString(16).padStart(6, "0");
    return `0x${l.upperHex ? h.toUpperCase() : h}`;
  }
  const neg = v < 0;
  const a = Math.abs(v);
  let s: string;
  if (l.kind === "int" || l.kind === "long") {
    s = String(Math.round(a));
  } else {
    s = trimNumber(a);
    if (!/[.eE]/.test(s) && (l.kind === "double" || l.glsl)) s += ".0";
    if (l.leadingDot && s.startsWith("0.")) s = s.slice(1);
  }
  return `${neg ? "-" : ""}${s}${l.suffix}`;
}

/** Applies edits (literal id → new value) to one file's source. Unchanged values keep their original text. */
export function patchSource(src: string, lits: readonly Literal[], edits: ReadonlyMap<string, number>): string {
  const changes = lits
    .filter((l) => edits.has(l.id) && Math.abs(edits.get(l.id)! - l.value) > 1e-12)
    .sort((a, b) => b.start - a.start);
  let out = src;
  for (const l of changes) out = out.slice(0, l.start) + formatLiteral(l, edits.get(l.id)!) + out.slice(l.end);
  return out;
}

export interface Range {
  min: number;
  max: number;
  step: number;
  int: boolean;
}

/** A slider range around the value from the file: 0…3× for positive numbers, symmetric for negative ones. */
export function autoRange(l: Pick<Literal, "kind" | "value">): Range {
  const v = l.value;
  const int = l.kind === "int" || l.kind === "long";
  const a = Math.abs(v);
  if (int) {
    if (v === 0) return { min: 0, max: 10, step: 1, int };
    if (v > 0) return { min: 0, max: Math.max(4, Math.ceil(v * 3)), step: 1, int };
    return { min: Math.floor(v * 3), max: Math.ceil(a * 3), step: 1, int };
  }
  if (a === 0) return { min: -1, max: 1, step: 0.01, int };
  const step = Math.pow(10, Math.floor(Math.log10(a)) - 2);
  if (v > 0) return { min: 0, max: Number((v * 3).toPrecision(6)), step, int };
  return { min: Number((v * 3).toPrecision(6)), max: Number((a * 3).toPrecision(6)), step, int };
}

/** The trailing `//` comment on the literal's line, or the KDoc right above its statement. */
export function hintFor(src: string, l: Pick<Literal, "line" | "stmtLine">): string | undefined {
  const lines = src.split("\n");
  const own = lines[l.line - 1] ?? "";
  const tc = /\/\/\s*(.+)$/.exec(own.replace(/"(?:[^"\\]|\\.)*"/g, '""'));
  if (tc) return tc[1]!.trim();
  let k = l.stmtLine - 2;
  if (k >= 0 && /\*\/\s*$/.test(lines[k] ?? "")) {
    const buf: string[] = [];
    while (k >= 0) {
      const t = lines[k]!.trim();
      buf.unshift(t.replace(/^\/\*\*?|\*\/$|^\*/g, "").trim());
      if (t.startsWith("/*")) break;
      k--;
    }
    const s = buf.filter(Boolean).join(" ");
    return s || undefined;
  }
  if (k >= 0 && /^\s*\/\/\s*(.+)$/.test(lines[k] ?? "")) return /^\s*\/\/\s*(.+)$/.exec(lines[k]!)![1]!.trim();
  return undefined;
}

/** The source line around a literal, with the literal's position inside it, for showing what a slider changes. */
export function snippetFor(src: string, l: Pick<Literal, "start" | "end">, width = 72): { before: string; text: string; after: string } {
  const ls = src.lastIndexOf("\n", l.start - 1) + 1;
  let le = src.indexOf("\n", l.end);
  if (le < 0) le = src.length;
  let before = src.slice(ls, l.start).replace(/^\s+/, "");
  let after = src.slice(l.end, le);
  const room = Math.max(10, width - (l.end - l.start));
  if (before.length > room * 0.6) before = "…" + before.slice(before.length - Math.floor(room * 0.6));
  if (after.length > room * 0.4) after = after.slice(0, Math.floor(room * 0.4)) + "…";
  return { before, text: src.slice(l.start, l.end), after };
}

export interface CallFrame {
  /** Called function, without receiver: "prim", "material", "sin". */
  fn: string;
  /** 1-based argument position. */
  arg: number;
  /** Name of a named argument ("rough" in `rough = .8`). */
  name?: string | undefined;
}

const KEYWORD_CALLS = new Set(["if", "while", "for", "when", "catch", "return"]);

/**
 * The calls a literal sits in, innermost first (at most `depth`): which function's which argument it is. Literals
 * that are written inline have no name of their own; this is the closest thing to their name in the code.
 */
export function callContext(src: string, pos: number, depth = 2): CallFrame[] {
  const out: CallFrame[] = [];
  let level = 0;
  let commas = 0;
  /** End of the current argument (the literal, or the inner call) and start after the closest comma before it. */
  let segEnd = pos;
  let segStart = -1;
  for (let i = pos - 1, n = 0; i >= 0 && n < 6000 && out.length < depth; i--, n++) {
    const c = src[i]!;
    if (c === ")" || c === "]") level++;
    else if (c === "[") {
      if (level === 0) return out;
      level--;
    } else if (c === "(") {
      if (level > 0) {
        level--;
        continue;
      }
      let j = i - 1;
      while (j >= 0 && (src[j] === " " || src[j] === "\t")) j--;
      let k = j;
      while (k >= 0 && /[A-Za-z0-9_.]/.test(src[k]!)) k--;
      const fn = src.slice(k + 1, j + 1).split(".").pop() ?? "";
      if (KEYWORD_CALLS.has(fn)) return out;
      // A grouping paren: still the same argument.
      if (!fn || /^\d/.test(fn)) {
        commas = 0;
        segStart = -1;
        continue;
      }
      const named = /^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(src.slice(segStart >= 0 ? segStart : i + 1, segEnd));
      out.push({ fn, arg: commas + 1, name: named?.[1] });
      commas = 0;
      segEnd = k + 1;
      segStart = -1;
      i = k + 1;
    } else if (level === 0) {
      if (c === ",") {
        if (segStart < 0) segStart = i + 1;
        commas++;
      } else if (c === "{" || c === "}" || c === ";") return out;
    }
  }
  return out;
}
