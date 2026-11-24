/**
 * The statement structure of a Kotlin file: blocks (file, bodies, class bodies, `when` branches, lambdas) holding
 * statements, plus every declaration with its scope, and name resolution for references. It is not a compiler; it
 * knows exactly as much Kotlin as deleting code cleanly needs.
 */
import { lexKotlin, type Lexed, type Tok } from "./lex";

export type BlockKind = "file" | "body" | "class" | "enum" | "when" | "lambda";

export interface Block {
  kind: BlockKind;
  /** "{" token (-1 for the file). */
  open: number;
  /** "}" token (toks.length for the file). */
  close: number;
  stmts: Stmt[];
  /** Enum entries (kind "enum"). */
  entries: Stmt[];
  parent: Stmt | null;
  /** Lambda: the call it is passed to ("forEach", "all" …). */
  call?: string | undefined;
  /** Body: what it is the body of. */
  role?: "then" | "else" | "loop" | "fun" | "init" | "try" | "accessor" | "branch" | "other" | undefined;
  params: { name: string; tok: number }[];
}

export type StmtKind = "import" | "package" | "val" | "fun" | "class" | "typealias" | "entry" | "branch" | "if" | "for" | "while" | "do" | "when" | "return" | "throw" | "try" | "assign" | "expr";

export interface Param {
  name: string;
  tok: number;
  type: string;
  hasDefault: boolean;
  /** Constructor property (val/var). */
  prop: boolean;
  a: number;
  b: number;
}

export interface Stmt {
  id: number;
  file: FileSyntax;
  a: number;
  b: number;
  kind: StmtKind;
  block: Block;
  index: number;
  blocks: Block[];
  head: number;
  mods: string[];
  annotations: string[];
  name?: string | undefined;
  nameTok?: number | undefined;
  names?: { name: string; tok: number }[];
  typeA?: number;
  typeB?: number;
  initA?: number;
  initB?: number;
  paramsOpen?: number;
  params?: Param[];
  retType?: string;
  bodyExpr?: [number, number];
  assignOp?: number;
  arrow?: number;
  ctorOpen?: number;
  classKind?: "class" | "interface" | "object" | "enum" | "companion";
}

export type DeclKind = "val" | "var" | "fun" | "class" | "entry" | "param" | "loop" | "typealias";

export interface Decl {
  id: string;
  name: string;
  kind: DeclKind;
  file: FileSyntax;
  tok: number;
  stmt?: Stmt | undefined;
  /** Class the declaration is a member of. */
  owner?: string | undefined;
  /** Locals and parameters: token range where the name is visible. */
  scope?: [number, number] | undefined;
  type?: string | undefined;
  init?: [number, number] | undefined;
  params?: Param[] | undefined;
  /** Constructor property of `owner`. */
  ctor?: boolean;
  mods: string[];
}

export interface FileSyntax {
  path: string;
  lx: Lexed;
  toks: Tok[];
  root: Block;
  stmts: Stmt[];
  decls: Decl[];
  blockAt: Map<number, Block>;
  /** Token index of every "." / "?." before a member name. */
}

const MODIFIERS = new Set([
  "private", "public", "internal", "protected", "override", "open", "abstract", "final", "const", "lateinit", "inline", "data", "sealed", "inner",
  "operator", "infix", "suspend", "tailrec", "external", "annotation", "value", "crossinline", "noinline", "reified", "actual", "expect", "vararg", "enum", "companion", "fun",
]);
const CONT_AFTER = new Set(["+", "-", "*", "/", "%", "=", "==", "!=", "===", "!==", "<", ">", "<=", ">=", "&&", "||", "?:", ".", "?.", "->", "::", "..", "..<", "+=", "-=", "*=", "/=", "%=", "!", ":"]);
const CONT_AFTER_WORDS = new Set(["else", "in", "is", "as", "to", "until", "downTo", "step", "and", "or", "xor", "shl", "shr", "ushr"]);
const CONT_BEFORE = new Set([".", "?.", "?:", "&&", "||", "->", "as", "catch", "finally"]);

