/**
 * Tokenizer for the game's Kotlin sources and for the GLSL inside their raw strings. Comments are skipped (their spans
 * are kept, so deleting a statement can take its comment along), strings are single tokens, and the identifiers used in
 * string templates are reported separately so references inside "${…}" are not missed.
 */

export type TokKind = "id" | "num" | "str" | "char" | "op" | "open" | "close" | "comma" | "semi" | "nl";

export interface Tok {
  k: TokKind;
  v: string;
  s: number;
  e: number;
  /** Index of the matching bracket (open/close tokens). */
  m: number;
}

export interface Lexed {
  src: string;
  toks: Tok[];
  /** [start, end) of every comment. */
  comments: [number, number][];
  /** Identifiers inside string templates: [token index of the string, identifier]. */
  tplRefs: { str: number; v: string; s: number; e: number; dot: boolean }[];
  /** Raw strings that hold shader code: body span and the token index of the string. */
  glsl: { s: number; e: number; tok: number }[];
}

const OPS3 = ["===", "!==", "..<", "?.(", ">>>", "<<="];
const OPS2 = ["?.", "?:", "::", "->", "..", "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", "!!", "<<", ">>"];
const ID_START = /[A-Za-z_\u00C0-\uFFFF]/;
const ID_CHAR = /[A-Za-z0-9_\u00C0-\uFFFF]/;
const NUM_RE = /0[xX][0-9a-fA-F_]+[lLuU]*|0[bB][01_]+[lL]?|(?:\d[\d_]*)?\.\d[\d_]*(?:[eE][-+]?\d+)?[fFdD]?|\d[\d_]*(?:[eE][-+]?\d+)?[fFLdDuU]*/y;
const GLSL_NUM_RE = /0[xX][0-9a-fA-F]+[uU]?|(?:\d+)?\.\d+(?:[eE][-+]?\d+)?[fF]?|\d+\.(?![\d.A-Za-z_])(?:[eE][-+]?\d+)?[fF]?|\d+(?:[eE][-+]?\d+)?[uUfF]?/y;

function matchBrackets(toks: Tok[]) {
  const stack: number[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.k === "open") stack.push(i);
    else if (t.k === "close") {
      const j = stack.pop();
      if (j !== undefined) {
        toks[j]!.m = i;
        t.m = j;
      }
    }
  }
}

