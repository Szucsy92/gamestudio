/**
 * Deleting code so that it looks as if it had never been written, and the rest still compiles.
 *
 * Two kinds of deletion:
 * - "absent": something is gone (a class, a function, an object of the game). Every place that refers to it goes with
 *   it: a term of a sum, an operand of a condition, an argument with a default, a list element, a `when` branch, or the
 *   whole statement; declarations that lose their last use follow (orphans), empty loops and bodies are folded away.
 * - "edit": a number (or named constant) is taken out of the expression it is written in: a factor or a term, so
 *   `a * 2.0 + 0.5` without the 2.0 reads `a + 0.5`. Allowed only where the types stay the same.
 *
 * Everything works on the base text: deleted tokens are marked, and at the end the marks become text spans.
 */
import type { Tok } from "./lex";
import { kids, LEVEL, type Arg, type Node } from "./expr";
import { nextSig, prevSig, Program, type ExprCtx, type Shader } from "./program";
import { type Block, type Decl, type FileSyntax, type Stmt } from "./syntax";

const VARARG_CALLS = new Set(["listOf", "mutableListOf", "arrayListOf", "setOf", "mutableSetOf", "hashSetOf", "linkedSetOf", "mapOf", "mutableMapOf", "hashMapOf", "linkedMapOf", "arrayOf", "intArrayOf", "floatArrayOf", "doubleArrayOf", "longArrayOf", "shortArrayOf", "booleanArrayOf"]);
const UNIT_CALLS = new Set(["forEach", "forEachIndexed", "repeat", "apply", "also", "onEach", "launch", "post", "runOnUiThread", "thread", "synchronized", "use", "edit", "setContent", "with"]);
const VACUOUS_TRUE = new Set(["all", "none"]);
/** Calls that only set state for the draws after them. */
const SETUP_FNS = new Set(["material", "place", "bindMaps", "setSway", "compose"]);
const IMPURE = /^(add|addAll|remove|removeAll|put|putAll|set|clear|poll|push|pop|next|launch|emit|post|write|play|start|stop|update|step|cue|buzz|reset|init|load|save|upload|bind|gl[A-Z]\w*|draw|retainAll|offer|send|commit|apply|edit)$/;

export type Mode = "absent" | "edit";

export interface Span {
  s: number;
  e: number;
  text: string;
}

interface ListDrop {
  file: FileSyntax | null;
  shader: Shader | null;
  /** Item token spans [a, b) and separator token index between item k and k+1. */
  items: { a: number; b: number }[];
  seps: number[];
  kind: "chain" | "args" | "entries";
  /** Chain operators (to keep a leading minus). */
  ops?: string[];
  dropped: Set<number>;
  /** Paren node around the chain (cleanup when one item is left). */
  paren?: { open: number; close: number; follow: string } | undefined;
  /** Item nodes (chains) for paren cleanup. */
  nodes?: Node[];
  /** Chain level (sum or product). */
  level?: number;
}

export interface RemoveResult {
  /** New text of every changed file. */
  texts: Map<string, string>;
  /** Spans per file (for the 3D preview / row state). */
  dead: Map<string, Uint8Array>;
  failures: string[];
  /** Human-readable list of what went: "GameRenderer.kt: 12 sor". */
  touched: Map<string, number>;
}

export class Remover {
  readonly P: Program;
  private dead = new Map<FileSyntax, Uint8Array>();
  private deadSh = new Map<Shader, Uint8Array>();
  private stmts = new Set<Stmt>();
  private decls = new Set<Decl>();
  private lists = new Map<string, ListDrop>();
  private repl: { file: FileSyntax; s: number; e: number; text: string }[] = [];
  private cuts: { file: FileSyntax; s: number; e: number }[] = [];
  private droppedNodes = new Map<FileSyntax | Shader, Set<Node>>();
  private touchedBlocks = new Set<Block>();
  private diedNames = new Set<string>();
  private diedTouched = new Set<FileSyntax>();
  private enumsTouched = new Set<Decl>();
  failures: string[] = [];

  constructor(P: Program) {
    this.P = P;
  }

  // ---- liveness
  private marks(f: FileSyntax) {
    let m = this.dead.get(f);
    if (!m) this.dead.set(f, (m = new Uint8Array(f.toks.length)));
    return m;
  }
  isDead(f: FileSyntax, tok: number) {
    return !!this.dead.get(f)?.[tok];
  }
  private kill(f: FileSyntax, a: number, b: number) {
    const m = this.marks(f);
    for (let i = a; i < b; i++) {
      if (m[i]) continue;
      m[i] = 1;
      const t = f.toks[i]!;
      if (t.k === "id") this.diedNames.add(t.v);
    }
    for (const r of f.lx.tplRefs) if (r.str >= a && r.str < b) this.diedNames.add(r.v);
    this.diedTouched.add(f);
  }
  private shMarks(sh: Shader) {
    let m = this.deadSh.get(sh);
    if (!m) this.deadSh.set(sh, (m = new Uint8Array(sh.toks.length)));
    return m;
  }
  private dropped(k: FileSyntax | Shader) {
    let s = this.droppedNodes.get(k);
    if (!s) this.droppedNodes.set(k, (s = new Set()));
    return s;
  }

  stmtDead(st: Stmt) {
    return this.stmts.has(st) || this.isDead(st.file, st.a);
  }

  // ---- public entry points
  /** Deletes a declaration (class, function, value, enum entry) with everything that refers to it. */
  deleteDecl(d: Decl, why = "") {
    if (this.decls.has(d)) return;
    this.decls.add(d);
    if (d.kind === "entry") {
      if (d.stmt && !this.stmtDead(d.stmt)) {
        this.stmts.add(d.stmt);
        this.kill(d.file, d.stmt.a, d.stmt.b);
        const en = this.enumDeclOf(d);
        if (en) this.enumsTouched.add(en);
      }
    } else if (d.ctor) {
      this.failures.push(`${d.owner}.${d.name}: konstruktor-tulajdonság, nem törölhető külön${why}`);
      return;
    } else if (d.stmt && (d.kind === "val" || d.kind === "var" || d.kind === "fun" || d.kind === "class" || d.kind === "typealias")) {
      if (d.stmt.names && d.stmt.names.length > 1) {
        // destructuring: the whole statement goes, with all its names
        this.deleteStmt(d.stmt);
      } else this.deleteStmt(d.stmt, true);
    }
    for (const r of this.P.refs(d.name)) {
      if (r.file && this.isDead(r.file, r.tok)) continue;
      if (!this.P.resolve(r).includes(d)) continue;
      if (r.str !== undefined) {
        this.absentStmtAt(r.file, r.tok);
        continue;
      }
      this.absentAt(r.file, r.tok);
    }
  }

  /** Deletes one statement (and whatever it declares). */
  deleteStmt(st: Stmt, fromDecl = false): void {
    if (this.stmtDead(st)) return;
    const f = st.file;
    const toks = f.toks;
    // a value-carrying return: the function goes (or returns null when it may)
    if (st.kind === "return" && st.b > st.head + 1) {
      const owner = this.valueOwner(st.block, true);
      if (owner === "null") return this.replaceTokens(f, st.head + 1, st.b, "null");
      if (owner) return this.escalate(owner);
    }
    // last statement of a lambda / branch whose value is used
    if (this.isLastLive(st) && st.kind !== "return") {
      const owner = this.valueOwner(st.block);
      if (owner === "null") return this.replaceTokens(f, st.a, st.b, "null");
      if (owner) return this.escalate(owner);
    }
    this.stmts.add(st);
    this.kill(f, st.a, st.b);
    this.touchedBlocks.add(st.block);
    if (!fromDecl) {
      for (const d of f.decls) if (d.stmt === st && !d.ctor && d.tok >= st.a && d.tok < st.b && (d.kind === "val" || d.kind === "var" || d.kind === "fun" || d.kind === "class" || d.kind === "typealias")) this.deleteDecl(d);
    } else {
      // other names declared by the same statement (destructuring)
      for (const d of f.decls) if (d.stmt === st && !d.ctor && !this.decls.has(d) && (d.kind === "val" || d.kind === "var")) this.deleteDecl(d);
    }
    void toks;
  }

  /** Empties a `when` branch body: `X -> {}`. */
  emptyBranch(st: Stmt) {
    if (st.arrow === undefined || this.stmtDead(st)) return;
    const f = st.file;
    const toks = f.toks;
    const a = st.arrow + 1;
    if (a >= st.b) return;
    const isBlock = toks[a]!.v === "{" && toks[a]!.m === st.b - 1;
    if (isBlock && this.blockEmpty(f.blockAt.get(a)!)) return;
    this.kill(f, a, st.b);
    this.repl.push({ file: f, s: toks[a]!.s, e: toks[st.b - 1]!.e, text: "{}" });
    this.touchedBlocks.add(st.block);
  }