let STMT_ID = 0;

function sig(toks: Tok[], i: number, dir: 1 | -1, lo: number, hi: number): number {
  let j = i;
  while (j >= lo && j < hi && toks[j]!.k === "nl") j += dir;
  return j >= lo && j < hi ? j : -1;
}

/** Statement token ranges in [from, to). */
function splitStatements(toks: Tok[], from: number, to: number, inWhen: boolean): [number, number][] {
  const out: [number, number][] = [];
  let i = from;
  while (i < to) {
    while (i < to && (toks[i]!.k === "nl" || toks[i]!.k === "semi")) i++;
    if (i >= to) break;
    const start = i;
    let end = -1;
    while (i < to) {
      const t = toks[i]!;
      if (t.k === "open") {
        i = t.m > i && t.m < to ? t.m + 1 : i + 1;
        continue;
      }
      if (t.k === "semi") {
        const n = sig(toks, i + 1, 1, from, to);
        const nv = n >= 0 ? toks[n]!.v : "";
        const n2 = n >= 0 ? toks[n + 1]?.v : "";
        if ((nv === "get" || nv === "set") && (n2 === "(" || n2 === "=") || ((nv === "private" || nv === "internal" || nv === "protected") && n2 === "set")) {
          i++;
          continue;
        }
        end = i;
        break;
      }
      if (t.k === "nl") {
        const p = sig(toks, i - 1, -1, start, to);
        const n = sig(toks, i + 1, 1, from, to);
        if (n < 0) {
          end = i;
          break;
        }
        const pt = toks[p]!, nt = toks[n]!;
        let cont = false;
        if (pt.k === "op" && CONT_AFTER.has(pt.v)) cont = true;
        else if (pt.k === "comma") cont = true;
        else if (pt.k === "id" && CONT_AFTER_WORDS.has(pt.v)) cont = true;
        else if (nt.k === "op" && CONT_BEFORE.has(nt.v)) cont = true;
        else if (nt.k === "id" && (nt.v === "catch" || nt.v === "finally" || nt.v === "as")) cont = true;
        else if (nt.k === "id" && nt.v === "else") cont = !(inWhen && toks[sig(toks, n + 1, 1, from, to)]?.v === "->");
        else if (nt.k === "id" && (nt.v === "get" || nt.v === "set") && (toks[n + 1]?.v === "(" || toks[n + 1]?.v === "=")) cont = true;
        else if (nt.k === "id" && (nt.v === "private" || nt.v === "internal" || nt.v === "protected") && toks[n + 1]?.v === "set") cont = true;
        else {
          // only annotations so far, or a control header without its body
          let k = start;
          let onlyAnn = true;
          while (k < i) {
            const tk = toks[k]!;
            if (tk.k === "nl") {
              k++;
              continue;
            }
            if (tk.k === "op" && tk.v.startsWith("@")) {
              k++;
              if (toks[k]?.v === "(" && toks[k]!.m > k) k = toks[k]!.m + 1;
              continue;
            }
            onlyAnn = false;
            break;
          }
          if (onlyAnn) cont = true;
          else {
            const f = toks[sig(toks, start, 1, start, to)]!;
            if ((f.v === "if" || f.v === "while" || f.v === "for") && pt.v === ")" && toks[pt.m - 1] === f) cont = true;
            if (f.v === "do" && p === start) cont = true;
          }
        }
        if (cont) {
          i++;
          continue;
        }
        end = i;
        break;
      }
      i++;
    }
    if (end < 0) end = i;
    // trim trailing newlines
    let e = end;
    while (e > start && toks[e - 1]!.k === "nl") e--;
    if (e > start) out.push([start, e]);
    i = end + 1;
  }
  return out;
}

function typeText(src: string, toks: Tok[], a: number, b: number): string {
  if (a >= b) return "";
  return src.slice(toks[a]!.s, toks[b - 1]!.e).replace(/\s+/g, " ").trim();
}

