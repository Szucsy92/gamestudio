/**
 * All Kotlin files of a repo together: declarations by name, every reference, name resolution, the expression a token
 * sits in, and type inference for numbers (Kotlin and the GLSL inside raw strings). Built once per loaded repo.
 */
import { lexGlsl, type Tok } from "./lex";
import { kids, parseExpr, pathTo, type Node } from "./expr";
import { enclosingBlocks, parseFile, stmtChain, typeHead, type Decl, type FileSyntax, type Stmt } from "./syntax";

export interface Ref {
  file: FileSyntax;
  tok: number;
  name: string;
  /** Member access: `x.name`. */
  dot: boolean;
  /** Inside a string template: the string token. */
  str?: number;
}

export interface ExprCtx {
  stmt: Stmt;
  /** Which part of the statement: "init", "rhs", "lhs", "expr", "cond", "iter", "body", "branchCond", "branchBody", "return". */
  part: string;
  root: Node;
  a: number;
  b: number;
}

export interface Shader {
  file: FileSyntax;
  /** Index of the raw string token. */
  str: number;
  toks: Tok[];
  /** name → [{ at (token index), type }] */
  vars: Map<string, { at: number; type: string }[]>;
  funs: Map<string, string>;
}

const NUM_RANK: Record<string, number> = { Int: 1, Long: 2, Float: 3, Double: 4 };
const MATH_SAME = new Set(["sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "exp", "ln", "log10", "log2", "abs", "floor", "ceil", "round", "sign", "cbrt", "tanh", "sinh", "cosh", "expm1", "ln1p", "truncate"]);
const MATH_PROMOTE = new Set(["atan2", "hypot", "pow", "min", "max", "minOf", "maxOf"]);
const GLSL_TYPES = new Set(["float", "int", "uint", "bool", "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "uvec2", "uvec3", "uvec4", "bvec2", "bvec3", "bvec4", "mat2", "mat3", "mat4", "sampler2D", "samplerCube", "sampler2DShadow", "sampler3D"]);
const GLSL_GEN = new Set(["sin", "cos", "tan", "asin", "acos", "atan", "pow", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt", "abs", "sign", "floor", "ceil", "fract", "mod", "min", "max", "clamp", "radians", "degrees", "normalize", "reflect", "cross", "trunc", "round", "dFdx", "dFdy", "fwidth"]);

export function promote(a: string | undefined, b: string | undefined): string | undefined {
  if (!a || !b) return undefined;
  if (a === b) return a;
  const ra = NUM_RANK[a], rb = NUM_RANK[b];
  if (ra && rb) return ra > rb ? a : b;
  if (a === "String" || b === "String") return "String";
  return undefined;
}

export function glslPromote(a: string | undefined, b: string | undefined): string | undefined {
  if (!a || !b) return undefined;
  if (a === b) return a;
  if (a === "float" && /^vec[234]$|^mat[234]$/.test(b)) return b;
  if (b === "float" && /^vec[234]$|^mat[234]$/.test(a)) return a;
  if (a === "int" && /^ivec/.test(b)) return b;
  if (b === "int" && /^ivec/.test(a)) return a;
  if (/^mat([234])$/.test(a) && /^vec([234])$/.test(b)) return b;
  if (/^vec([234])$/.test(a) && /^mat([234])$/.test(b)) return a;
  return undefined;
}

export function literalType(v: string, glsl = false): string {
  const t = v.replace(/_/g, "");
  if (glsl) return /^0[xX]/.test(t) || !/[.eEfF]/.test(t) ? (/[uU]$/.test(t) ? "uint" : "int") : "float";
  if (t.startsWith('"')) return "String";
  if (t.startsWith("'")) return "Char";
  if (t === "true" || t === "false") return "Boolean";
  if (t === "null") return "Nothing?";
  if (/^0[xX]/.test(t)) return /[lL]$/.test(t) ? "Long" : "Int";
  if (/[fF]$/.test(t)) return "Float";
  if (/[lL]$/.test(t)) return "Long";
  if (/[.eE]/.test(t) || /[dD]$/.test(t)) return "Double";
  return "Int";
}

function normType(t: string | undefined): string | undefined {
  if (!t) return undefined;
  const s = t.trim().replace(/\?$/, "");
  if (/^(kotlin\.)?(Int|Long|Float|Double|Boolean|String|Char|Unit)$/.test(s)) return s.replace(/^kotlin\./, "");
  return s;
}

export class Program {
  files = new Map<string, FileSyntax>();
  byName = new Map<string, Decl[]>();
  refsByName = new Map<string, Ref[]>();
  classNames = new Set<string>();
  shaders: Shader[] = [];
  private declToks = new Map<FileSyntax, Map<number, Decl>>();
  private exprCache = new Map<string, Node | null>();
  private resolveCache = new Map<string, Decl[]>();
  private typing = new Set<string>();

  constructor(texts: Iterable<[string, string]>) {
    for (const [path, src] of texts) {
      if (!path.endsWith(".kt")) continue;
      const f = parseFile(path, src);
      this.files.set(path, f);
    }
    for (const f of this.files.values()) {
      const dt = new Map<number, Decl>();
      for (const d of f.decls) {
        dt.set(d.tok, d);
        const a = this.byName.get(d.name);
        if (a) a.push(d);
        else this.byName.set(d.name, [d]);
        if (d.kind === "class") this.classNames.add(d.name);
      }
      this.declToks.set(f, dt);
      this.collectRefs(f);
      for (const g of f.lx.glsl) this.shaders.push(this.shaderOf(f, g.s, g.e, g.tok));
    }
  }

  declAtTok(f: FileSyntax, tok: number): Decl | undefined {
    return this.declToks.get(f)?.get(tok);
  }

  private collectRefs(f: FileSyntax) {
    const toks = f.toks;
    const dt = this.declToks.get(f)!;
    const add = (r: Ref) => {
      const a = this.refsByName.get(r.name);
      if (a) a.push(r);
      else this.refsByName.set(r.name, [r]);
    };
    // parameter names in calls `foo(name = …)` are not references
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (t.k !== "id" || dt.has(i)) continue;
      const prev = prevSig(toks, i);
      const pv = prev >= 0 ? toks[prev]!.v : "";
      if (pv === "fun" || pv === "val" || pv === "var" || pv === "class" || pv === "object" || pv === "interface" || pv === "package") continue;
      const nx = toks[i + 1];
      if (nx && nx.v === "=" && (pv === "(" || pv === ",") && inParens(toks, i)) continue;
      add({ file: f, tok: i, name: t.v, dot: pv === "." || pv === "?." });
    }
    for (const r of f.lx.tplRefs) add({ file: f, tok: r.str, name: r.v, dot: r.dot, str: r.str });
  }

  refs(name: string): Ref[] {
    return this.refsByName.get(name) ?? [];
  }

  /** Declarations a reference may mean (empty when unknown or ambiguous). */
  resolve(r: Ref): Decl[] {
    const key = `${r.file.path}:${r.tok}:${r.name}:${r.str ?? ""}`;
    const c = this.resolveCache.get(key);
    if (c) return c;
    const out = this.resolveUncached(r);
    this.resolveCache.set(key, out);
    return out;
  }

  private resolveUncached(r: Ref): Decl[] {
    const all = this.byName.get(r.name) ?? [];
    if (!all.length) return [];
    const f = r.file;
    if (!r.dot) {
      // locals and parameters
      let best: Decl | undefined;
      for (const d of all) {
        if (d.file !== f || !d.scope) continue;
        if (r.tok < d.scope[0] || r.tok > d.scope[1]) continue;
        if ((d.kind === "val" || d.kind === "var") && d.tok > r.tok) continue;
        if (!best || d.scope[0] >= best.scope![0]) best = d;
      }
      if (best) return [best];
      // members of the enclosing classes
      for (const bl of enclosingBlocks(f, r.tok)) {
        if (bl.kind !== "class" && bl.kind !== "enum") continue;
        const cls = bl.parent;
        const owner = cls?.classKind === "companion" ? cls.block.parent?.name : cls?.name;
        const m = all.filter((d) => d.owner && (d.owner === owner || d.owner === cls?.name));
        if (m.length) return m;
      }
      const top = all.filter((d) => !d.owner && !d.scope);
      return top;
    }
    const recv = this.receiverType(f, r.tok);
    const members = all.filter((d) => d.owner);
    if (recv) {
      const m = members.filter((d) => d.owner === recv);
      return m;
    }
    const owners = new Set(members.map((d) => d.owner));
    return owners.size === 1 ? members : [];
  }

  /** Type name of the receiver in `recv.name` at token `tok` (the name). */
  receiverType(f: FileSyntax, tok: number): string | undefined {
    const toks = f.toks;
    const dot = prevSig(toks, tok);
    const end = prevSig(toks, dot);
    if (end < 0) return undefined;
    const t = toks[end]!;
    if (t.k === "id") {
      if (t.v === "this") return this.enclosingClass(f, end);
      const before = prevSig(toks, end);
      const isMember = before >= 0 && (toks[before]!.v === "." || toks[before]!.v === "?.");
      if (!isMember && this.classNames.has(t.v)) {
        const shadow = this.resolve({ file: f, tok: end, name: t.v, dot: false }).filter((d) => d.kind !== "class");
        if (!shadow.length) return t.v;
      }
      const ds = this.resolve({ file: f, tok: end, name: t.v, dot: isMember });
      if (ds.length !== 1) return undefined;
      return this.classOfDecl(ds[0]!);
    }
    if (t.v === ")" && t.m >= 0) {
      const fnTok = prevSig(toks, t.m);
      if (fnTok >= 0 && toks[fnTok]!.k === "id") {
        const name = toks[fnTok]!.v;
        if (this.classNames.has(name)) return name;
        const before = prevSig(toks, fnTok);
        const ds = this.resolve({ file: f, tok: fnTok, name, dot: before >= 0 && (toks[before]!.v === "." || toks[before]!.v === "?.") }).filter((d) => d.kind === "fun");
        if (ds.length === 1) return typeHead(ds[0]!.type)?.head;
      }
    }
    if (t.v === "]" && t.m >= 0) {
      // list[i] → element type
      const inner = prevSig(toks, t.m);
      if (inner >= 0 && toks[inner]!.k === "id") {
        const ds = this.resolve({ file: f, tok: inner, name: toks[inner]!.v, dot: false });
        if (ds.length === 1) return typeHead(this.declType(ds[0]!))?.arg;
      }
    }
    return undefined;
  }

  enclosingClass(f: FileSyntax, tok: number): string | undefined {
    for (const bl of enclosingBlocks(f, tok)) if ((bl.kind === "class" || bl.kind === "enum") && bl.parent?.name) return bl.parent.classKind === "companion" ? bl.parent.block.parent?.name : bl.parent.name;
    return undefined;
  }

  /** The class a declaration's value is an instance of. */
  classOfDecl(d: Decl): string | undefined {
    if (d.kind === "class") return d.name;
    if (d.kind === "loop") {
      // for (x in coll) / for ((i, x) in coll.withIndex())
      const st = d.stmt!;
      const toks = st.file.toks;
      const open = st.head + 1;
      const close = toks[open]?.m ?? -1;
      let inIdx = -1;
      for (let q = open + 1; q < close; q++) {
        if (toks[q]!.k === "open") {
          q = toks[q]!.m;
          continue;
        }
        if (toks[q]!.v === "in") {
          inIdx = q;
          break;
        }
      }
      if (inIdx < 0) return undefined;
      const isIndex = toks[open + 1]?.v === "(" && toks[open + 2]?.v === d.name;
      if (isIndex) return "Int";
      let e = close;
      // strip .withIndex()
      if (toks[e - 1]?.v === ")" && toks[e - 2]?.v === "(" && toks[e - 3]?.v === "withIndex") e -= 4;
      const last = e - 1;
      if (toks[last]?.k === "id") {
        const before = prevSig(toks, last);
        const ds = this.resolve({ file: st.file, tok: last, name: toks[last]!.v, dot: before >= 0 && (toks[before]!.v === "." || toks[before]!.v === "?.") });
        if (ds.length === 1) return typeHead(this.declType(ds[0]!))?.arg;
      }
      if (toks[last]?.v === ")" ) {
        const fnTok = prevSig(toks, toks[last]!.m);
        const ds = fnTok >= 0 ? (this.byName.get(toks[fnTok]!.v) ?? []).filter((x) => x.kind === "fun") : [];
        if (ds.length === 1) return typeHead(ds[0]!.type)?.arg;
      }
      return undefined;
    }
    const t = this.declType(d);
    return typeHead(t)?.head;
  }

  /** Declared or inferred type text of a declaration. */
  declType(d: Decl): string | undefined {
    if (d.type) return normType(d.type);
    if (d.kind === "fun") {
      if (!d.init) return d.stmt?.blocks.some((b) => b.role === "fun") ? "Unit" : undefined;
      return this.typeOfRange(d.file, d.init[0], d.init[1]);
    }
    if ((d.kind === "val" || d.kind === "var") && d.init) {
      const key = d.id;
      if (this.typing.has(key)) return undefined;
      this.typing.add(key);
      try {
        return this.typeOfRange(d.file, d.init[0], d.init[1]);
      } finally {
        this.typing.delete(key);
      }
    }
    if (d.kind === "loop") return this.classOfDecl(d);
    if (d.kind === "entry") return d.owner;
    return undefined;
  }

  expr(f: FileSyntax, a: number, b: number): Node | null {
    const key = `${f.path}:${a}:${b}`;
    if (this.exprCache.has(key)) return this.exprCache.get(key)!;
    const n = parseExpr(f.toks, a, b);
    this.exprCache.set(key, n);
    return n;
  }

  typeOfRange(f: FileSyntax, a: number, b: number): string | undefined {
    const n = this.expr(f, a, b);
    return n ? this.typeOf(f, n) : undefined;
  }

  /** The expression around token `tok`: the innermost statement part that holds it, parsed. */
  exprAt(f: FileSyntax, tok: number): ExprCtx | null {
    const chain = stmtChain(f, tok);
    const st = chain[0];
    if (!st) return null;
    const toks = f.toks;
    const parts: [string, number, number][] = [];
    if (st.kind === "val" && st.initA !== undefined) parts.push(["init", st.initA, st.initB!]);
    else if (st.kind === "assign" && st.assignOp !== undefined) {
      parts.push(["lhs", st.head, st.assignOp]);
      parts.push(["rhs", st.assignOp + 1, st.b]);
    } else if (st.kind === "expr") parts.push(["expr", st.head, st.b]);
    else if (st.kind === "return") parts.push(["return", st.head + 1, st.b]);
    else if (st.kind === "fun" && st.bodyExpr) parts.push(["body", st.bodyExpr[0], st.bodyExpr[1]]);
    else if ((st.kind === "if" || st.kind === "while") && toks[st.head + 1]?.v === "(") parts.push(["cond", st.head + 2, toks[st.head + 1]!.m]);
    else if (st.kind === "when" && toks[st.head + 1]?.v === "(") parts.push(["cond", st.head + 2, toks[st.head + 1]!.m]);
    else if (st.kind === "for" && toks[st.head + 1]?.v === "(") {
      const close = toks[st.head + 1]!.m;
      for (let q = st.head + 2; q < close; q++) {
        if (toks[q]!.k === "open") {
          q = toks[q]!.m;
          continue;
        }
        if (toks[q]!.v === "in") {
          parts.push(["iter", q + 1, close]);
          break;
        }
      }
    } else if (st.kind === "branch" && st.arrow !== undefined) {
      parts.push(["branchCond", st.head, st.arrow]);
      const bodyIsBlock = toks[st.arrow + 1]?.v === "{" && toks[st.arrow + 1]!.m === st.b - 1;
      if (!bodyIsBlock) parts.push(["branchBody", st.arrow + 1, st.b]);
    }
    if (st.kind === "if" || st.kind === "for" || st.kind === "while") {
      // a body without braces: `if (c) stmt` / `for (x in y) stmt`
      const open = st.head + 1;
      if (toks[open]?.v === "(") {
        const close = toks[open]!.m;
        const bodyStart = close + 1;
        if (toks[bodyStart] && toks[bodyStart]!.v !== "{" && tok >= bodyStart) {
          let e = st.b;
          if (st.kind === "if") {
            for (let q = bodyStart; q < st.b; q++) {
              if (toks[q]!.k === "open") {
                q = toks[q]!.m;
                continue;
              }
              if (toks[q]!.v === "else") {
                e = q;
                break;
              }
            }
          }
          if (tok < e) parts.push(["body", bodyStart, e]);
        }
      }
    }
    const part = parts.find(([, a, b]) => tok >= a && tok < b);
    if (!part) return null;
    // branch conditions are comma lists
    if (part[0] === "branchCond") {
      let s = part[1];
      for (let q = part[1]; q <= part[2]; q++) {
        if (q === part[2] || (toks[q]!.k === "comma")) {
          if (tok >= s && tok < q) {
            const root = this.expr(f, s, q);
            return root ? { stmt: st, part: part[0], root, a: s, b: q } : null;
          }
          s = q + 1;
        } else if (toks[q]!.k === "open") q = toks[q]!.m;
      }
      return null;
    }
    const root = this.expr(f, part[1], part[2]);
    return root ? { stmt: st, part: part[0], root, a: part[1], b: part[2] } : null;
  }

  // ---- types
  typeOf(f: FileSyntax, n: Node, excl?: ReadonlySet<Node>): string | undefined {
    const toks = f.toks;
    switch (n.t) {
      case "lit":
        return literalType(toks[n.a]!.v);
      case "paren":
        return this.typeOf(f, n.inner, excl);
      case "prefix":
        if (n.op === "!") return "Boolean";
        if (n.op === "return" || n.op === "throw") return undefined;
        return this.typeOf(f, n.arg, excl);
      case "postfix":
        return n.op === "!!" ? normType(this.typeOf(f, n.arg, excl)) : this.typeOf(f, n.arg, excl);
      case "cast":
        return normType(n.type);
      case "chain": {
        if (n.level <= 5) return n.level === 6 ? undefined : "Boolean";
        if (n.level === 6) return normType(this.typeOf(f, n.items[n.items.length - 1]!, excl));
        if (n.level === 7 || n.level === 8) return undefined;
        let t: string | undefined;
        let first = true;
        for (const it of n.items) {
          if (excl?.has(it)) continue;
          const ti = this.typeOf(f, it, excl);
          t = first ? ti : promote(t, ti);
          first = false;
          if (!t) return undefined;
        }
        return t;
      }
      case "id": {
        if (n.name === "PI" || n.name === "E") return "Double";
        if (n.name === "this") return this.enclosingClass(f, n.a);
        const ds = this.resolve({ file: f, tok: n.a, name: n.name, dot: false });
        if (ds.length !== 1) return undefined;
        return this.declType(ds[0]!);
      }
      case "member": {
        const rt = this.typeOf(f, n.recv, excl);
        if (n.name === "size" || n.name === "length" || n.name === "ordinal") return "Int";
        if (n.name === "absoluteValue" || n.name === "sign") return rt && NUM_RANK[rt] ? rt : undefined;
        if (n.recv.t === "id" && (n.recv.name === "Math" || n.recv.name === "PI")) return undefined;
        const ds = this.resolve({ file: f, tok: n.nameTok, name: n.name, dot: true });
        if (ds.length === 1) return this.declType(ds[0]!);
        if (rt && n.name === "MAX_VALUE") return rt;
        return undefined;
      }
      case "call": {
        const fn = n.fn;
        if (fn.t === "member") {
          const rt = this.typeOf(f, fn.recv, excl);
          switch (fn.name) {
            case "toFloat": return "Float";
            case "toDouble": return "Double";
            case "toInt": case "roundToInt": return "Int";
            case "toLong": case "roundToLong": return "Long";
            case "pow": case "coerceIn": case "coerceAtLeast": case "coerceAtMost": case "withSign": return rt && NUM_RANK[rt] ? rt : undefined;
            case "toString": return "String";
          }
          if (fn.recv.t === "id" && fn.recv.name === "Math" && n.args.length) return this.mathType(f, fn.name, n.args.map((a) => a.expr), excl);
          const ds = this.resolve({ file: f, tok: fn.nameTok, name: fn.name, dot: true }).filter((d) => d.kind === "fun");
          return ds.length === 1 ? this.declType(ds[0]!) : undefined;
        }
        if (fn.t === "id") {
          const local = this.resolve({ file: f, tok: fn.a, name: fn.name, dot: false });
          const funs = local.filter((d) => d.kind === "fun");
          if (funs.length === 1) return this.declType(funs[0]!);
          if (local.some((d) => d.kind === "class")) return fn.name;
          if (!local.length) return this.mathType(f, fn.name, n.args.map((a) => a.expr), excl);
        }
        return undefined;
      }
      case "if": {
        if (!n.then || !n.else || n.then.t === "opaque" || n.else.t === "opaque") return undefined;
        const a = this.typeOf(f, n.then, excl), b = this.typeOf(f, n.else, excl);
        return a === b ? a : undefined;
      }
      default:
        return undefined;
    }
  }

  private mathType(f: FileSyntax, name: string, args: Node[], excl?: ReadonlySet<Node>): string | undefined {
    if (MATH_SAME.has(name) && args.length === 1) {
      const t = this.typeOf(f, args[0]!, excl);
      return t === "Float" || t === "Double" ? t : name === "abs" && t && NUM_RANK[t] ? t : undefined;
    }
    if (MATH_PROMOTE.has(name) && args.length === 2) {
      const a = this.typeOf(f, args[0]!, excl), b = this.typeOf(f, args[1]!, excl);
      if (name === "min" || name === "max" || name === "minOf" || name === "maxOf") return a === b ? a : undefined;
      return a === b && (a === "Float" || a === "Double") ? a : undefined;
    }
    if (name === "floatArrayOf") return "FloatArray";
    if (name === "doubleArrayOf") return "DoubleArray";
    if (name === "intArrayOf") return "IntArray";
    return undefined;
  }

  // ---- GLSL
  private shaderOf(f: FileSyntax, s: number, e: number, str: number): Shader {
    const toks = lexGlsl(f.lx.src, s, e);
    const vars = new Map<string, { at: number; type: string }[]>();
    const funs = new Map<string, string>();
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (t.k !== "id" || !GLSL_TYPES.has(t.v)) continue;
      // TYPE name (, name)*  /  TYPE name(
      let j = i + 1;
      if (toks[j]?.k !== "id") continue;
      if (toks[j + 1]?.v === "(" && toks[i - 1]?.v !== "(" && toks[i - 1]?.k !== "comma") {
        funs.set(toks[j]!.v, t.v);
        continue;
      }
      for (;;) {
        const nm = toks[j];
        if (!nm || nm.k !== "id") break;
        const list = vars.get(nm.v) ?? [];
        list.push({ at: j, type: t.v });
        vars.set(nm.v, list);
        // skip initializer / array size
        let q = j + 1;
        let depth = 0;
        while (q < toks.length) {
          const v = toks[q]!;
          if (v.k === "open") depth++;
          else if (v.k === "close") {
            if (depth === 0) break;
            depth--;
          } else if (depth === 0 && (v.k === "semi" || v.k === "comma")) break;
          q++;
        }
        if (toks[q]?.k === "comma" && toks[q + 1]?.k === "id" && !GLSL_TYPES.has(toks[q + 1]!.v) && toks[i - 1]?.v !== "(" && toks[i - 1]?.k !== "comma") {
          j = q + 1;
          continue;
        }
        break;
      }
    }
    return { file: f, str, toks, vars, funs };
  }

  glslType(sh: Shader, n: Node, excl?: ReadonlySet<Node>): string | undefined {
    const toks = sh.toks;
    switch (n.t) {
      case "lit":
        return literalType(toks[n.a]!.v, true);
      case "paren":
        return this.glslType(sh, n.inner, excl);
      case "prefix":
        return n.op === "!" ? "bool" : this.glslType(sh, n.arg, excl);
      case "postfix":
        return this.glslType(sh, n.arg, excl);
      case "chain": {
        if (n.level <= 4) return "bool";
        if (n.level !== 9 && n.level !== 10) return undefined;
        let t: string | undefined;
        let first = true;
        for (const it of n.items) {
          if (excl?.has(it)) continue;
          const ti = this.glslType(sh, it, excl);
          t = first ? ti : glslPromote(t, ti);
          first = false;
          if (!t) return undefined;
        }
        return t;
      }
      case "id": {
        const list = sh.vars.get(n.name);
        if (!list) return undefined;
        let best: { at: number; type: string } | undefined;
        for (const v of list) if (v.at <= n.a && (!best || v.at > best.at)) best = v;
        best ??= list.length === 1 ? list[0] : undefined;
        return best?.type;
      }
      case "member": {
        const rt = this.glslType(sh, n.recv, excl);
        if (!rt || !/vec/.test(rt) || !/^[xyzwrgbastpq]{1,4}$/.test(n.name)) return undefined;
        const base = rt.startsWith("ivec") ? "int" : rt.startsWith("bvec") ? "bool" : "float";
        return n.name.length === 1 ? base : `${base === "float" ? "" : base[0]}vec${n.name.length}`;
      }
      case "index": {
        const rt = this.glslType(sh, n.recv, excl);
        if (rt && /^vec/.test(rt)) return "float";
        if (rt && /^mat(\d)$/.test(rt)) return `vec${rt[3]}`;
        if (n.recv.t === "id") return rt;
        return undefined;
      }
      case "call": {
        if (n.fn.t !== "id") return undefined;
        const name = n.fn.name;
        if (GLSL_TYPES.has(name)) return name;
        const args = n.args.map((a) => a.expr);
        if (GLSL_GEN.has(name) && args.length) return this.glslType(sh, args[0]!, excl);
        if (name === "mix" && args.length === 3) return this.glslType(sh, args[0]!, excl);
        if (name === "step" && args.length === 2) return this.glslType(sh, args[1]!, excl);
        if (name === "smoothstep" && args.length === 3) return this.glslType(sh, args[2]!, excl);
        if (name === "length" || name === "distance" || name === "dot") return "float";
        if (name === "texture" || name === "texture2D" || name === "textureLod" || name === "textureProj") return "vec4";
        return sh.funs.get(name);
      }
      case "if":
        if (!n.then || !n.else) return undefined;
        {
          const a = this.glslType(sh, n.then, excl), b = this.glslType(sh, n.else, excl);
          return a === b ? a : undefined;
        }
      default:
        return undefined;
    }
  }

  shaderAt(f: FileSyntax, pos: number): Shader | undefined {
    return this.shaders.find((s) => s.file === f && s.toks.length && s.toks[0]!.s <= pos && pos < s.toks[s.toks.length - 1]!.e);
  }

  /** The GLSL expression around token index `tok` of a shader: the part after `=` / `+=` … of its statement, or the whole statement. */
  glslExprAt(sh: Shader, tok: number): { root: Node; a: number; b: number } | null {
    const toks = sh.toks;
    // innermost enclosing block or control paren
    let lo = 0, hi = toks.length;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (t.k !== "open" || t.m < 0) continue;
      if (i < tok && t.m > tok) {
        const ctrl = t.v === "(" && ["if", "while", "for", "switch"].includes(toks[i - 1]?.v ?? "");
        if (t.v === "{" || ctrl) {
          lo = i + 1;
          hi = t.m;
        }
      }
    }
    // the statement segment: between ";" / "{" / "}" at depth 0 of [lo, hi)
    let s = lo, e = hi;
    for (let i = lo; i < hi; i++) {
      const t = toks[i]!;
      if (t.k === "open" && t.m > i) {
        if (t.m < tok || i > tok) {
          if (i > tok && t.v === "{") {
            e = Math.min(e, i);
            break;
          }
          i = t.m;
          if (t.v === "{") s = i + 1;
          continue;
        }
        continue;
      }
      if (t.k === "semi" || (t.k === "close" && t.v === "}")) {
        if (i < tok) s = i + 1;
        else {
          e = i;
          break;
        }
      }
    }
    // control statement header: `if (…)` belongs to the paren, handled above; skip a leading `else`
    while (s < e && (toks[s]!.k === "nl" || toks[s]!.v === "else" || toks[s]!.v === "return")) s++;
    // after the assignment operator (or declaration "TYPE name =")
    let depth = 0;
    let assign = -1;
    for (let i = s; i < e; i++) {
      const t = toks[i]!;
      if (t.k === "open") depth++;
      else if (t.k === "close") depth--;
      else if (depth === 0 && t.k === "op" && ["=", "+=", "-=", "*=", "/="].includes(t.v)) {
        if (i < tok) assign = i;
      } else if (depth === 0 && t.k === "comma") {
        if (i < tok) {
          s = i + 1;
          assign = -1;
        } else {
          e = i;
          break;
        }
      }
    }
    if (assign >= 0) s = assign + 1;
    else {
      // a for header `for (int i = 0; i < N; i++)` or a declaration without "=" cannot hold a removable term
      const first = toks[s];
      if (first && GLSL_TYPES.has(first.v)) return null;
    }
    const root = parseExpr(toks, s, e, { glsl: true });
    return root ? { root, a: s, b: e } : null;
  }
}

export function prevSig(toks: Tok[], i: number): number {
  let j = i - 1;
  while (j >= 0 && toks[j]!.k === "nl") j--;
  return j;
}

export function nextSig(toks: Tok[], i: number): number {
  let j = i + 1;
  while (j < toks.length && toks[j]!.k === "nl") j++;
  return j < toks.length ? j : -1;
}

function inParens(toks: Tok[], i: number): boolean {
  let depth = 0;
  for (let j = i - 1; j >= 0; j--) {
    const t = toks[j]!;
    if (t.k === "close") {
      if (t.m >= 0) j = t.m;
      continue;
    }
    if (t.k === "open") return t.v === "(";
    if (t.k === "nl" && depth === 0) continue;
  }
  return false;
}

export { kids, pathTo };