  // ---- absent references
  private absentStmtAt(f: FileSyntax, tok: number) {
    const st = this.innermost(f, tok);
    if (st) this.deleteStmt(st);
  }

  private innermost(f: FileSyntax, tok: number): Stmt | undefined {
    let block: Block | null = f.root;
    let found: Stmt | undefined;
    while (block) {
      const st: Stmt | undefined = [...block.entries, ...block.stmts].find((s) => s.a <= tok && tok < s.b);
      if (!st) break;
      found = st;
      block = st.blocks.find((bl) => bl.open < tok && tok < bl.close) ?? null;
    }
    return found;
  }

  /** The reference at token `tok` is gone: remove the smallest piece of code that holds it. */
  absentAt(f: FileSyntax, tok: number): void {
    if (this.isDead(f, tok)) return;
    const toks = f.toks;
    const st = this.innermost(f, tok);
    if (!st) return;
    if (st.kind === "import") return this.deleteStmt(st);
    const ctx = this.P.exprAt(f, tok);
    if (!ctx) {
      // declaration headers: parameter or return types, supertypes, type annotations
      if (st.kind === "fun") {
        const d = f.decls.find((x) => x.stmt === st && x.kind === "fun");
        if (d) return this.deleteFunDecl(d);
      }
      if (st.kind === "class") {
        const d = f.decls.find((x) => x.stmt === st && x.kind === "class");
        if (d) return this.deleteDecl(d);
      }
      return this.deleteStmt(st);
    }
    // the node that is gone: the identifier, with its qualifier (`Palette.rock`, `SecretType.MONOLITH`)
    const path = this.pathToTok(ctx.root, tok);
    if (!path.length) return this.deleteStmt(st);
    let k = path.length - 1;
    // qualified name: x.name → the member node
    if (k > 0 && path[k - 1]!.t === "member" && (path[k - 1] as Extract<Node, { t: "member" }>).nameTok === tok) k--;
    this.absentNode(f, ctx, path, k);
    void toks;
  }

  private absentNode(f: FileSyntax, ctx: ExprCtx, path: Node[], k: number) {
    let cur = path[k]!;
    const excl = this.dropped(f);
    for (let i = k - 1; i >= 0; i--) {
      const parent = path[i]!;
      if (parent.t === "chain") {
        const live = parent.items.filter((x) => !excl.has(x));
        if (parent.level === LEVEL.add) {
          if (live.length >= 2 && this.chainDropOk(f, path, i, cur, "absent")) return this.dropChainItem(f, parent, cur);
          cur = parent;
          continue;
        }
        if (parent.level === LEVEL.or) {
          if (live.length >= 2) return this.dropChainItem(f, parent, cur);
          cur = parent;
          continue;
        }
        if (parent.level === LEVEL.and) {
          if (live.length >= 2 && this.vacuousTrue(cur)) return this.dropChainItem(f, parent, cur);
          cur = parent;
          continue;
        }
        cur = parent;
        continue;
      }
      if (parent.t === "if" && parent.cond === cur && parent.else && parent.else.t !== "opaque") {
        // `if (gone) a else b` used as a value → b
        this.kill(f, parent.a, parent.else.a);
        this.cuts.push({ file: f, s: f.toks[parent.a]!.s, e: f.toks[parent.else.a]!.s });
        this.dropped(f).add(parent.cond);
        return;
      }
      if (parent.t === "call") {
        const ai = parent.args.findIndex((a) => a.expr === cur);
        if (ai >= 0) {
          const fname = parent.fn.t === "id" ? parent.fn.name : parent.fn.t === "member" ? parent.fn.name : "";
          const liveArgs = parent.args.filter((a) => !excl.has(a.expr));
          if (VARARG_CALLS.has(fname) && liveArgs.length >= 2) return this.dropArg(f, parent, ai);
          if (this.argHasDefault(f, parent, ai)) return this.dropArg(f, parent, ai);
        }
        cur = parent;
        continue;
      }
      cur = parent;
    }
    // the whole statement part is gone
    this.absentPart(f, ctx);
  }

  private absentPart(f: FileSyntax, ctx: ExprCtx) {
    const st = ctx.stmt;
    switch (ctx.part) {
      case "body":
        if (st.kind === "fun") {
          const d = f.decls.find((x) => x.stmt === st && x.kind === "fun");
          if (d) return this.deleteFunDecl(d);
        }
        return this.deleteStmt(st);
      case "cond":
        if (st.kind === "if" && this.elseOf(st) >= 0) return this.unwrapElse(st);
        return this.deleteStmt(st);
      case "branchCond":
        return this.deleteStmt(st);
      case "branchBody": {
        const whenStmt = st.block.parent;
        if (whenStmt && whenStmt.kind === "when") return this.emptyBranch(st);
        if (whenStmt) return this.absentAt(whenStmt.file, this.whenTok(whenStmt, st.block));
        return this.deleteStmt(st);
      }
      default:
        return this.deleteStmt(st);
    }
  }

  private whenTok(parent: Stmt, block: Block): number {
    // the `when` keyword before the block
    const toks = parent.file.toks;
    for (let q = block.open; q >= parent.a; q--) if (toks[q]!.v === "when") return q;
    return block.open;
  }

  private deleteFunDecl(d: Decl) {
    if (d.mods.includes("override")) {
      this.failures.push(`${d.name}(): felülírt függvény, nem törölhető`);
      return;
    }
    this.deleteDecl(d);
  }

  private vacuousTrue(n: Node): boolean {
    let x = n;
    while (x.t === "paren") x = x.inner;
    return x.t === "call" && x.fn.t === "member" && VACUOUS_TRUE.has(x.fn.name);
  }

  private pathToTok(root: Node, tok: number): Node[] {
    const out: Node[] = [];
    let n: Node | undefined = root;
    while (n) {
      out.push(n);
      if (n.t === "id" && n.a === tok) break;
      n = kids(n).find((c) => c.a <= tok && tok < c.b);
    }
    const last = out[out.length - 1];
    if (!last || last.a > tok || last.b <= tok) return [];
    return out;
  }

  // ---- chains and arguments
  private regionTop(path: Node[], i: number): number {
    // the arithmetic region around path[i]: up through sums, products, parentheses and signs
    let j = i;
    while (j > 0) {
      const p = path[j - 1]!;
      if ((p.t === "chain" && (p.level === LEVEL.add || p.level === LEVEL.mul)) || p.t === "paren" || (p.t === "prefix" && (p.op === "-" || p.op === "+"))) j--;
      else break;
    }
    return j;
  }

  private chainDropOk(f: FileSyntax, path: Node[], i: number, item: Node, mode: Mode, sh?: Shader): boolean {
    const chain = path[i] as Extract<Node, { t: "chain" }>;
    const excl = this.dropped(sh ?? f);
    const live = chain.items.filter((x) => !excl.has(x));
    const idx = live.indexOf(item);
    if (idx < 0 || live.length < 2) return false;
    if (chain.level === LEVEL.mul) {
      const k = chain.items.indexOf(item);
      const opBefore = k > 0 ? this.opText(f, sh, chain.ops[k - 1]!) : "";
      if (idx === 0) {
        const nextK = chain.items.indexOf(live[1]!);
        const opAfter = this.opText(f, sh, chain.ops[nextK - 1]!);
        if (opAfter !== "*") return false;
      } else if (mode === "absent") return false;
      void opBefore;
    }
    const top = path[this.regionTop(path, i)]!;
    const before = sh ? this.P.glslType(sh, top, excl) : this.P.typeOf(f, top, excl);
    if (!before) return false;
    const ex2 = new Set(excl);
    ex2.add(item);
    const after = sh ? this.P.glslType(sh, top, ex2) : this.P.typeOf(f, top, ex2);
    return after === before;
  }

  private opText(f: FileSyntax, sh: Shader | undefined, tok: number) {
    return (sh ? sh.toks : f.toks)[tok]!.v;
  }

  private listKey(f: FileSyntax | Shader, a: number, b: number, kind: string) {
    return `${"path" in f ? f.path : `${f.file.path}@${f.str}`}:${kind}:${a}:${b}`;
  }