/** Main type name of a type text: "List<Gate>?" → "List", with the generic argument in `arg`. */
export function typeHead(t: string | undefined): { head: string; arg?: string | undefined } | undefined {
  if (!t) return undefined;
  const m = /^([\w.]+)\s*(?:<\s*([\w.]+)[^>]*>)?\s*\??$/.exec(t.trim());
  if (!m) return undefined;
  const head = m[1]!.split(".").pop()!;
  return { head, arg: m[2]?.split(".").pop() };
}

function parseParams(src: string, toks: Tok[], open: number): Param[] {
  const close = toks[open]!.m;
  const out: Param[] = [];
  if (close <= open + 1) return out;
  let i = open + 1;
  while (i < close) {
    let j = i;
    let depth = 0;
    let angle = 0;
    while (j < close) {
      const t = toks[j]!;
      if (t.k === "open") {
        j = t.m + 1;
        continue;
      }
      if (t.v === "<") angle++;
      if (t.v === ">") angle = Math.max(0, angle - 1);
      if (t.k === "comma" && depth === 0 && angle === 0) break;
      j++;
    }
    // [i, j) is one parameter
    let k = i;
    let prop = false;
    while (k < j && (toks[k]!.k === "nl" || (toks[k]!.k === "op" && toks[k]!.v.startsWith("@")) || MODIFIERS.has(toks[k]!.v) || toks[k]!.v === "val" || toks[k]!.v === "var")) {
      if (toks[k]!.v === "val" || toks[k]!.v === "var") prop = true;
      if (toks[k]!.k === "op" && toks[k + 1]?.v === "(" && toks[k + 1]!.s === toks[k]!.e) k = toks[k + 1]!.m;
      k++;
    }
    if (k < j && toks[k]!.k === "id") {
      const name = toks[k]!.v;
      const nameTok = k;
      let colon = -1, eq = -1;
      for (let q = k + 1; q < j; q++) {
        const t = toks[q]!;
        if (t.k === "open") {
          q = t.m;
          continue;
        }
        if (t.v === ":" && colon < 0) colon = q;
        if (t.v === "=" && eq < 0) eq = q;
      }
      const type = colon >= 0 ? typeText(src, toks, colon + 1, eq >= 0 ? eq : j) : "";
      out.push({ name, tok: nameTok, type, hasDefault: eq >= 0, prop, a: i, b: j });
    }
    i = j + 1;
  }
  return out;
}

function buildBlock(f: FileSyntax, kind: BlockKind, open: number, close: number, parent: Stmt | null, extra: Partial<Block> = {}): Block {
  const block: Block = { kind, open, close, stmts: [], entries: [], parent, params: [], ...extra };
  if (open >= 0) f.blockAt.set(open, block);
  const toks = f.toks;
  let first = open + 1;
  if (kind === "lambda") {
    // `{ a, (b, c) -> … }`
    let k = first;
    while (k < close && toks[k]!.k === "nl") k++;
    let arrow = -1;
    for (let q = k; q < close; q++) {
      const t = toks[q]!;
      if (t.k === "open" && t.v === "(") {
        q = t.m;
        continue;
      }
      if (t.v === "->") {
        arrow = q;
        break;
      }
      if (!(t.k === "id" || t.k === "comma" || t.v === ":" || t.v === "." || t.v === "<" || t.v === ">" || t.v === "?" || t.k === "nl")) break;
    }
    if (arrow >= 0) {
      for (let q = k; q < arrow; q++) {
        const t = toks[q]!;
        if (t.k === "id" && toks[q - 1]?.v !== ":" && toks[q - 1]?.v !== "." && t.v !== "_") block.params.push({ name: t.v, tok: q });
      }
      first = arrow + 1;
    } else block.params.push({ name: "it", tok: -1 });
  }
  if (kind === "enum") {
    // entries up to the first top-level ";"
    let semi = close;
    for (let q = first; q < close; q++) {
      const t = toks[q]!;
      if (t.k === "open") {
        q = t.m;
        continue;
      }
      if (t.k === "semi") {
        semi = q;
        break;
      }
    }
    let q = first;
    let idx = 0;
    while (q < semi) {
      while (q < semi && (toks[q]!.k === "nl" || toks[q]!.k === "comma")) q++;
      if (q >= semi) break;
      const s = q;
      while (q < semi && toks[q]!.k !== "comma") {
        if (toks[q]!.k === "open") q = toks[q]!.m;
        q++;
      }
      let e = q;
      while (e > s && toks[e - 1]!.k === "nl") e--;
      let h = s;
      while (h < e && toks[h]!.k === "op" && toks[h]!.v.startsWith("@")) h++;
      const st: Stmt = { id: STMT_ID++, file: f, a: s, b: e, kind: "entry", block, index: idx++, blocks: [], head: h, mods: [], annotations: [], name: toks[h]?.v, nameTok: h };
      block.entries.push(st);
      f.stmts.push(st);
      for (let z = s; z < e; z++) if (toks[z]!.v === "{" && toks[z]!.k === "open") {
        st.blocks.push(buildBlock(f, "class", z, toks[z]!.m, st));
        z = toks[z]!.m;
      }
    }
    first = semi < close ? semi + 1 : close;
  }
  const ranges = splitStatements(toks, first, close, kind === "when");
  ranges.forEach(([a, b], index) => {
    const st = analyze(f, block, a, b, index);
    block.stmts.push(st);
  });
  return block;
}

