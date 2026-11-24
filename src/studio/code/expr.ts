/**
 * Expressions over a token range (Kotlin or GLSL): a small Pratt parser that keeps the token span of every node, so a
 * term can be cut out of its sum or product and the rest of the line stays as written.
 */
import type { Tok } from "./lex";

export type Node =
  | { t: "lit"; a: number; b: number }
  | { t: "id"; a: number; b: number; name: string }
  | { t: "paren"; a: number; b: number; inner: Node }
  | { t: "chain"; a: number; b: number; level: number; items: Node[]; ops: number[] }
  | { t: "prefix"; a: number; b: number; op: string; arg: Node }
  | { t: "postfix"; a: number; b: number; op: string; arg: Node }
  | { t: "member"; a: number; b: number; recv: Node; name: string; nameTok: number }
  | { t: "call"; a: number; b: number; fn: Node; open: number; args: Arg[]; lambda: number[] }
  | { t: "index"; a: number; b: number; recv: Node; args: Node[] }
  | { t: "if"; a: number; b: number; cond: Node | null; then: Node | null; else: Node | null }
  | { t: "cast"; a: number; b: number; arg: Node; type: string }
  | { t: "opaque"; a: number; b: number; what: string };

export interface Arg {
  a: number;
  b: number;
  name?: string | undefined;
  expr: Node;
}

/** Binary precedence (higher binds tighter). */
export const LEVEL = { or: 1, and: 2, eq: 3, cmp: 4, named: 5, elvis: 6, infix: 7, range: 8, add: 9, mul: 10 } as const;

const INFIX = new Set(["to", "until", "downTo", "step", "shl", "shr", "ushr", "and", "or", "xor", "rangeTo", "rangeUntil", "zip"]);

class Fail extends Error {}

export interface ParseOpts {
  glsl?: boolean;
}