  private dropChainItem(f: FileSyntax, chain: Extract<Node, { t: "chain" }>, item: Node, sh?: Shader, paren?: Node) {
    const key = this.listKey(sh ?? f, chain.a, chain.b, "chain");
    let ld = this.lists.get(key);
    const toks = sh ? sh.toks : f.toks;
    if (!ld) {
      ld = {
        file: sh ? null : f,
        shader: sh ?? null,
        items: chain.items.map((x) => ({ a: x.a, b: x.b })),
        seps: chain.ops,
        ops: chain.ops.map((o) => toks[o]!.v),
        kind: "chain",
        dropped: new Set(),
        nodes: chain.items,
        level: chain.level,
        paren: paren && paren.t === "paren" ? { open: paren.a, close: paren.b - 1, follow: toks[paren.b]?.v ?? "" } : undefined,
      };
      this.lists.set(key, ld);
    }
    const k = chain.items.indexOf(item);
    ld.dropped.add(k);
    this.dropped(sh ?? f).add(item);
    if (sh) {
      const m = this.shMarks(sh);
      for (let q = item.a; q < item.b; q++) m[q] = 1;
    } else this.kill(f, item.a, item.b);
  }

  private dropArg(f: FileSyntax, call: Extract<Node, { t: "call" }>, ai: number) {
    const key = this.listKey(f, call.open, call.b, "args");
    let ld = this.lists.get(key);
    if (!ld) {
      const toks = f.toks;
      const seps: number[] = [];
      for (let k = 0; k < call.args.length - 1; k++) {
        let q = call.args[k]!.b;
        while (toks[q] && toks[q]!.k !== "comma") q++;
        seps.push(q);
      }
      ld = { file: f, shader: null, items: call.args.map((x) => ({ a: x.a, b: x.b })), seps, kind: "args", dropped: new Set() };
      this.lists.set(key, ld);
    }
    ld.dropped.add(ai);
    this.dropped(f).add(call.args[ai]!.expr);
    this.kill(f, call.args[ai]!.a, call.args[ai]!.b);
  }

  /** Can argument `ai` of `call` be left out (the parameter has a default and nothing positional follows)? */
  private argHasDefault(f: FileSyntax, call: Extract<Node, { t: "call" }>, ai: number): boolean {
    const fn = call.fn;
    if (call.open < 0) return false;
    const name = fn.t === "id" ? fn.name : fn.t === "member" ? fn.name : "";
    const tok = fn.t === "id" ? fn.a : fn.t === "member" ? fn.nameTok : -1;
    if (!name) return false;
    const ds = this.P.resolve({ file: f, tok, name, dot: fn.t === "member" }).filter((d) => d.kind === "fun" || d.kind === "class");
    if (ds.length !== 1) return false;
    const d = ds[0]!;
    const params = d.kind === "fun" ? d.params : d.stmt?.params;
    if (!params) return false;
    const arg = call.args[ai]!;
    const excl = this.dropped(f);
    if (arg.name) return !!params.find((p) => p.name === arg.name)?.hasDefault;
    // positional: only when every later argument is gone or named
    const later = call.args.slice(ai + 1).filter((a) => !excl.has(a.expr));
    if (later.some((a) => !a.name)) return false;
    if (call.lambda.length) return false;
    const p = params[ai];
    return !!p && p.hasDefault && !p.type.startsWith("vararg");
  }

  // ---- statements around blocks
  private elseOf(st: Stmt): number {
    const toks = st.file.toks;
    const open = st.head + 1;
    if (toks[open]?.v !== "(") return -1;
    for (let q = toks[open]!.m + 1; q < st.b; q++) {
      if (toks[q]!.k === "open") {
        q = toks[q]!.m;
        continue;
      }
      if (toks[q]!.v === "else") return q;
    }
    return -1;
  }

  /** `if (gone) A else B` → B. */
  private unwrapElse(st: Stmt) {
    const f = st.file;
    const toks = f.toks;
    const el = this.elseOf(st);
    const first = nextSig(toks, el);
    if (first < 0) return this.deleteStmt(st);
    this.kill(f, st.a, first);
    if (toks[first]!.v === "{" && toks[first]!.m === st.b - 1) {
      this.kill(f, first, first + 1);
      this.kill(f, st.b - 1, st.b);
      this.cuts.push({ file: f, s: toks[st.a]!.s, e: toks[first]!.e });
      this.cuts.push({ file: f, s: toks[st.b - 1]!.s, e: toks[st.b - 1]!.e });
    } else this.cuts.push({ file: f, s: toks[st.a]!.s, e: toks[first]!.s });
    this.touchedBlocks.add(st.block);
  }

  private blockEmpty(bl: Block) {
    const all = [...bl.entries, ...bl.stmts];
    return all.length > 0 && all.every((s) => this.stmtDead(s));
  }

  private isLastLive(st: Stmt) {
    const live = st.block.stmts.filter((s) => s !== st && !this.stmtDead(s));
    return live.length === 0 || st.block.stmts.indexOf(st) > Math.max(...live.map((s) => st.block.stmts.indexOf(s)));
  }

  /** The statement whose value the block's last statement is: a value lambda or an `if`/`when` used as an expression. */
  private valueOwner(bl: Block, isReturn = false): { file: FileSyntax; tok: number } | { fun: Decl } | "null" | null {
    const p = bl.parent;
    if (!p) return null;
    if (bl.kind === "lambda") {
      if (this.unitLambda(bl)) return null;
      if (this.lambdaReturnsNullable(bl)) return "null";
      return { file: p.file, tok: bl.open };
    }
    if (bl.kind === "body") {
      if (bl.role === "fun") {
        if (!p.retType || /^Unit\??$/.test(p.retType)) return null;
        if (isReturn && p.retType.trim().endsWith("?")) return "null";
        const d = p.file.decls.find((x) => x.stmt === p && x.kind === "fun");
        return d ? { fun: d } : null;
      }
      if (bl.role === "then" || bl.role === "else") return p.kind === "if" ? this.valueOwnerOfStmt(p) : { file: p.file, tok: bl.open };
      if (bl.role === "branch") {
        const whenStmt = p.block.parent;
        if (!whenStmt) return null;
        if (whenStmt.kind === "when") return this.valueOwnerOfStmt(whenStmt);
        return { file: whenStmt.file, tok: this.whenTok(whenStmt, p.block) };
      }
      if (bl.role === "try") return p.kind === "try" ? null : { file: p.file, tok: bl.open };
    }
    return null;
  }

  /** A control statement that is the value of its own block (last statement of a value lambda). */
  private valueOwnerOfStmt(st: Stmt): { file: FileSyntax; tok: number } | { fun: Decl } | "null" | null {
    if (!this.isLastLive(st)) return null;
    return this.valueOwner(st.block);
  }

  /** Is the lambda passed for a parameter whose function type returns `T?` (so `null` is a valid "nothing")? */
  private lambdaReturnsNullable(bl: Block): boolean {
    const p = bl.parent!;
    const ctx = this.P.exprAt(p.file, bl.open);
    if (!ctx) return false;
    let call: Extract<Node, { t: "call" }> | undefined;
    let argIndex = -1;
    let argName: string | undefined;
    const visit = (n: Node) => {
      if (n.t === "call") {
        if (n.lambda.includes(bl.open)) {
          call = n;
          argIndex = n.args.length;
        }
        n.args.forEach((a, i) => {
          if (a.expr.t === "opaque" && a.expr.a === bl.open) {
            call = n;
            argIndex = i;
            argName = a.name;
          }
        });
      }
      for (const k of kids(n)) visit(k);
    };
    visit(ctx.root);
    if (!call) return false;
    const fn = call.fn;
    const name = fn.t === "id" ? fn.name : fn.t === "member" ? fn.name : "";
    const tok = fn.t === "id" ? fn.a : fn.t === "member" ? fn.nameTok : -1;
    if (!name) return false;
    const ds = this.P.resolve({ file: p.file, tok, name, dot: fn.t === "member" }).filter((d) => d.kind === "fun");
    if (ds.length !== 1 || !ds[0]!.params) return false;
    const params = ds[0]!.params;
    const param = argName ? params.find((x) => x.name === argName) : call.lambda.includes(bl.open) ? params[params.length - 1] : params[argIndex];
    if (!param) return false;
    const m = /->\s*(.+)$/.exec(param.type);
    return !!m && m[1]!.trim().endsWith("?");
  }

  private escalate(o: { file: FileSyntax; tok: number } | { fun: Decl }): void {
    if ("fun" in o) return this.deleteFunDecl(o.fun);
    return this.absentAt(o.file, o.tok);
  }