function analyze(f: FileSyntax, block: Block, a: number, b: number, index: number): Stmt {
  const toks = f.toks;
  const src = f.lx.src;
  const st: Stmt = { id: STMT_ID++, file: f, a, b, kind: "expr", block, index, blocks: [], head: a, mods: [], annotations: [] };
  f.stmts.push(st);
  let h = a;
  for (;;) {
    while (h < b && toks[h]!.k === "nl") h++;
    const t = toks[h];
    if (!t) break;
    if (t.k === "op" && t.v.startsWith("@")) {
      st.annotations.push(t.v.slice(1));
      h++;
      if (toks[h]?.v === "(" && toks[h]!.s === t.e) h = toks[h]!.m + 1;
      continue;
    }
    if (t.k === "id" && MODIFIERS.has(t.v) && t.v !== "fun" && !(t.v === "companion" && toks[h + 1]?.v !== "object") && toks[h + 1]?.k === "id") {
      st.mods.push(t.v);
      h++;
      continue;
    }
    break;
  }
  st.head = h;
  const ht = toks[h];
  const hv = ht?.v ?? "";
  const findTop = (from: number, pred: (t: Tok, i: number) => boolean): number => {
    for (let q = from; q < b; q++) {
      const t = toks[q]!;
      if (pred(t, q)) return q;
      if (t.k === "open") q = t.m;
    }
    return -1;
  };
  if (block.kind === "when") {
    const arrow = findTop(a, (t) => t.v === "->");
    st.kind = "branch";
    if (arrow >= 0) st.arrow = arrow;
  } else if (hv === "import" || hv === "package") {
    st.kind = hv;
    let last = -1;
    for (let q = h + 1; q < b; q++) if (toks[q]!.k === "id") last = q;
    const asIdx = findTop(h + 1, (t) => t.v === "as");
    if (asIdx >= 0 && toks[asIdx + 1]) last = asIdx + 1;
    if (last >= 0 && toks[last]!.v !== "*") {
      st.name = toks[last]!.v;
      st.nameTok = last;
    }
  } else if (hv === "val" || hv === "var") {
    st.kind = "val";
    let q = h + 1;
    if (toks[q]?.v === "<") {
      while (q < b && toks[q]!.v !== ">") q++;
      q++;
    }
    if (toks[q]?.v === "(") {
      const close = toks[q]!.m;
      st.names = [];
      for (let z = q + 1; z < close; z++) if (toks[z]!.k === "id" && toks[z - 1]?.v !== ":" && toks[z]!.v !== "_") st.names.push({ name: toks[z]!.v, tok: z });
      q = close + 1;
    } else {
      // receiver: val Foo.bar
      while (toks[q + 1]?.v === "." && toks[q + 2]?.k === "id") q += 2;
      if (toks[q]?.k === "id") {
        st.name = toks[q]!.v;
        st.nameTok = q;
      }
      q++;
    }
    const eq = findTop(q, (t) => t.v === "=" || t.v === "by");
    if (toks[q]?.v === ":") {
      st.typeA = q + 1;
      st.typeB = eq >= 0 ? eq : b;
      // stop the type at accessors / semicolons
      for (let z = q + 1; z < st.typeB; z++) if (toks[z]!.k === "semi" || toks[z]!.k === "nl") {
        st.typeB = z;
        break;
      }
    }
    if (eq >= 0 && toks[eq]!.v === "=") {
      st.initA = eq + 1;
      let e = b;
      // `= x; private set` / get() accessors end the initializer
      const semi = findTop(eq + 1, (t) => t.k === "semi");
      if (semi >= 0) e = semi;
      for (let z = eq + 1; z < e; z++) {
        if (toks[z]!.k === "open") {
          z = toks[z]!.m;
          continue;
        }
        if (toks[z]!.k === "nl" && (toks[sig(toks, z, 1, z, b)]?.v === "get" || toks[sig(toks, z, 1, z, b)]?.v === "set" || toks[sig(toks, z, 1, z, b)]?.v === "private")) {
          e = z;
          break;
        }
      }
      while (e > eq + 1 && toks[e - 1]!.k === "nl") e--;
      st.initB = e;
    }
  } else if (hv === "fun") {
    st.kind = "fun";
    const open = findTop(h + 1, (t) => t.v === "(");
    if (open >= 0) {
      st.paramsOpen = open;
      if (toks[open - 1]?.k === "id") {
        st.name = toks[open - 1]!.v;
        st.nameTok = open - 1;
      }
      st.params = parseParams(src, toks, open);
      const close = toks[open]!.m;
      const brace = findTop(close + 1, (t) => t.v === "{" || t.v === "=");
      if (toks[close + 1]?.v === ":") st.retType = typeText(src, toks, close + 2, brace >= 0 ? brace : b);
      if (brace >= 0 && toks[brace]!.v === "=") st.bodyExpr = [brace + 1, b];
    }
  } else if (hv === "class" || hv === "interface" || hv === "object" || (hv === "companion" && toks[h + 1]?.v === "object") || hv === "typealias") {
    st.kind = hv === "typealias" ? "typealias" : "class";
    st.classKind = st.mods.includes("enum") ? "enum" : hv === "companion" ? "companion" : hv === "interface" ? "interface" : hv === "object" ? "object" : "class";
    let q = hv === "companion" ? h + 2 : h + 1;
    if (toks[q]?.k === "id" && toks[q]!.v !== ":" ) {
      st.name = toks[q]!.v;
      st.nameTok = q;
      q++;
    } else if (hv === "companion") st.name = "Companion";
    if (toks[q]?.v === "<") {
      while (q < b && toks[q]!.v !== ">") q++;
      q++;
    }
    while (toks[q]?.k === "id" && (MODIFIERS.has(toks[q]!.v) || toks[q]!.v === "constructor")) q++;
    if (toks[q]?.v === "(") {
      st.ctorOpen = q;
      st.params = parseParams(src, toks, q);
    }
  } else if (hv === "if" || hv === "for" || hv === "while" || hv === "do" || hv === "when" || hv === "return" || hv === "throw" || hv === "try") {
    st.kind = hv;
  } else {
    const op = findTop(a, (t) => t.k === "op" && (t.v === "=" || t.v === "+=" || t.v === "-=" || t.v === "*=" || t.v === "/=" || t.v === "%="));
    if (op >= 0) {
      st.kind = "assign";
      st.assignOp = op;
    }
  }

  // nested blocks
  let firstClassBrace = st.kind === "class";
  for (let q = a; q < b; q++) {
    const t = toks[q]!;
    if (t.k !== "open" || t.v !== "{") continue;
    const close = t.m > q ? t.m : b;
    let p = q - 1;
    while (p >= a && toks[p]!.k === "nl") p--;
    const pt = toks[p];
    let kind: BlockKind = "lambda";
    let role: Block["role"];
    let call: string | undefined;
    if (firstClassBrace) {
      kind = st.classKind === "enum" ? "enum" : "class";
      firstClassBrace = false;
    } else if (pt && pt.v === ")" && toks[pt.m - 1]?.v === "when") kind = "when";
    else if (pt && pt.v === "when") kind = "when";
    else if (pt && pt.v === "->") {
      kind = "body";
      role = "branch";
    } else if (pt && pt.v === ")" && ["if", "for", "while", "catch"].includes(toks[pt.m - 1]?.v ?? "")) {
      kind = "body";
      const w = toks[pt.m - 1]!.v;
      role = w === "if" ? "then" : w === "catch" ? "try" : "loop";
    } else if (pt && ["else", "try", "finally", "do", "init"].includes(pt.v)) {
      kind = "body";
      role = pt.v === "else" ? "else" : pt.v === "init" ? "init" : pt.v === "do" ? "loop" : "try";
    } else if (st.kind === "fun" && st.paramsOpen !== undefined && q > toks[st.paramsOpen]!.m && !st.bodyExpr && !st.blocks.some((x) => x.role === "fun")) {
      kind = "body";
      role = "fun";
    } else if (pt && pt.v === ")" && (toks[pt.m - 1]?.v === "get" || toks[pt.m - 1]?.v === "set")) {
      kind = "body";
      role = "accessor";
    } else {
      kind = "lambda";
      if (pt && pt.v === ")") call = toks[pt.m - 1]?.k === "id" ? toks[pt.m - 1]!.v : undefined;
      else if (pt && pt.k === "id") call = pt.v;
    }
    const blk = buildBlock(f, kind, q, close, st, { role, call });
    st.blocks.push(blk);
    q = close;
  }
  return st;
}