/** Parses tokens [a, b) (newlines ignored) as one expression; null when it is not a plain expression. */
export function parseExpr(toks: Tok[], a: number, b: number, opts: ParseOpts = {}): Node | null {
  const idx: number[] = [];
  for (let i = a; i < b; i++) if (toks[i]!.k !== "nl") idx.push(i);
  if (!idx.length) return null;
  let p = 0;
  const glsl = !!opts.glsl;
  const peek = (o = 0) => (p + o < idx.length ? toks[idx[p + o]!] : undefined);
  const at = (o = 0) => idx[p + o] ?? b;
  const next = () => idx[p++]!;
  const expect = (v: string) => {
    if (peek()?.v !== v) throw new Fail(v);
    return next();
  };
  /** Skip to the token after the bracket matching the one at position p. */
  const skipBracket = () => {
    const open = at();
    const close = toks[open]!.m;
    if (close < 0 || close >= b) throw new Fail("bracket");
    while (p < idx.length && idx[p]! <= close) p++;
    return close;
  };
  const end = (n: Node) => n.b;

  const binLevel = (): { level: number; len: number; op: string } | null => {
    const t = peek();
    if (!t) return null;
    if (t.k === "op") {
      switch (t.v) {
        case "||": return { level: LEVEL.or, len: 1, op: "||" };
        case "&&": return { level: LEVEL.and, len: 1, op: "&&" };
        case "==": case "!=": case "===": case "!==": return { level: LEVEL.eq, len: 1, op: t.v };
        case "<": case ">": case "<=": case ">=": return { level: LEVEL.cmp, len: 1, op: t.v };
        case "?:": return glsl ? null : { level: LEVEL.elvis, len: 1, op: "?:" };
        case "..": case "..<": return { level: LEVEL.range, len: 1, op: t.v };
        case "+": case "-": return { level: LEVEL.add, len: 1, op: t.v };
        case "*": case "/": case "%": return { level: LEVEL.mul, len: 1, op: t.v };
        case "!": {
          const n = peek(1);
          if (!glsl && n && n.k === "id" && (n.v === "in" || n.v === "is") && n.s === t.e) return { level: LEVEL.named, len: 2, op: "!" + n.v };
          return null;
        }
        case "?": return glsl ? { level: 0, len: 1, op: "?" } : null;
        case "&": case "|": case "^": case "<<": case ">>": return glsl ? { level: LEVEL.infix, len: 1, op: t.v } : null;
      }
      return null;
    }
    if (!glsl && t.k === "id") {
      if (t.v === "in" || t.v === "is") return { level: LEVEL.named, len: 1, op: t.v };
      if (t.v === "as") return { level: 11, len: 1, op: "as" };
      if (INFIX.has(t.v)) return { level: LEVEL.infix, len: 1, op: t.v };
    }
    return null;
  };

  const parseType = (): string => {
    const s = at();
    if (peek()?.v === "(") skipBracket();
    else {
      if (peek()?.k !== "id") throw new Fail("type");
      next();
      while (peek()?.v === "." && peek(1)?.k === "id") {
        next();
        next();
      }
      if (peek()?.v === "<") {
        let depth = 0;
        do {
          const v = peek()?.v;
          if (v === "<") depth++;
          if (v === ">") depth--;
          if (v === undefined) throw new Fail("type");
          next();
        } while (depth > 0);
      }
    }
    if (peek()?.v === "?") next();
    if (peek()?.v === "->") {
      next();
      parseType();
    }
    return toks.slice(s, at()).map((x) => x.v).join("");
  };

  const parseArgs = (open: number): Arg[] => {
    const close = toks[open]!.m;
    const args: Arg[] = [];
    p++; // "("
    while (p < idx.length && at() < close) {
      const s = at();
      let name: string | undefined;
      if (!glsl && peek()?.k === "id" && peek(1)?.v === "=" ) {
        name = peek()!.v;
        next();
        next();
      }
      if (!glsl && peek()?.v === "*") next(); // spread
      const e = parse(0);
      args.push({ a: s, b: e.b, name, expr: e });
      if (at() === close) break;
      if (peek()?.k !== "comma") throw new Fail("arg");
      next();
      if (at() === close) break; // trailing comma
    }
    if (at() !== close) throw new Fail("args");
    p++;
    return args;
  };

  const primary = (): Node => {
    const t = peek();
    if (!t) throw new Fail("eof");
    const s = at();
    if (t.k === "num" || t.k === "str" || t.k === "char") {
      next();
      return { t: "lit", a: s, b: s + 1 };
    }
    if (t.k === "open" && t.v === "(") {
      const close = toks[s]!.m;
      p++;
      const inner = parse(0);
      if (at() !== close) throw new Fail("paren");
      p++;
      return { t: "paren", a: s, b: close + 1, inner };
    }
    if (t.k === "open" && t.v === "{") {
      const close = skipBracket();
      return { t: "opaque", a: s, b: close + 1, what: "lambda" };
    }
    if (t.k === "open" && t.v === "[") {
      const close = skipBracket();
      return { t: "opaque", a: s, b: close + 1, what: "list" };
    }
    if (t.k === "op" && t.v === "::") {
      next();
      if (peek()?.k === "id") next();
      return { t: "opaque", a: s, b: at(), what: "ref" };
    }
    if (t.k === "id") {
      if (!glsl && (t.v === "true" || t.v === "false" || t.v === "null")) {
        next();
        return { t: "lit", a: s, b: s + 1 };
      }
      if (glsl && (t.v === "true" || t.v === "false")) {
        next();
        return { t: "lit", a: s, b: s + 1 };
      }
      if (!glsl && t.v === "if") {
        next();
        if (peek()?.v !== "(") throw new Fail("if");
        const open = at();
        const close = toks[open]!.m;
        p++;
        const cond = parse(0);
        if (at() !== close) throw new Fail("if cond");
        p++;
        const then = branch();
        let els: Node | null = null;
        if (peek()?.v === "else") {
          next();
          els = branch();
        }
        return { t: "if", a: s, b: els ? els.b : then.b, cond, then, else: els };
      }
      if (!glsl && (t.v === "when" || t.v === "try" || t.v === "object")) {
        next();
        while (p < idx.length && peek()?.v !== "{") {
          if (peek()?.k === "open") skipBracket();
          else next();
        }
        if (peek()?.v !== "{") throw new Fail(t.v);
        let close = skipBracket();
        if (t.v === "try") {
          while (peek()?.v === "catch" || peek()?.v === "finally") {
            next();
            if (peek()?.v === "(") skipBracket();
            if (peek()?.v === "{") close = skipBracket();
          }
        }
        return { t: "opaque", a: s, b: close + 1, what: t.v };
      }
      if (!glsl && (t.v === "return" || t.v === "throw")) {
        next();
        if (p >= idx.length) return { t: "opaque", a: s, b: s + 1, what: t.v };
        const arg = parse(0);
        return { t: "prefix", a: s, b: arg.b, op: t.v, arg };
      }
      if (!glsl && (t.v === "break" || t.v === "continue")) {
        next();
        return { t: "opaque", a: s, b: s + 1, what: t.v };
      }
      if (!glsl && t.v === "fun") throw new Fail("fun");
      next();
      // this@label / label@
      return { t: "id", a: s, b: s + 1, name: t.v };
    }
    throw new Fail(`token ${t.v}`);
  };

  const branch = (): Node => {
    if (peek()?.v === "{") {
      const s = at();
      const close = skipBracket();
      return { t: "opaque", a: s, b: close + 1, what: "block" };
    }
    return parse(0);
  };

  const postfix = (n: Node): Node => {
    for (;;) {
      const t = peek();
      if (!t) return n;
      if (t.k === "op" && (t.v === "." || t.v === "?.")) {
        const nt = peek(1);
        if (!nt || nt.k !== "id") return n;
        next();
        const nameTok = next();
        n = { t: "member", a: n.a, b: nameTok + 1, recv: n, name: nt.v, nameTok };
        continue;
      }
      if (t.k === "open" && t.v === "(") {
        // a call needs the "(" on the same line as the callee
        const open = at();
        let nlBetween = false;
        for (let q = end(n); q < open; q++) if (toks[q]!.k === "nl") nlBetween = true;
        if (nlBetween) return n;
        const args = parseArgs(open);
        const close = toks[open]!.m;
        const node: Node = { t: "call", a: n.a, b: close + 1, fn: n, open, args, lambda: [] };
        n = node;
        continue;
      }
      if (!glsl && t.k === "open" && t.v === "{" && (n.t === "call" || n.t === "id" || n.t === "member")) {
        let nlBetween = false;
        for (let q = end(n); q < at(); q++) if (toks[q]!.k === "nl") nlBetween = true;
        if (nlBetween) return n;
        const s = at();
        const close = skipBracket();
        if (n.t === "call") {
          n.lambda.push(s);
          n.b = close + 1;
        } else n = { t: "call", a: n.a, b: close + 1, fn: n, open: -1, args: [], lambda: [s] };
        continue;
      }
      if (t.k === "open" && t.v === "[") {
        const open = at();
        const close = toks[open]!.m;
        p++;
        const args: Node[] = [];
        while (at() < close) {
          args.push(parse(0));
          if (peek()?.k === "comma") next();
          else break;
        }
        if (at() !== close) throw new Fail("index");
        p++;
        n = { t: "index", a: n.a, b: close + 1, recv: n, args };
        continue;
      }
      if (t.k === "op" && (t.v === "!!" || t.v === "++" || t.v === "--")) {
        next();
        n = { t: "postfix", a: n.a, b: at(), op: t.v, arg: n };
        continue;
      }
      if (!glsl && t.k === "op" && t.v === "::") {
        next();
        if (peek()?.k === "id") next();
        n = { t: "opaque", a: n.a, b: at(), what: "ref" };
        continue;
      }
      if (!glsl && t.k === "op" && t.v === "<" && n.t === "id") {
        // generic call foo<T>(…)
        let q = 1, depth = 0, ok = false;
        for (; p + q < idx.length; q++) {
          const v = peek(q)!;
          if (v.v === "<") depth++;
          else if (v.v === ">") {
            if (depth === 0) {
              ok = peek(q + 1)?.v === "(" || peek(q + 1)?.v === "::";
              break;
            }
            depth--;
          } else if (!(v.k === "id" || v.k === "comma" || v.v === "?" || v.v === "." || v.v === "*")) break;
        }
        if (ok) {
          p += q + 1;
          continue;
        }
      }
      return n;
    }
  };

  const unary = (): Node => {
    const t = peek();
    if (t && t.k === "op" && (t.v === "-" || t.v === "+" || t.v === "!" || t.v === "++" || t.v === "--" || (glsl && t.v === "~"))) {
      const s = next();
      const arg = unary();
      return { t: "prefix", a: s, b: arg.b, op: t.v, arg };
    }
    if (t && t.k === "op" && t.v.startsWith("@")) {
      next();
      return unary();
    }
    return postfix(primary());
  };

  function parse(min: number): Node {
    let left = unary();
    for (;;) {
      const op = binLevel();
      if (!op || op.level < min) return left;
      if (op.level === 0) {
        // GLSL ternary
        next();
        const th = parse(0);
        if (peek()?.v !== ":") throw new Fail("ternary");
        next();
        const el = parse(0);
        left = { t: "if", a: left.a, b: el.b, cond: left, then: th, else: el };
        continue;
      }
      const opTok = at();
      p += op.len;
      if (op.op === "as" || op.op === "is" || op.op === "!is") {
        if (peek()?.v === "?") next();
        const type = parseType();
        left = { t: "cast", a: left.a, b: at(), arg: left, type: op.op === "as" ? type : "Boolean" };
        continue;
      }
      const right = parse(op.level + 1);
      if (left.t === "chain" && left.level === op.level && left.b === opTok) {
        left.items.push(right);
        left.ops.push(opTok);
        left.b = right.b;
      } else left = { t: "chain", a: left.a, b: right.b, level: op.level, items: [left, right], ops: [opTok] };
    }
  }

  try {
    const n = parse(0);
    if (p !== idx.length) return null;
    return n;
  } catch (e) {
    if (e instanceof Fail) return null;
    throw e;
  }
}

/** The node path from `root` down to the deepest node whose span is exactly [a, b) (or that contains it). */
export function pathTo(root: Node, a: number, b: number): Node[] {
  const out: Node[] = [];
  let n: Node | undefined = root;
  while (n) {
    if (n.a > a || n.b < b) break;
    out.push(n);
    if (n.a === a && n.b === b) {
      // descend through wrappers with the same span (none expected)
      break;
    }
    n = kids(n).find((k) => k.a <= a && k.b >= b);
  }
  return out;
}

export function kids(n: Node): Node[] {
  switch (n.t) {
    case "paren": return [n.inner];
    case "chain": return n.items;
    case "prefix": case "postfix": case "cast": return [n.arg];
    case "member": return [n.recv];
    case "call": return [n.fn, ...n.args.map((x) => x.expr)];
    case "index": return [n.recv, ...n.args];
    case "if": return [n.cond, n.then, n.else].filter((x): x is Node => !!x);
    default: return [];
  }
}

export function walk(n: Node, f: (n: Node) => void) {
  f(n);
  for (const k of kids(n)) walk(k, f);
}