  private unitLambda(bl: Block): boolean {
    if (bl.call && UNIT_CALLS.has(bl.call)) return true;
    const p = bl.parent!;
    if (p.kind !== "expr") return false;
    const ctx = this.P.exprAt(p.file, bl.open);
    if (!ctx || ctx.part !== "expr") return false;
    // ancestors of the lambda: only calls (and their callee chains) up to the statement
    let n: Node | undefined = ctx.root;
    while (n) {
      if (n.t === "opaque" && n.a === bl.open) return true;
      if (n.t === "call") {
        if (n.lambda.includes(bl.open)) return true;
        const arg: Arg | undefined = n.args.find((a) => a.a <= bl.open && bl.open < a.b);
        if (arg) {
          n = arg.expr;
          continue;
        }
        n = n.fn;
        continue;
      }
      if (n.t === "member") {
        n = n.recv;
        continue;
      }
      return false;
    }
    return false;
  }

  // ---- edit mode: taking a number (or a named constant) out of its expression
  /** Plans the removal of the node spanning tokens [a, b) of file `f` as written; null when not possible. */
  planEdit(f: FileSyntax, a: number, b: number): (() => void) | null {
    const ctx = this.P.exprAt(f, a);
    if (!ctx) return null;
    const path = this.pathToSpan(ctx.root, a, b);
    if (!path) return null;
    return this.planEditPath(f, path, undefined);
  }

  planEditGlsl(sh: Shader, a: number, b: number): (() => void) | null {
    const ctx = this.P.glslExprAt(sh, a);
    if (!ctx) return null;
    const path = this.pathToSpan(ctx.root, a, b);
    if (!path) return null;
    return this.planEditPath(sh.file, path, sh);
  }

  private planEditPath(f: FileSyntax, path: Node[], sh: Shader | undefined): (() => void) | null {
    let k = path.length - 1;
    const excl = this.dropped(sh ?? f);
    // a sign or parentheses that only wrap the number go with it
    while (k > 0) {
      const p = path[k - 1]!;
      if ((p.t === "prefix" && (p.op === "-" || p.op === "+")) || p.t === "paren") k--;
      else break;
    }
    if (k === 0) return null;
    const cur = path[k]!;
    const parent = path[k - 1]!;
    if (parent.t === "chain" && (parent.level === LEVEL.add || parent.level === LEVEL.mul)) {
      if (!this.chainDropOk(f, path, k - 1, cur, "edit", sh)) return null;
      const paren = path[k - 2];
      return () => this.dropChainItem(f, parent, cur, sh, paren?.t === "paren" ? paren : undefined);
    }
    if (!sh && parent.t === "call") {
      const ai = parent.args.findIndex((x: Arg) => x.expr === cur);
      if (ai >= 0 && !excl.has(cur) && this.argHasDefault(f, parent, ai)) return () => this.dropArg(f, parent, ai);
    }
    return null;
  }

  private pathToSpan(root: Node, a: number, b: number): Node[] | null {
    const out: Node[] = [];
    let n: Node | undefined = root;
    while (n) {
      out.push(n);
      if (n.a === a && n.b === b) {
        // the innermost node with this span
        let c = kids(n).find((x) => x.a === a && x.b === b);
        while (c) {
          out.push(c);
          n = c;
          c = kids(n).find((x) => x.a === a && x.b === b);
        }
        return out;
      }
      n = kids(n).find((c) => c.a <= a && b <= c.b);
    }
    return null;
  }

  /** Replaces tokens [a, b) of `f` by `text` (a neutral value such as 0.0). */
  replaceTokens(f: FileSyntax, a: number, b: number, text: string) {
    this.kill(f, a, b);
    this.repl.push({ file: f, s: f.toks[a]!.s, e: f.toks[b - 1]!.e, text });
  }

  replaceGlsl(sh: Shader, a: number, b: number, text: string) {
    const m = this.shMarks(sh);
    for (let q = a; q < b; q++) m[q] = 1;
    this.repl.push({ file: sh.file, s: sh.toks[a]!.s, e: sh.toks[b - 1]!.e, text });
  }

  replaceChars(f: FileSyntax, s: number, e: number, text: string) {
    this.repl.push({ file: f, s, e, text });
  }

  /** Is the GLSL token dead (dropped)? */
  glslDead(sh: Shader, tok: number) {
    return !!this.deadSh.get(sh)?.[tok];
  }

  dropGlslChainItem(sh: Shader, chain: Extract<Node, { t: "chain" }>, item: Node, paren?: Node) {
    this.dropChainItem(sh.file, chain, item, sh, paren);
  }

  chainDropAllowed(f: FileSyntax, path: Node[], i: number, item: Node, sh?: Shader) {
    return this.chainDropOk(f, path, i, item, "absent", sh);
  }

  droppedSet(k: FileSyntax | Shader) {
    return this.dropped(k);
  }

  /** Plans taking the reference at `tok` (a name, with its qualifier) out of its expression as written. */
  planEditRef(f: FileSyntax, tok: number): (() => void) | null {
    const ctx = this.P.exprAt(f, tok);
    if (!ctx) return null;
    const path = this.pathToTok(ctx.root, tok);
    if (!path.length) return null;
    let k = path.length - 1;
    if (k > 0 && path[k - 1]!.t === "member" && (path[k - 1] as Extract<Node, { t: "member" }>).nameTok === tok) k--;
    return this.planEditPath(f, path.slice(0, k + 1), undefined);
  }

  /** Marks a statement deleted without following its references (they are handled by the caller). */
  deleteStmtOnly(st: Stmt) {
    if (this.stmtDead(st)) return;
    this.stmts.add(st);
    this.kill(st.file, st.a, st.b);
    this.touchedBlocks.add(st.block);
  }

  /**
   * Removes an animation term: the summand that carries the motion goes (the value stays at its rest position); a
   * whole argument becomes a neutral 0 of its type; a local value that is pure motion is deleted with its uses.
   */
  removeAnimation(f: FileSyntax, a: number, b: number, sh?: Shader): boolean {
    const ctx = sh ? this.P.glslExprAt(sh, a) : this.P.exprAt(f, a);
    if (!ctx) return false;
    const path = this.pathToSpan(ctx.root, a, b);
    if (!path) return false;
    const toks = sh ? sh.toks : f.toks;
    if ((sh ? this.glslDead(sh, a) : this.isDead(f, a))) return true;
    let k = path.length - 1;
    const unit = path[k]!;
    const excl = this.dropped(sh ?? f);
    const parent = path[k - 1];
    const typeOf = (n: Node, ex?: ReadonlySet<Node>) => (sh ? this.P.glslType(sh, n, ex) : this.P.typeOf(f, n, ex));
    const zero = (t: string | undefined) => (t === "Double" ? "0.0" : t === "Float" ? "0f" : t === "Int" || t === "Long" ? "0" : t === "float" ? "0.0" : t === "int" ? "0" : undefined);
    const replace = (n: Node) => {
      const z = zero(typeOf(n, excl));
      if (!z) return false;
      if (sh) this.replaceGlsl(sh, n.a, n.b, z);
      else this.replaceTokens(f, n.a, n.b, z);
      return true;
    };
    if (parent && parent.t === "chain" && parent.level === LEVEL.add) {
      const live = parent.items.filter((x) => !excl.has(x));
      if (live.length >= 2 && this.chainDropOk(f, path, k - 1, unit, "absent", sh)) {
        // `a * (1 + motion)` → `a`: a factor that would be left as a bare 1 goes with it
        const rest = live.filter((x) => x !== unit);
        const pp = path[k - 2], mul = path[k - 3];
        const one = rest.length === 1 && rest[0]!.t === "lit" && /^1(\.0*)?[fFdD]?$/.test(toks[rest[0]!.a]!.v) && rest[0]!.b === rest[0]!.a + 1;
        if (one && pp?.t === "paren" && mul?.t === "chain" && mul.level === LEVEL.mul && this.chainDropOk(f, path, k - 3, pp, "edit", sh)) {
          this.dropChainItem(f, mul, pp, sh, path[k - 4]?.t === "paren" ? path[k - 4] : undefined);
          return true;
        }
        this.dropChainItem(f, parent, unit, sh, path[k - 2]?.t === "paren" ? path[k - 2] : undefined);
        return true;
      }
      return replace(unit);
    }
    // the term is the whole value of its region
    // `x += motion;` (also -=): the whole statement goes
    if (k === 0 || path.slice(0, k).every((n) => n.t === "paren" || (n.t === "prefix" && n.op === "-"))) {
      const opTok = path[0]!.a - 1;
      const op = toks[opTok]?.v;
      if (op === "+=" || op === "-=") {
        if (sh) return this.deleteGlslStmt(sh, opTok, path[0]!.b);
        const kc = ctx as ExprCtx;
        if (kc.stmt) {
          this.deleteStmt(kc.stmt);
          return true;
        }
      }
    }
    while (k > 0 && (path[k - 1]!.t === "paren" || (path[k - 1]!.t === "prefix" && ((path[k - 1] as Extract<Node, { t: "prefix" }>).op === "-")))) k--;
    const region = path[k]!;
    const rp = path[k - 1];
    if (!sh && rp && rp.t === "call") {
      const ai = rp.args.findIndex((x) => x.expr === region);
      if (ai >= 0 && this.argHasDefault(f, rp, ai)) {
        this.dropArg(f, rp, ai);
        return true;
      }
    }
    const kctx = sh ? null : (ctx as ExprCtx);
    if (kctx && !rp && kctx.part === "init" && kctx.stmt.kind === "val" && (kctx.stmt.block.kind === "body" || kctx.stmt.block.kind === "lambda")) {
      const d = f.decls.find((x) => x.stmt === kctx.stmt && (x.kind === "val" || x.kind === "var"));
      if (d && d.kind === "val") {
        this.deleteDecl(d);
        return true;
      }
    }
    void toks;
    return replace(region);
  }