let DECL_ID = 0;

function collectDecls(f: FileSyntax) {
  const toks = f.toks;
  const ownerOf = (st: Stmt): { owner?: string | undefined; ctorOwner?: string | undefined } => {
    const bl = st.block;
    if (bl.kind !== "class" && bl.kind !== "enum") return {};
    const cls = bl.parent;
    if (!cls) return {};
    if (cls.classKind === "companion") {
      const outer = cls.block.parent;
      return { owner: outer?.name ?? cls.name };
    }
    return { owner: cls.name };
  };
  const add = (d: Omit<Decl, "id" | "file">) => f.decls.push({ ...d, id: `${f.path}#${DECL_ID++}`, file: f });
  for (const st of f.stmts) {
    const { owner } = ownerOf(st);
    const local = st.block.kind === "body" || st.block.kind === "lambda";
    const scope: [number, number] | undefined = local ? [st.a, st.block.close] : undefined;
    if (st.kind === "val" && st.name !== undefined && st.nameTok !== undefined) {
      add({ name: st.name, kind: toks[st.head]!.v === "var" ? "var" : "val", tok: st.nameTok, stmt: st, owner, scope, type: st.typeA !== undefined ? typeText(f.lx.src, toks, st.typeA, st.typeB!) : undefined, init: st.initA !== undefined ? [st.initA, st.initB!] : undefined, mods: st.mods });
    } else if (st.kind === "val" && st.names) {
      for (const n of st.names) add({ name: n.name, kind: "val", tok: n.tok, stmt: st, owner, scope, mods: st.mods });
    } else if (st.kind === "fun" && st.name) {
      add({ name: st.name, kind: "fun", tok: st.nameTok!, stmt: st, owner, scope, type: st.retType, params: st.params, init: st.bodyExpr, mods: st.mods });
      const end = st.b;
      for (const p of st.params ?? []) add({ name: p.name, kind: "param", tok: p.tok, stmt: st, scope: [st.paramsOpen!, end], type: p.type, mods: [] });
    } else if (st.kind === "class" && st.name) {
      add({ name: st.name, kind: "class", tok: st.nameTok ?? st.head, stmt: st, owner, mods: st.mods });
      for (const p of st.params ?? []) {
        if (p.prop) add({ name: p.name, kind: "val", tok: p.tok, stmt: st, owner: st.name, type: p.type, ctor: true, mods: [] });
        else add({ name: p.name, kind: "param", tok: p.tok, stmt: st, scope: [st.ctorOpen!, st.b], type: p.type, mods: [] });
      }
    } else if (st.kind === "typealias" && st.name) {
      add({ name: st.name, kind: "typealias", tok: st.nameTok!, stmt: st, mods: st.mods });
    } else if (st.kind === "entry" && st.name) {
      const enumStmt = st.block.parent;
      add({ name: st.name, kind: "entry", tok: st.nameTok!, stmt: st, owner: enumStmt?.name, mods: [] });
    } else if (st.kind === "for") {
      const open = st.head + 1;
      if (toks[open]?.v === "(") {
        const close = toks[open]!.m;
        let inIdx = -1;
        for (let q = open + 1; q < close; q++) {
          if (toks[q]!.k === "open") {
            if (inIdx < 0) {
              for (let z = q + 1; z < toks[q]!.m; z++) if (toks[z]!.k === "id" && toks[z - 1]?.v !== ":") add({ name: toks[z]!.v, kind: "loop", tok: z, stmt: st, scope: [st.a, st.b], mods: [] });
            }
            q = toks[q]!.m;
            continue;
          }
          if (toks[q]!.v === "in") {
            inIdx = q;
            break;
          }
        }
        if (toks[open + 1]?.k === "id") add({ name: toks[open + 1]!.v, kind: "loop", tok: open + 1, stmt: st, scope: [st.a, st.b], mods: [] });
      }
    }
    for (const bl of st.blocks) {
      if (bl.kind === "lambda") for (const p of bl.params) if (p.tok >= 0) add({ name: p.name, kind: "param", tok: p.tok, stmt: st, scope: [bl.open, bl.close], mods: [] });
    }
  }
}