/** Kotlin source → tokens. */
export function lexKotlin(src: string): Lexed {
  const toks: Tok[] = [];
  const comments: [number, number][] = [];
  const tplRefs: Lexed["tplRefs"] = [];
  const glsl: Lexed["glsl"] = [];
  const n = src.length;
  let i = 0;
  const push = (k: TokKind, s: number, e: number) => toks.push({ k, v: src.slice(s, e), s, e, m: -1 });
  const scanTemplate = (from: number, to: number, strTok: number) => {
    // `$name` and `${ … }` inside a string: only the identifiers matter.
    for (let j = from; j < to; j++) {
      if (src[j] === "\\") {
        j++;
        continue;
      }
      if (src[j] !== "$") continue;
      if (src[j + 1] === "{") {
        let depth = 0, k = j + 1;
        for (; k < to; k++) {
          if (src[k] === "{") depth++;
          else if (src[k] === "}" && --depth === 0) break;
        }
        const inner = src.slice(j + 2, k);
        const re = /[A-Za-z_]\w*/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(inner))) {
          const before = inner.slice(0, m.index).trimEnd();
          tplRefs.push({ str: strTok, v: m[0], s: j + 2 + m.index, e: j + 2 + m.index + m[0].length, dot: before.endsWith(".") });
        }
        j = k;
      } else if (/[A-Za-z_]/.test(src[j + 1] ?? "")) {
        let k = j + 1;
        while (k < to && /\w/.test(src[k]!)) k++;
        tplRefs.push({ str: strTok, v: src.slice(j + 1, k), s: j + 1, e: k, dot: false });
        j = k - 1;
      }
    }
  };
  while (i < n) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\r" || c === "\f") {
      i++;
      continue;
    }
    if (c === "\n") {
      push("nl", i, i + 1);
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const s = i;
      while (i < n && src[i] !== "\n") i++;
      comments.push([s, i]);
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const s = i;
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      comments.push([s, i]);
      continue;
    }
    if (c === '"' && src.startsWith('"""', i)) {
      let e = src.indexOf('"""', i + 3);
      if (e < 0) e = n;
      while (src[e + 3] === '"') e++;
      const tok = toks.length;
      push("str", i, Math.min(n, e + 3));
      const body = src.slice(i + 3, e);
      if (/void\s+main|#version|\buniform\b|\bvec[234]\b/.test(body)) glsl.push({ s: i + 3, e, tok });
      scanTemplate(i + 3, e, tok);
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
      const tok = toks.length;
      push("str", i, Math.min(n, j + 1));
      scanTemplate(i + 1, j, tok);
      i = j + 1;
      continue;
    }
    if (c === "'") {
      const e = src.indexOf("'", i + (src[i + 1] === "\\" ? 3 : 2));
      const end = e > i && e - i < 10 ? e + 1 : i + 1;
      push("char", i, end);
      i = end;
      continue;
    }
    if (c === "`") {
      const e = src.indexOf("`", i + 1);
      const end = e > i ? e + 1 : i + 1;
      toks.push({ k: "id", v: src.slice(i + 1, end - 1), s: i, e: end, m: -1 });
      i = end;
      continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? "") && !ID_CHAR.test(src[i - 1] ?? " ") && src[i - 1] !== ".")) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(src);
      if (m && m[0].length) {
        push("num", i, i + m[0].length);
        i += m[0].length;
        continue;
      }
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_CHAR.test(src[j]!)) j++;
      push("id", i, j);
      i = j;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      push("open", i, i + 1);
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      push("close", i, i + 1);
      i++;
      continue;
    }
    if (c === ",") {
      push("comma", i, i + 1);
      i++;
      continue;
    }
    if (c === ";") {
      push("semi", i, i + 1);
      i++;
      continue;
    }
    if (c === "@") {
      // annotation: one token "@Name"
      let j = i + 1;
      while (j < n && (ID_CHAR.test(src[j]!) || src[j] === ".")) j++;
      push("op", i, j);
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (OPS3.includes(three) && three !== "?.(") {
      push("op", i, i + 3);
      i += 3;
      continue;
    }
    if (OPS2.includes(two)) {
      push("op", i, i + 2);
      i += 2;
      continue;
    }
    push("op", i, i + 1);
    i++;
  }
  matchBrackets(toks);
  return { src, toks, comments, tplRefs, glsl };
}

/** GLSL code in [from, to) of `src` → tokens (preprocessor lines and Kotlin `${…}` templates become opaque ids). */
export function lexGlsl(src: string, from: number, to: number): Tok[] {
  const toks: Tok[] = [];
  let i = from;
  const push = (k: TokKind, s: number, e: number) => toks.push({ k, v: src.slice(s, e), s, e, m: -1 });
  let lineStart = true;
  while (i < to) {
    const c = src[i]!;
    if (c === "\n") {
      push("nl", i, i + 1);
      lineStart = true;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (lineStart && c === "#") {
      while (i < to && src[i] !== "\n") i++;
      continue;
    }
    lineStart = false;
    if (c === "/" && src[i + 1] === "/") {
      while (i < to && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 || e > to ? to : e + 2;
      continue;
    }
    if (c === "$" && src[i + 1] === "{") {
      let depth = 0, k = i + 1;
      for (; k < to; k++) {
        if (src[k] === "{") depth++;
        else if (src[k] === "}" && --depth === 0) break;
      }
      push("id", i, k + 1);
      i = k + 1;
      continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      GLSL_NUM_RE.lastIndex = i;
      const m = GLSL_NUM_RE.exec(src);
      if (m && m[0].length) {
        push("num", i, i + m[0].length);
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < to && /\w/.test(src[j]!)) j++;
      push("id", i, j);
      i = j;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      push("open", i, i + 1);
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      push("close", i, i + 1);
      i++;
      continue;
    }
    if (c === ",") {
      push("comma", i, i + 1);
      i++;
      continue;
    }
    if (c === ";") {
      push("semi", i, i + 1);
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "<<", ">>"].includes(two)) {
      push("op", i, i + 2);
      i += 2;
      continue;
    }
    push("op", i, i + 1);
    i++;
  }
  matchBrackets(toks);
  return toks;
}