  /**
   * A required number is gone: the smallest piece of code that holds it goes (term, argument, statement), with
   * everything that depends on it, like a deleted declaration.
   */
  absentSpan(f: FileSyntax, a: number, b: number) {
    if (this.isDead(f, a)) return;
    const ctx = this.P.exprAt(f, a);
    if (!ctx) {
      const st = this.innermost(f, a);
      if (st) this.deleteStmt(st);
      return;
    }
    const path = this.pathToSpan(ctx.root, a, b);
    if (!path) return this.deleteStmt(ctx.stmt);
    let k = path.length - 1;
    while (k > 0 && path[k - 1]!.t === "prefix" && (path[k - 1] as Extract<Node, { t: "prefix" }>).op === "-") k--;
    this.absentNode(f, ctx, path, k);
  }

  /**
   * GLSL: the statements a required number takes with it: its own statement, and when that declares a local, every
   * statement reading it (recursively). Null with a reason when that would leave the shader broken.
   */
  planAbsentGlsl(sh: Shader, tok: number): { plan: () => void } | { why: string } {
    const toks = sh.toks;
    const m = this.shMarks(sh);
    const spans: [number, number][] = [];
    const seen = new Set<number>();
    const visit = (q: number): string | null => {
      if (m[q]) return null;
      // statement start: back to ; { } outside parentheses
      let s0 = q, depth = 0;
      while (s0 > 0) {
        const t = toks[s0 - 1]!;
        if (t.k === "close") depth++;
        else if (t.k === "open" && t.v !== "{") {
          if (depth === 0) {
            const kw = toks[s0 - 2]?.v;
            if (kw === "if" || kw === "for" || kw === "while") return "egy feltételben vagy ciklusfejben áll";
            depth = 0;
          } else depth--;
        } else if (depth === 0 && (t.v === ";" || t.v === "{" || t.v === "}")) break;
        s0--;
      }
      while (toks[s0] && toks[s0]!.k === "nl") s0++;
      let e0 = q;
      while (e0 < toks.length && toks[e0]!.v !== ";") {
        const t = toks[e0]!;
        if (t.k === "open" && t.v !== "{") e0 = t.m;
        else if (t.v === "{" || t.v === "}") return "egy blokk fejében áll";
        e0++;
      }
      if (e0 >= toks.length) return "nem található a sor vége";
      if (seen.has(s0)) return null;
      seen.add(s0);
      if (toks[s0]!.v === "return") return "a shader egyik függvényének visszatérési értéke";
      spans.push([s0, e0]);
      // a declaration: its readers go too
      let n = s0;
      while (toks[n] && /^(const|highp|mediump|lowp|in|out|uniform|varying|attribute|flat|precise)$/.test(toks[n]!.v)) n++;
      if (/^(float|int|uint|bool|[iub]?vec[234]|mat[234])$/.test(toks[n]?.v ?? "") && toks[n + 1]?.k === "id" && (toks[n + 2]?.v === "=" || toks[n + 2]?.v === ";")) {
        if (/^(uniform|in|out|varying|attribute)$/.test(toks[s0]!.v)) return "egy shader-bemenet vagy -kimenet";
        const name = toks[n + 1]!.v;
        for (let r = 0; r < toks.length; r++) {
          if (r === n + 1 || toks[r]!.k !== "id" || toks[r]!.v !== name || toks[r - 1]?.v === "." || m[r]) continue;
          if (r >= s0 && r <= e0) continue;
          const why = visit(r);
          if (why) return why;
        }
      }
      return null;
    };
    const why = visit(tok);
    if (why) return { why };
    return {
      plan: () => {
        for (const [s0, e0] of spans) this.deleteGlslStmt(sh, s0 + 1 > e0 ? s0 : s0, e0, s0);
        this.glslChanged++;
      },
    };
  }

  /** Deletes the GLSL statement around `opTok` (up to the `;` at `end`), with its line when it stands alone. */
  private deleteGlslStmt(sh: Shader, opTok: number, end: number, start?: number): boolean {
    const toks = sh.toks;
    if (toks[end]?.v !== ";") return false;
    let a = start ?? -1;
    if (a < 0) {
      let q = opTok - 1;
      while (q >= 0 && toks[q]!.v !== ";" && toks[q]!.v !== "{" && toks[q]!.v !== "}") q--;
      a = q + 1;
      while (toks[a] && toks[a]!.k === "nl") a++;
    }
    const m = this.shMarks(sh);
    for (let i = a; i <= end; i++) m[i] = 1;
    const src = sh.file.lx.src;
    let s = toks[a]!.s, e = toks[end]!.e;
    const ls = src.lastIndexOf("\n", s - 1) + 1;
    const le = src.indexOf("\n", e);
    if (/^[ \t]*$/.test(src.slice(ls, s)) && le >= 0 && /^[ \t]*$/.test(src.slice(e, le))) {
      s = ls;
      e = le + 1;
    }
    this.cuts.push({ file: sh.file, s, e });
    return true;
  }

  /** The neutral value of a number that was taken out: 1 in a product, 0 in a sum (and for anything else). */
  neutralAt(path: string, pos: number): number {
    for (const ld of this.lists.values()) {
      if (ld.kind !== "chain") continue;
      const f = ld.file ?? ld.shader!.file;
      if (f.path !== path) continue;
      const toks = ld.shader ? ld.shader.toks : f.toks;
      for (const i of ld.dropped) {
        const it = ld.items[i]!;
        if (toks[it.a]!.s <= pos && pos < toks[it.b - 1]!.e) return ld.level === LEVEL.mul ? 1 : 0;
      }
    }
    return 0;
  }

  // ---- cleanup to a fixpoint
  finish() {
    for (let round = 0; round < 40; round++) {
      const before = this.stmts.size + this.decls.size + this.lists.size + this.repl.length + this.glslChanged;
      this.cleanBlocks();
      this.cleanSetup();
      this.cleanOrphans();
      this.cleanEnums();
      this.cleanImports();
      this.cleanGlslOrphans();
      this.cleanGlslBlocks();
      if (this.stmts.size + this.decls.size + this.lists.size + this.repl.length + this.glslChanged === before) break;
    }
  }

  private cleanBlocks() {
    for (const bl of [...this.touchedBlocks]) {
      const p = bl.parent;
      if (!p || this.stmtDead(p) || !this.blockEmpty(bl)) continue;
      if (bl.kind === "body") {
        if (bl.role === "loop" || bl.role === "init") this.deleteStmt(p);
        else if (bl.role === "then" && p.kind === "if" && this.elseOf(p) < 0) this.deleteStmt(p);
        else if (bl.role === "fun") {
          const d = p.file.decls.find((x) => x.stmt === p && x.kind === "fun");
          if (d && !d.mods.includes("override") && !d.mods.includes("open") && !d.mods.includes("abstract")) this.deleteDecl(d);
        } else if (bl.role === "branch") {
          const whenStmt = p.block.parent;
          if (whenStmt && whenStmt.kind === "when" && p.block.stmts.every((b) => this.stmtDead(b) || this.branchEmpty(b))) this.deleteStmt(whenStmt);
        }
      } else if (bl.kind === "when") {
        if (p.kind === "when") this.deleteStmt(p);
      } else if (bl.kind === "lambda") {
        if (this.unitLambda(bl)) this.deleteStmt(p);
      }
    }
    // when statements whose every branch is now `{}`
    for (const bl of [...this.touchedBlocks]) {
      if (bl.kind !== "when" || !bl.parent || bl.parent.kind !== "when" || this.stmtDead(bl.parent)) continue;
      if (bl.stmts.length && bl.stmts.every((b) => this.stmtDead(b) || this.branchEmpty(b))) this.deleteStmt(bl.parent);
    }
  }