export function parseFile(path: string, src: string): FileSyntax {
  const lx = lexKotlin(src);
  const f: FileSyntax = { path, lx, toks: lx.toks, root: null as unknown as Block, stmts: [], decls: [], blockAt: new Map() };
  f.root = buildBlock(f, "file", -1, lx.toks.length, null);
  collectDecls(f);
  return f;
}

/** The statement whose own tokens (outside its nested blocks) hold token `i`, innermost first. */
export function stmtChain(f: FileSyntax, i: number): Stmt[] {
  const out: Stmt[] = [];
  let block: Block | null = f.root;
  while (block) {
    const list: Stmt[] = [...block.entries, ...block.stmts];
    const st: Stmt | undefined = list.find((s) => s.a <= i && i < s.b);
    if (!st) break;
    out.unshift(st);
    block = st.blocks.find((bl) => bl.open < i && i < bl.close) ?? null;
    if (block && (block.open === i || block.close === i)) break;
  }
  return out;
}

export function enclosingBlocks(f: FileSyntax, i: number): Block[] {
  const out: Block[] = [f.root];
  let block: Block | null = f.root;
  while (block) {
    const st: Stmt | undefined = [...block.entries, ...block.stmts].find((s) => s.a <= i && i < s.b);
    if (!st) break;
    block = st.blocks.find((bl) => bl.open < i && i < bl.close) ?? null;
    if (block) out.unshift(block);
  }
  return out;
}

export function srcOf(f: FileSyntax, a: number, b: number): string {
  if (a >= b) return "";
  return f.lx.src.slice(f.toks[a]!.s, f.toks[b - 1]!.e);
}