  private branchEmpty(b: Stmt): boolean {
    if (b.arrow === undefined) return false;
    const f = b.file;
    const a = b.arrow + 1;
    if (this.repl.some((r) => r.file === f && r.s === f.toks[a]?.s && r.text === "{}")) return true;
    const blk = f.blockAt.get(a);
    return !!blk && blk.close === b.b - 1 && (blk.stmts.length === 0 || this.blockEmpty(blk));
  }

  private callName(st: Stmt): string | undefined {
    if (st.kind !== "expr") return undefined;
    const toks = st.file.toks;
    // name before the first "(" at depth 0
    for (let q = st.head; q < st.b; q++) {
      const t = toks[q]!;
      if (t.v === "(") return toks[q - 1]?.k === "id" ? toks[q - 1]!.v : undefined;
      if (t.k === "open") return undefined;
    }
    return undefined;
  }

  private isGl(st: Stmt) {
    const toks = st.file.toks;
    return st.kind === "expr" && toks[st.head]?.v === "GL" && toks[st.head + 1]?.v === ".";
  }

  private cleanSetup() {
    for (const bl of [...this.touchedBlocks]) {
      if (bl.parent && this.stmtDead(bl.parent)) continue;
      if (bl.kind !== "body" && bl.kind !== "lambda") continue;
      const list = bl.stmts;
      const hadDeadEffect = list.some((s) => this.stmtDead(s) && !this.isSetup(s) && !this.isGl(s) && s.kind !== "val");
      if (!hadDeadEffect) continue;
      const live = list.filter((s) => !this.stmtDead(s));
      // only state changes, local values and early returns left: the block does nothing any more
      if (live.length && live.every((s) => this.isSetup(s) || this.isGl(s) || (s.kind === "val" && this.pureInit(s)) || (bl.role === "fun" && this.bareGuard(s)))) {
        for (const s of live) this.deleteStmt(s);
        continue;
      }
      for (let i = 0; i < list.length; i++) {
        const s = list[i]!;
        if (this.stmtDead(s) || !this.isSetup(s)) continue;
        const fn = this.callName(s);
        let consumer = false, deadUse = false;
        for (let j = i + 1; j < list.length; j++) {
          const o = list[j]!;
          if (this.callName(o) === fn && !this.stmtDead(o)) break;
          if (this.stmtDead(o)) {
            if (!this.isSetup(o) && !this.isGl(o)) deadUse = true;
            continue;
          }
          if (this.isSetup(o) || this.isGl(o) || o.kind === "val") continue;
          consumer = true;
          break;
        }
        if (!consumer && deadUse) this.deleteStmt(s);
      }
    }
  }

  /** `if (…) return` without a value. */
  private bareGuard(st: Stmt): boolean {
    if (st.kind !== "if" || this.elseOf(st) >= 0) return false;
    const toks = st.file.toks;
    const close = toks[st.head + 1]?.m ?? -1;
    return close > 0 && toks[close + 1]?.v === "return" && close + 2 === st.b;
  }

  private isSetup(st: Stmt) {
    const n = this.callName(st);
    return !!n && SETUP_FNS.has(n);
  }

  private pureInit(st: Stmt): boolean {
    if (st.initA === undefined) return true;
    const toks = st.file.toks;
    for (let q = st.initA; q < st.initB!; q++) {
      const t = toks[q]!;
      if (t.k === "id" && toks[q + 1]?.v === "(" && IMPURE.test(t.v)) return false;
      if (t.k === "op" && (t.v === "++" || t.v === "--" || t.v === "+=" || t.v === "-=")) return false;
    }
    return true;
  }

  private cleanOrphans() {
    const names = [...this.diedNames];
    this.diedNames.clear();
    for (const name of names) {
      for (const d of this.P.byName.get(name) ?? []) {
        if (this.decls.has(d) || (d.stmt && this.stmtDead(d.stmt) && d.kind !== "entry")) continue;
        if (!(d.kind === "val" || d.kind === "var" || d.kind === "fun" || d.kind === "class" || d.kind === "entry" || d.kind === "typealias")) continue;
        if (d.ctor || d.mods.includes("override") || d.mods.includes("open") || d.mods.includes("abstract")) continue;
        if (d.stmt?.annotations.length && !d.stmt.annotations.includes("Test")) continue;
        if (d.kind === "entry" && d.stmt && this.stmtDead(d.stmt)) continue;
        const refs = this.P.refs(name).filter((r) => this.P.resolve(r).includes(d) && !(d.stmt && r.file === d.file && r.tok >= d.stmt.a && r.tok < d.stmt.b));
        if (!refs.length) continue; // never used: not ours to delete
        const live = refs.filter((r) => !this.isDead(r.file, r.tok));
        if (!live.length) {
          if ((d.kind === "val" || d.kind === "var") && d.stmt && !this.pureInit(d.stmt)) continue;
          if (d.kind === "entry" && !this.enumEntryDeletable(d)) continue;
          this.deleteDecl(d);
          continue;
        }
        if (d.kind === "entry") {
          // only `when` branches / map keys left: dispatch on a value that never occurs
          if (live.every((r) => this.weakRef(r)) && this.enumEntryDeletable(d)) this.deleteDecl(d);
          continue;
        }
        if (d.kind === "var" || d.kind === "val") {
          // written but never read
          const writes = live.map((r) => this.writeStmt(r));
          if (writes.every((w) => w && this.pureAssign(w))) {
            for (const w of writes) this.deleteStmt(w!);
            if (!d.stmt || this.pureInit(d.stmt)) this.deleteDecl(d);
          }
        }
      }
    }
  }

  private weakRef(r: { file: FileSyntax; tok: number }) {
    const st = this.innermost(r.file, r.tok);
    if (!st) return false;
    if (st.kind === "branch" && st.arrow !== undefined && r.tok < st.arrow) return true;
    // `X.Y to "…"` inside mapOf(…)
    const toks = r.file.toks;
    const n = nextSig(toks, r.tok);
    return n >= 0 && toks[n]!.v === "to";
  }

  private writeStmt(r: { file: FileSyntax; tok: number }): Stmt | null {
    const st = this.innermost(r.file, r.tok);
    if (!st || st.kind !== "assign" || st.assignOp === undefined || r.tok > st.assignOp) return null;
    // the reference is the last name of the assignment target
    const toks = r.file.toks;
    return prevSig(toks, st.assignOp) === r.tok && toks[st.assignOp]!.v === "=" ? st : null;
  }

  private pureAssign(st: Stmt): boolean {
    const toks = st.file.toks;
    for (let q = st.assignOp! + 1; q < st.b; q++) {
      const t = toks[q]!;
      if (t.k === "id" && toks[q + 1]?.v === "(" && IMPURE.test(t.v)) return false;
    }
    return true;
  }

  private enumDeclOf(entry: Decl): Decl | undefined {
    const en = entry.stmt?.block.parent;
    return en ? entry.file.decls.find((x) => x.stmt === en && x.kind === "class") : undefined;
  }

  /** An enum entry may go unless the enum is used by position somewhere we cannot fix. */
  private enumEntryDeletable(entry: Decl): boolean {
    const en = this.enumDeclOf(entry);
    if (!en) return false;
    for (const r of this.P.refs(en.name)) {
      if (this.isDead(r.file, r.tok)) continue;
      const toks = r.file.toks;
      const n1 = toks[r.tok + 1], n2 = toks[r.tok + 2], n3 = toks[r.tok + 3], n4 = toks[r.tok + 4], n5 = toks[r.tok + 5];
      if (n1?.v === "." && (n2?.v === "values" || n2?.v === "entries")) {
        const indexed = n2.v === "values" ? n3?.v === "(" && n4?.v === ")" && n5?.v === "[" : n3?.v === "[";
        if (indexed && !this.enumIndexFixable(r.file, r.tok)) return false;
      }
    }
    return true;
  }

  /** `E.values()[min(N - 1, floor(x * N).toInt())]`: the two counts can follow the enum size. */
  private enumIndexFixable(f: FileSyntax, tok: number): boolean {
    return !!this.enumIndexNums(f, tok);
  }

  private enumIndexNums(f: FileSyntax, tok: number): { max: number; mul: number } | null {
    const toks = f.toks;
    const open = tok + 5;
    if (toks[open]?.v !== "[") return null;
    const inner = toks.slice(open + 1, toks[open]!.m);
    const v = inner.map((t) => t.v).join(" ");
    const m = /^min \( (\d+) , floor \( .* \* (\d+) \) \. toInt \( \) \)$/.exec(v);
    if (!m) return null;
    const maxTok = open + 3;
    let mulTok = -1;
    for (let q = toks[open]!.m - 1; q > open; q--) if (toks[q]!.k === "num") {
      mulTok = q;
      break;
    }
    if (mulTok < 0 || toks[maxTok]?.k !== "num") return null;
    return { max: maxTok, mul: mulTok };
  }

  private cleanEnums() {
    for (const en of [...this.enumsTouched]) {
      if (this.decls.has(en)) continue;
      const block = en.stmt?.blocks.find((b) => b.kind === "enum");
      if (!block) continue;
      const live = block.entries.filter((s) => !this.stmtDead(s));
      if (!live.length) {
        this.deleteDecl(en);
        continue;
      }
      // keep positional picks inside the shorter enum
      for (const r of this.P.refs(en.name)) {
        if (this.isDead(r.file, r.tok)) continue;
        const nums = this.enumIndexNums(r.file, r.tok);
        if (!nums) continue;
        const f = r.file;
        const tM = f.toks[nums.max]!, tN = f.toks[nums.mul]!;
        const already = this.repl.some((x) => x.file === f && x.s === tM.s);
        if (already) this.repl = this.repl.filter((x) => !(x.file === f && (x.s === tM.s || x.s === tN.s)));
        this.repl.push({ file: f, s: tM.s, e: tM.e, text: String(live.length - 1) });
        this.repl.push({ file: f, s: tN.s, e: tN.e, text: String(live.length) });
      }
    }
  }

  /** GLSL locals that lost their last reader: `float gust = …;` goes too (repeated until nothing changes). */
  private cleanGlslOrphans() {
    for (const [sh, m] of this.deadSh) {
      const toks = sh.toks;
      for (const [name, list] of sh.vars) {
        for (const v of list) {
          if (m[v.at] || toks[v.at + 1]?.v !== "=" || !/^(float|int|vec[234]|ivec[234]|mat[234]|bool)$/.test(toks[v.at - 1]?.v ?? "")) continue;
          let semi = -1;
          for (let q = v.at + 2; q < toks.length; q++) {
            const t = toks[q]!;
            if (t.k === "open") {
              q = t.m;
              continue;
            }
            if (t.v === ";") {
              semi = q;
              break;
            }
            if (t.v === "," || t.v === "{" || t.v === "}") break;
          }
          if (semi < 0) continue;
          let all = 0, live = 0;
          for (let q = 0; q < toks.length; q++) {
            if (q === v.at || toks[q]!.k !== "id" || toks[q]!.v !== name || toks[q - 1]?.v === ".") continue;
            all++;
            if (!m[q]) live++;
          }
          if (all > 0 && live === 0) {
            // the initializer may hold function calls with side effects only through out-params, which GLSL locals do not
            this.deleteGlslStmt(sh, v.at + 1, semi);
            this.glslChanged++;
          }
        }
      }
    }
  }
  private glslChanged = 0;

  /** `if (…) { }` / `for (…) { }` whose whole body went, without an else: the statement goes. */
  private cleanGlslBlocks() {
    for (const [sh, m] of this.deadSh) {
      const toks = sh.toks;
      for (let q = 0; q < toks.length; q++) {
        const kw = toks[q]!.v;
        if ((kw !== "if" && kw !== "for") || m[q] || toks[q + 1]?.v !== "(") continue;
        const close = toks[q + 1]!.m;
        const open = close + 1;
        if (toks[open]?.v !== "{") continue;
        const end = toks[open]!.m;
        if (end <= open + 1) continue;
        let all = true;
        for (let i = open + 1; i < end; i++) if (!m[i] && toks[i]!.k !== "nl") {
          all = false;
          break;
        }
        if (!all || toks[end + 1]?.v === "else" || toks[q - 1]?.v === "else") continue;
        for (let i = q; i <= end; i++) m[i] = 1;
        const src = sh.file.lx.src;
        let s0 = toks[q]!.s, e0 = toks[end]!.e;
        const ls = src.lastIndexOf("\n", s0 - 1) + 1;
        const le = src.indexOf("\n", e0);
        if (/^[ \t]*$/.test(src.slice(ls, s0)) && le >= 0 && /^[ \t]*$/.test(src.slice(e0, le))) {
          s0 = ls;
          e0 = le + 1;
        }
        this.cuts.push({ file: sh.file, s: s0, e: e0 });
        this.glslChanged++;
      }
    }
  }

  private cleanImports() {
    for (const f of [...this.diedTouched]) {
      for (const st of f.root.stmts) {
        if (st.kind !== "import" || !st.name || this.stmtDead(st)) continue;
        const refs = this.P.refs(st.name).filter((r) => r.file === f && !(r.tok >= st.a && r.tok < st.b));
        if (refs.length && refs.every((r) => this.isDead(f, r.tok))) this.deleteStmt(st);
      }
    }
  }

  // ---- text
  /** The new source of every changed file, with `extra` replacements (number edits) applied where still alive. */
  render(extra: Map<string, Span[]> = new Map()): Map<string, string> {
    const byFile = new Map<string, { dels: [number, number][]; reps: Span[] }>();
    const get = (p: string) => {
      let x = byFile.get(p);
      if (!x) byFile.set(p, (x = { dels: [], reps: [] }));
      return x;
    };
    // statements, grouped per block
    const perBlock = new Map<Block, Stmt[]>();
    for (const st of this.stmts) {
      const a = perBlock.get(st.block);
      if (a) a.push(st);
      else perBlock.set(st.block, [st]);
    }
    for (const [bl, sts] of perBlock) {
      const f = sts[0]!.file;
      const out = get(f.path);
      if (bl.kind === "enum" && sts.every((s) => s.kind === "entry")) {
        this.renderList(f.lx.src, f.toks, bl.entries.map((s) => ({ a: s.a, b: s.b })), this.entrySeps(f, bl), new Set(bl.entries.flatMap((s, i) => (this.stmtDead(s) ? [i] : []))), out.dels, "entries");
        continue;
      }
      for (const st of sts) if (st.kind === "entry") {
        // mixed: entries via the list, statements below
        this.renderList(f.lx.src, f.toks, bl.entries.map((s) => ({ a: s.a, b: s.b })), this.entrySeps(f, bl), new Set(bl.entries.flatMap((s, i) => (this.stmtDead(s) ? [i] : []))), out.dels, "entries");
        break;
      }
      this.renderStmts(f, bl, out.dels);
    }
    for (const ld of this.lists.values()) {
      const f = ld.file ?? ld.shader!.file;
      const toks = ld.shader ? ld.shader.toks : f.toks;
      const out = get(f.path);
      this.renderList(f.lx.src, toks, ld.items, ld.seps, ld.dropped, out.dels, ld.kind, ld.ops);
      // (x) left alone in its parentheses → x
      if (ld.paren && ld.nodes) {
        const live = ld.nodes.filter((_, i) => !ld.dropped.has(i));
        if (live.length === 1) {
          const n = live[0]!;
          const atomic = n.t === "id" || n.t === "member" || n.t === "call" || n.t === "index" || n.t === "paren" || (n.t === "lit" && ld.paren.follow !== "." && ld.paren.follow !== "?.");
          if (atomic) {
            out.dels.push([toks[ld.paren.open]!.s, toks[ld.paren.open]!.e]);
            out.dels.push([toks[ld.paren.close]!.s, toks[ld.paren.close]!.e]);
          }
        }
      }
    }
    for (const c of this.cuts) get(c.file.path).dels.push([c.s, c.e]);
    for (const r of this.repl) get(r.file.path).reps.push({ s: r.s, e: r.e, text: r.text });
    for (const [p, spans] of extra) get(p).reps.push(...spans);

    const texts = new Map<string, string>();
    for (const [path, { dels, reps }] of byFile) {
      const f = this.P.files.get(path);
      if (!f) continue;
      const src = f.lx.src;
      const merged = mergeSpans(dels);
      const inDel = (s: number, e: number) => merged.some(([a, b]) => s >= a && e <= b);
      const keptReps = reps.filter((r) => !inDel(r.s, r.e));
      // a replacement swallows the deletions inside it
      const finalDels = merged.filter(([a, b]) => !keptReps.some((r) => a >= r.s && b <= r.e));
      const ops: { s: number; e: number; text: string }[] = [...finalDels.map(([s, e]) => ({ s, e, text: "" })), ...keptReps];
      // a deleted paragraph between two blank lines leaves one blank line
      for (const o of ops) {
        if (o.text || o.s === 0 || src[o.s - 1] !== "\n" || (o.e < src.length && src[o.e - 1] !== "\n")) continue;
        const prevStart = src.lastIndexOf("\n", o.s - 2) + 1;
        const blankBefore = /^[ \t]*$/.test(src.slice(prevStart, o.s - 1)) || o.s - 1 === prevStart - 1;
        const nl = src.indexOf("\n", o.e);
        const blankAfter = nl >= 0 && /^[ \t]*$/.test(src.slice(o.e, nl));
        if (blankBefore && blankAfter) o.e = nl + 1;
      }
      ops.sort((x, y) => y.s - x.s || y.e - x.e);
      let out = src;
      let last = Infinity;
      for (const o of ops) {
        if (o.e > last) continue; // overlapping: the later (outer) one already applied
        out = out.slice(0, o.s) + o.text + out.slice(o.e);
        last = o.s;
      }
      if (out !== src) texts.set(path, out);
    }
    return texts;
  }

  private entrySeps(f: FileSyntax, bl: Block): number[] {
    const seps: number[] = [];
    for (let k = 0; k < bl.entries.length - 1; k++) {
      let q = bl.entries[k]!.b;
      while (f.toks[q] && f.toks[q]!.k !== "comma") q++;
      seps.push(q);
    }
    return seps;
  }

  /** Deletes the dropped items of a separated list (arguments, terms, enum entries) and the separators between them. */
  private renderList(src: string, toks: Tok[], items: { a: number; b: number }[], seps: number[], dropped: Set<number>, dels: [number, number][], kind: string, ops?: string[]) {
    const n = items.length;
    const s = (i: number) => toks[items[i]!.a]!.s;
    const e = (i: number) => toks[items[i]!.b - 1]!.e;
    let i = 0;
    while (i < n) {
      if (!dropped.has(i)) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < n && dropped.has(j + 1)) j++;
      const prevKept = i - 1;
      const nextKept = j + 1 < n ? j + 1 : -1;
      if (prevKept >= 0) {
        // ", x" / " + x"
        const multiLine = src.slice(e(prevKept), s(i)).includes("\n");
        if (multiLine && kind !== "chain") {
          // one item per line: take the lines of the run, keep the separator layout
          const sepAfterPrev = toks[seps[prevKept]!]!;
          dels.push([sepAfterPrev.s, nextKept >= 0 ? toks[seps[j]!]!.s : e(j) + trailingComma(src, e(j))]);
        } else dels.push([e(prevKept), e(j)]);
      } else if (nextKept >= 0) {
        const op = ops?.[nextKept - 1];
        if (kind === "chain" && op === "-") {
          // "a - b" without a → "-b"
          const opTok = toks[seps[nextKept - 1]!]!;
          dels.push([s(i), opTok.s]);
          dels.push([opTok.e, s(nextKept)]);
        } else dels.push([s(i), s(nextKept)]);
      } else {
        // everything went: callers only do this for lists that may be empty
        dels.push([s(i), e(j) + (kind === "chain" ? 0 : trailingComma(src, e(j)))]);
      }
      i = j + 1;
    }
  }

  private renderStmts(f: FileSyntax, bl: Block, dels: [number, number][]) {
    const src = f.lx.src;
    const toks = f.toks;
    const list = bl.stmts;
    // groups of statements joined by ";" on one line
    let i = 0;
    while (i < list.length) {
      let j = i;
      while (j + 1 < list.length && sameLineJoined(src, toks, list[j]!, list[j + 1]!)) j++;
      const group = list.slice(i, j + 1);
      const deadIdx = new Set(group.flatMap((st, k) => (this.stmts.has(st) || this.stmtDead(st) ? [k] : [])));
      if (deadIdx.size) {
        const gs = toks[group[0]!.a]!.s, ge = toks[group[group.length - 1]!.b - 1]!.e;
        if (deadIdx.size === group.length && fullLines(src, gs, ge)) dels.push(lineSpan(src, gs, ge));
        else if (group.length === 1) {
          const st = group[0]!;
          dels.push([toks[st.a]!.s, toks[st.b - 1]!.e]);
        } else {
          const seps: number[] = [];
          for (let k = 0; k < group.length - 1; k++) {
            let q = group[k]!.b;
            while (toks[q] && toks[q]!.k !== "semi") q++;
            seps.push(q);
          }
          this.renderList(src, toks, group.map((st) => ({ a: st.a, b: st.b })), seps, deadIdx, dels, "stmts");
        }
      }
      i = j + 1;
    }
    // comments that described only deleted lines
    attachComments(src, f.lx.comments, dels, bl, toks);
  }

  /** Which literal spans of `f` are gone. */
  deadMarks(): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    for (const [f, m] of this.dead) out.set(f.path, m);
    return out;
  }

  deadShaderTok(sh: Shader, tok: number) {
    return !!this.deadSh.get(sh)?.[tok] || this.isDead(sh.file, sh.str) && false;
  }

  /** Is char offset `pos` of `path` inside deleted code? */
  charDead(path: string, pos: number): boolean {
    const f = this.P.files.get(path);
    if (!f) return false;
    const m = this.dead.get(f);
    // token containing pos
    let lo = 0, hi = f.toks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = f.toks[mid]!;
      if (t.e <= pos) lo = mid + 1;
      else if (t.s > pos) hi = mid - 1;
      else {
        if (m?.[mid]) return true;
        if (t.k === "str") {
          const sh = this.P.shaders.find((s) => s.file === f && s.str === mid);
          if (sh) {
            const sm = this.deadSh.get(sh);
            if (!sm) return false;
            for (let q = 0; q < sh.toks.length; q++) if (sh.toks[q]!.s <= pos && pos < sh.toks[q]!.e) return !!sm[q];
          }
        }
        return false;
      }
    }
    // between tokens: inside a deleted statement?
    return false;
  }

  stats(): { stmts: number; decls: number } {
    return { stmts: this.stmts.size, decls: this.decls.size };
  }
}

function trailingComma(src: string, at: number): number {
  const m = /^\s*,/.exec(src.slice(at, at + 40));
  return m ? m[0].length : 0;
}

function sameLineJoined(src: string, toks: Tok[], a: Stmt, b: Stmt): boolean {
  const between = src.slice(toks[a.b - 1]!.e, toks[b.a]!.s);
  return !between.includes("\n") && between.includes(";");
}

function fullLines(src: string, s: number, e: number): boolean {
  const ls = src.lastIndexOf("\n", s - 1) + 1;
  let le = src.indexOf("\n", e);
  if (le < 0) le = src.length;
  return /^\s*$/.test(src.slice(ls, s)) && /^\s*;?\s*(\/\/.*)?$/.test(src.slice(e, le));
}

function lineSpan(src: string, s: number, e: number): [number, number] {
  const ls = src.lastIndexOf("\n", s - 1) + 1;
  let le = src.indexOf("\n", e);
  le = le < 0 ? src.length : le + 1;
  return [ls, le];
}

function mergeSpans(spans: [number, number][]): [number, number][] {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Comment lines right above deleted lines go when the whole paragraph below them went. */
function attachComments(src: string, comments: [number, number][], dels: [number, number][], bl: Block, toks: Tok[]) {
  const lo = bl.open >= 0 ? toks[bl.open]!.e : 0;
  const hi = bl.close < toks.length ? toks[bl.close]!.s : src.length;
  const merged = mergeSpans(dels);
  const deleted = (pos: number) => merged.some(([a, b]) => pos >= a && pos < b);
  for (const [cs, ce] of comments) {
    if (cs < lo || ce > hi) continue;
    const ls = src.lastIndexOf("\n", cs - 1) + 1;
    if (!/^\s*$/.test(src.slice(ls, cs))) continue; // trailing comment: goes with its line
    if (deleted(cs)) continue;
    let le = src.indexOf("\n", ce);
    if (le < 0) le = src.length;
    if (!/^\s*$/.test(src.slice(ce, le))) continue;
    // following lines up to a blank line or the block end: all deleted (comments in between are fine)?
    let p = le + 1;
    let sawCode = false, allGone = true;
    while (p < hi) {
      let e = src.indexOf("\n", p);
      if (e < 0) e = src.length;
      const line = src.slice(p, e);
      if (/^\s*$/.test(line)) break;
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) {
        if (sawCode) break; // the next comment starts the next section
        p = e + 1;
        continue;
      }
      if (/^\}/.test(t) && !deleted(p + line.indexOf("}"))) break;
      sawCode = true;
      const first = p + line.length - line.trimStart().length;
      if (!deleted(first)) {
        allGone = false;
        break;
      }
      p = e + 1;
    }
    if (sawCode && allGone) dels.push([ls, Math.min(src.length, le + 1)]);
  }
}
