/**
 * Everything that can be deleted, and the deletion state of a repo: elements, their objects and parts
 * (structure.ts), the animations found in the code (time-driven terms), and every value. A set of item ids is
 * applied in one go onto the base repo by the deletion engine (code/remove.ts), so undo is just a smaller set.
 */
import { CURATED, patternRegex, type ElementId } from "./curated";
import { ELEMENT_REMOVALS, OBJECTS, type ObjectDef, type RootDef } from "./structure";
import { kids, type Node } from "./code/expr";
import { Program, type Shader } from "./code/program";
import { Remover, type Span } from "./code/remove";
import { srcOf, stmtChain, type FileSyntax, type Stmt } from "./code/syntax";
import { formatLiteral, type Literal } from "./scan";
import type { Model } from "./catalog";

export type ItemKind = "element" | "object" | "part" | "anim" | "value";

export interface RemovalItem {
  id: string;
  kind: ItemKind;
  label: string;
  element: ElementId;
  /** Containing item (object of a part or animation). */
  parent?: string | undefined;
  /** 3D preview pieces it hides. */
  preview: string[];
  /** "GameRenderer.kt:958" */
  where?: string | undefined;
  apply: (R: Remover) => boolean;
  /** Is it gone in this state (deleted itself or by something else)? */
  probe?: (R: Remover) => boolean;
  /** Where the item's code is (objects and parts): source ranges across files, to list the numbers inside. */
  spans?: () => { path: string; s: number; e: number }[];
}

export interface TreeNode {
  item: RemovalItem;
  children: TreeNode[];
}

export interface Catalog {
  P: Program;
  items: Map<string, RemovalItem>;
  tree: Map<ElementId, TreeNode[]>;
  /** literal id → curated row key */
  curatedOfLit: Map<string, string>;
}

const ORDER: Record<ItemKind, number> = { element: 0, object: 1, part: 2, anim: 3, value: 4 };
const catalogs = new WeakMap<Model, Catalog>();

export function programFor(model: Model): Program {
  return catalogFor(model).P;
}

function findFileS(P: Program, suffix: string): FileSyntax | undefined {
  for (const [p, f] of P.files) if (p === suffix || p.endsWith("/" + suffix)) return f;
  return undefined;
}

function tokAt(f: FileSyntax, pos: number): number {
  let lo = 0, hi = f.toks.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const t = f.toks[m]!;
    if (t.e <= pos) lo = m + 1;
    else if (t.s > pos) hi = m - 1;
    else return m;
  }
  return -1;
}

function shTokAt(sh: Shader, pos: number): number {
  return sh.toks.findIndex((t) => t.s <= pos && pos < t.e);
}

/** Statements (or branches) a pattern root points at. */
function locate(P: Program, root: Extract<RootDef, { file: string }>): Stmt | undefined {
  const f = findFileS(P, root.file);
  if (!f) return undefined;
  const find = "stmt" in root ? root.stmt : root.branch;
  const re = patternRegex(find);
  const src = f.lx.src;
  const from = root.after ? src.indexOf(root.after) : 0;
  if (from < 0) return undefined;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  let count = 0;
  const nth = "nth" in root ? root.nth ?? 1 : 1;
  while ((m = re.exec(src))) {
    if (++count < nth) continue;
    const tok = tokAt(f, m.index);
    if (tok < 0) return undefined;
    const chain = stmtChain(f, tok);
    if ("branch" in root) return chain.find((s) => s.kind === "branch");
    return chain.find((s) => s.a === tok || s.head === tok) ?? chain[0];
  }
  return undefined;
}

function declsOf(P: Program, root: Extract<RootDef, { decl: string }>) {
  return (P.byName.get(root.decl) ?? []).filter((d) => (root.owner ? d.owner === root.owner && d.kind === "entry" : !d.owner && !d.scope && (d.kind === "class" || d.kind === "fun" || d.kind === "val" || d.kind === "var")));
}

function applyRoots(P: Program, roots: RootDef[], R: Remover): boolean {
  let any = false;
  for (const r of roots) {
    if ("decl" in r) {
      for (const d of declsOf(P, r)) {
        R.deleteDecl(d);
        any = true;
      }
    } else {
      const st = locate(P, r);
      if (!st) continue;
      if ("branch" in r) R.emptyBranch(st);
      else R.deleteStmt(st);
      any = true;
    }
  }
  return any;
}

function rootsGone(P: Program, roots: RootDef[], R: Remover): boolean {
  let seen = false;
  for (const r of roots) {
    if ("decl" in r) {
      for (const d of declsOf(P, r)) {
        seen = true;
        if (!d.stmt || !R.stmtDead(d.stmt)) return false;
      }
    } else {
      const st = locate(P, r);
      if (!st) continue;
      seen = true;
      if ("branch" in r) {
        if (!R.stmtDead(st) && !(st.arrow !== undefined && R.isDead(st.file, st.arrow + 1))) return false;
      } else if (!R.stmtDead(st)) return false;
    }
  }
  return seen;
}

function rootsExist(P: Program, roots: RootDef[]): boolean {
  return roots.some((r) => ("decl" in r ? declsOf(P, r).length > 0 : !!locate(P, r)));
}

/** Source ranges of the roots' statements/declarations (Simulation.kt and GameRenderer.kt alike). */
function rootSpans(P: Program, roots: RootDef[]): { path: string; s: number; e: number }[] {
  const out: { path: string; s: number; e: number }[] = [];
  const add = (st: Stmt | undefined) => {
    if (st) out.push({ path: st.file.path, s: st.file.toks[st.a]!.s, e: st.file.toks[st.b - 1]!.e });
  };
  for (const r of roots) {
    if ("decl" in r) for (const d of declsOf(P, r)) add(d.stmt);
    else add(locate(P, r));
  }
  return out;
}

function whereOf(P: Program, roots: RootDef[]): string | undefined {
  for (const r of roots) {
    if ("decl" in r) {
      const d = declsOf(P, r)[0];
      if (d) return `${d.file.path.split("/").pop()}:${lineOf(d.file.lx.src, d.file.toks[d.tok]!.s)}`;
    } else {
      const st = locate(P, r);
      if (st) return `${st.file.path.split("/").pop()}:${lineOf(st.file.lx.src, st.file.toks[st.a]!.s)}`;
    }
  }
  return undefined;
}

function lineOf(src: string, pos: number) {
  let n = 1;
  for (let i = 0; i < pos; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

// ---- animations
interface Anim {
  f: FileSyntax;
  sh?: Shader | undefined;
  a: number;
  b: number;
  fn: string;
  text: string;
}

const TIME_INIT = /^\s*(?:[\w.]*\.)?(?:elapsed|animT|time|clock)(?:\.toFloat\(\)|\.toDouble\(\))?\s*$/;

function pathTo(root: Node, a: number, b: number): Node[] {
  const out: Node[] = [];
  let n: Node | undefined = root;
  while (n) {
    out.push(n);
    if (n.a === a && n.b === b) break;
    n = kids(n).find((c) => c.a <= a && b <= c.b);
  }
  const last = out[out.length - 1];
  return last && last.a <= a && last.b >= b ? out : [];
}

const isTrig = (n: Node) => n.t === "call" && n.fn.t === "id" && (n.fn.name === "sin" || n.fn.name === "cos");

/** Is path[i] (through sums, products, parentheses and signs only) an argument of sin/cos? */
function underTrig(path: Node[], i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const p = path[j]!;
    if (isTrig(p)) return true;
    if ((p.t === "chain" && (p.level === 9 || p.level === 10)) || p.t === "paren" || p.t === "prefix") continue;
    return false;
  }
  return false;
}

function animUnit(path: Node[], isTime: (n: Node) => boolean, timeNode: Node): Node | null {
  let k = path.length - 1;
  let cur = path[k]!;
  if (cur !== timeNode) return null;
  let periodic = false;
  const linear = (n: Node) => {
    let x = n;
    while (x.t === "paren") x = x.inner;
    if (x.t !== "chain" || x.level !== 10) return false;
    return x.items.some((it) => isTime(it) || (it.t === "prefix" && it.op === "-" && isTime(it.arg)));
  };
  for (let i = k - 1; i >= 0; i--) {
    const n = path[i]!;
    if (n.t === "call" && n.fn.t === "id" && (n.fn.name === "sin" || n.fn.name === "cos") && n.args.some((a) => a.expr === cur)) {
      periodic = true;
      cur = n;
      continue;
    }
    if (n.t === "member" && n.recv === cur && (n.name === "toFloat" || n.name === "toDouble")) {
      cur = n;
      continue;
    }
    if (n.t === "call" && n.fn === cur) {
      cur = n;
      continue;
    }
    if (n.t === "chain" && n.level === 10) {
      cur = n;
      continue;
    }
    if (n.t === "prefix" && n.op === "-") {
      cur = n;
      continue;
    }
    if (n.t === "chain" && n.level === 9) {
      // a phase inside sin/cos (`sin(t * 1.3 + i)`): the motion is the whole wave, further up
      if (!periodic && underTrig(path, i)) {
        cur = n;
        continue;
      }
      if (periodic || linear(cur)) return cur;
      return null;
    }
    if (n.t === "paren") {
      cur = n;
      continue;
    }
    if (n.t === "call" && n.args.some((a) => a.expr === cur)) return periodic || linear(cur) ? cur : null;
    return null;
  }
  return periodic || linear(cur) ? cur : null;
}

function detectAnimations(P: Program): Anim[] {
  const out: Anim[] = [];
  const seen = new Set<string>();
  for (const f of P.files.values()) {
    if (/\/src\/test\//.test(f.path)) continue;
    const timeDecls = new Set(f.decls.filter((d) => d.kind === "val" && d.scope && d.init && TIME_INIT.test(srcOf(f, d.init[0], d.init[1]))));
    const toks = f.toks;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (t.k !== "id") continue;
      const prev = toks[i - 1]?.v;
      let isT = t.v === "animT" || (t.v === "elapsed" && prev === ".");
      if (!isT && timeDecls.size && (t.v === "t" || [...timeDecls].some((d) => d.name === t.v))) {
        const ds = P.resolve({ file: f, tok: i, name: t.v, dot: prev === "." });
        isT = ds.length === 1 && timeDecls.has(ds[0]!);
      }
      if (!isT) continue;
      const ctx = P.exprAt(f, i);
      if (!ctx || ctx.part === "cond" || ctx.part === "branchCond" || ctx.part === "iter" || ctx.part === "lhs") continue;
      let leafA = i;
      if (prev === "." && t.v === "elapsed") {
        // s.elapsed: the member node
        let p = i - 2;
        while (p >= 0 && toks[p]!.k === "id" && toks[p - 1]?.v === ".") p -= 2;
        leafA = p;
      }
      const path = pathTo(ctx.root, leafA, i + 1);
      if (!path.length) continue;
      const leaf = path[path.length - 1]!;
      const isTime = (n: Node) => (n.t === "id" && (n.name === t.v)) || (n.t === "member" && n.name === "elapsed") || n === leaf;
      const unit = animUnit(path, isTime, leaf);
      if (!unit) continue;
      const key = `${f.path}:${unit.a}:${unit.b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const fn = stmtChain(f, i).map((s) => (s.kind === "fun" ? s.name : undefined)).find(Boolean) ?? f.path.split("/").pop()!.replace(".kt", "");
      out.push({ f, a: unit.a, b: unit.b, fn, text: srcOf(f, unit.a, unit.b) });
    }
  }
  for (const sh of P.shaders) {
    const toks = sh.toks;
    const timeNames = new Set(["uTime", "time"].filter((n) => sh.vars.has(n)));
    // float locals computed from the time
    for (const [name, list] of sh.vars) {
      for (const v of list) {
        if (toks[v.at + 1]?.v !== "=") continue;
        for (let q = v.at + 2; q < toks.length && toks[q]!.k !== "semi"; q++) if (timeNames.has(toks[q]!.v)) {
          timeNames.add(name);
          break;
        }
      }
    }
    if (!timeNames.size) continue;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (t.k !== "id" || !timeNames.has(t.v) || toks[i - 1]?.v === ".") continue;
      if (toks[i + 1]?.v === "=" || toks[i - 1]?.v === "float") continue;
      const ctx = P.glslExprAt(sh, i);
      if (!ctx) continue;
      const path = pathTo(ctx.root, i, i + 1);
      if (!path.length) continue;
      const leaf = path[path.length - 1]!;
      const unit = animUnit(path, (n) => n.t === "id" && timeNames.has(n.name), leaf);
      if (!unit) continue;
      const key = `${sh.file.path}@${sh.str}:${unit.a}:${unit.b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sname = srcOf(sh.file, Math.max(0, sh.str - 3), sh.str).match(/(\w+)\s*=\s*$/)?.[1] ?? "shader";
      out.push({ f: sh.file, sh, a: unit.a, b: unit.b, fn: sname, text: sh.file.lx.src.slice(toks[unit.a]!.s, toks[unit.b - 1]!.e) });
    }
  }
  return out;
}

function elementOfPath(path: string): ElementId {
  if (/\/gl\//.test(path)) return "graphics";
  if (/\/audio\//.test(path)) return "sound";
  if (/\/(sim|input)\//.test(path) || path.endsWith("/GameEngine.kt")) return "gameplay";
  return "other";
}

function animLabel(labels: string[], text: string, fn: string): string {
  if (labels.length) {
    if (labels.length === 1) return labels[0]!;
    // common leading words ("Lebegés magassága", "Lebegés sebessége" → "Lebegés")
    const split = labels.map((l) => l.split(/\s+/));
    const common: string[] = [];
    for (let k = 0; k < split[0]!.length; k++) {
      const w = split[0]![k]!;
      if (split.every((x) => x[k] === w)) common.push(w);
      else break;
    }
    const c = common.join(" ").replace(/[:,]$/, "");
    return c.length >= 4 && !/\d\.?$/.test(c) ? c : labels.join(" + ");
  }
  const short = text.replace(/\s+/g, " ");
  return `${fn}() · ${short.length > 46 ? short.slice(0, 45) + "…" : short}`;
}

export function catalogFor(model: Model): Catalog {
  const c = catalogs.get(model);
  if (c) return c;
  const P = new Program(model.kt);
  const items = new Map<string, RemovalItem>();
  const tree = new Map<ElementId, TreeNode[]>();
  const add = (el: ElementId, node: TreeNode) => {
    const a = tree.get(el);
    if (a) a.push(node);
    else tree.set(el, [node]);
  };
  // literal (file + start) → curated row key, label, group
  const curatedOfLit = new Map<string, string>();
  const rowAt = new Map<string, { key: string; label: string; group: string }>();
  for (const def of CURATED) {
    for (const id of model.curated.get(def.key) ?? []) {
      const lit = model.lits.get(id);
      if (!lit) continue;
      curatedOfLit.set(id, def.key);
      rowAt.set(`${lit.file}:${lit.start}`, { key: def.key, label: def.label, group: def.group });
      if (lit.raw.startsWith("-")) rowAt.set(`${lit.file}:${lit.start + 1}`, { key: def.key, label: def.label, group: def.group });
    }
  }

  // elements, objects, parts
  const objectNodes = new Map<string, TreeNode>();
  const elementNodes = new Map<ElementId, TreeNode>();
  for (const e of ELEMENT_REMOVALS) {
    if (!rootsExist(P, e.roots)) continue;
    const item: RemovalItem = { id: `e:${e.element}`, kind: "element", label: e.label, element: e.element, preview: e.preview, where: whereOf(P, e.roots), apply: (R) => applyRoots(P, e.roots, R), probe: (R) => rootsGone(P, e.roots, R) };
    items.set(item.id, item);
    const node = { item, children: [] };
    elementNodes.set(e.element, node);
    add(e.element, node);
  }
  for (const o of OBJECTS) {
    if (!rootsExist(P, o.roots)) continue;
    const item: RemovalItem = { id: `o:${o.key}`, kind: "object", label: o.label, element: o.element, parent: elementNodes.get(o.element)?.item.id, preview: o.preview, where: whereOf(P, o.roots), apply: (R) => applyRoots(P, o.roots, R), probe: (R) => rootsGone(P, o.roots, R), spans: () => rootSpans(P, o.roots) };
    items.set(item.id, item);
    const node: TreeNode = { item, children: [] };
    objectNodes.set(o.key, node);
    for (const p of o.parts) {
      if (!rootsExist(P, p.roots)) continue;
      const pi: RemovalItem = { id: `p:${p.key}`, kind: "part", label: p.label, element: o.element, parent: item.id, preview: p.preview, where: whereOf(P, p.roots), apply: (R) => applyRoots(P, p.roots, R), probe: (R) => rootsGone(P, p.roots, R), spans: () => rootSpans(P, p.roots) };
      items.set(pi.id, pi);
      node.children.push({ item: pi, children: [] });
    }
    const en = elementNodes.get(o.element);
    if (en) en.children.push(node);
    else add(o.element, node);
  }

  // animations
  const objectOfGroup = new Map<string, ObjectDef>();
  for (const o of OBJECTS) for (const g of o.groups) objectOfGroup.set(g, o);
  const looseAnims = new Map<ElementId, TreeNode[]>();
  for (const an of detectAnimations(P)) {
    const toks = an.sh ? an.sh.toks : an.f.toks;
    const rows: { key: string; label: string; group: string }[] = [];
    for (let q = an.a; q < an.b; q++) {
      if (toks[q]!.k !== "num") continue;
      const r = rowAt.get(`${an.f.path}:${toks[q]!.s}`) ?? (toks[q - 1]?.v === "-" ? rowAt.get(`${an.f.path}:${toks[q - 1]!.s}`) : undefined);
      if (r && !rows.some((x) => x.key === r.key)) rows.push(r);
    }
    let obj: ObjectDef | undefined = rows.map((r) => objectOfGroup.get(r.group)).find(Boolean);
    if (!obj && !an.sh) {
      const chain = stmtChain(an.f, an.a);
      const src = an.f.lx.src;
      for (const o of OBJECTS) {
        if (!o.scopes.length || !objectNodes.has(o.key)) continue;
        const inScope = chain.some((s) => (s.kind === "for" || s.kind === "val") && o.scopes.some((sc) => src.slice(an.f.toks[s.a]!.s, an.f.toks[Math.min(s.b, s.a + 12) - 1]!.e).includes(sc)));
        if (!inScope) continue;
        if (o.branchOf) {
          if (chain.some((s) => s.kind === "branch" && srcOf(an.f, s.a, s.b).startsWith(o.branchOf!))) {
            obj = o;
            break;
          }
          continue;
        }
        obj = o;
        break;
      }
      if (!obj) {
        // a shared loop (e.g. all secrets): the element of those objects
        const shared = OBJECTS.find((o) => o.branchOf && chain.some((s) => s.kind === "for" && o.scopes.some((sc) => srcOf(an.f, s.a, Math.min(s.b, s.a + 12)).includes(sc))));
        if (shared) {
          const id = `a:${an.f.path}@${toks[an.a]!.s}-${toks[an.b - 1]!.e}`;
          const item = animItem(P, an, id, shared.element, undefined, animLabel(rows.map((r) => r.label), an.text, an.fn));
          items.set(id, item);
          const list = looseAnims.get(shared.element) ?? [];
          list.push({ item, children: [] });
          looseAnims.set(shared.element, list);
          continue;
        }
      }
    }
    const id = `a:${an.f.path}${an.sh ? `#${an.sh.str}` : ""}@${toks[an.a]!.s}-${toks[an.b - 1]!.e}`;
    const label = animLabel(rows.map((r) => r.label), an.text, an.fn);
    if (obj && objectNodes.has(obj.key)) {
      const on = objectNodes.get(obj.key)!;
      const item = animItem(P, an, id, obj.element, on.item.id, label);
      items.set(id, item);
      on.children.push({ item, children: [] });
    } else {
      const el = an.sh ? "graphics" : elementOfPath(an.f.path);
      const item = animItem(P, an, id, el, undefined, label);
      items.set(id, item);
      const list = looseAnims.get(el) ?? [];
      list.push({ item, children: [] });
      looseAnims.set(el, list);
    }
  }
  for (const [el, list] of looseAnims) {
    const en = elementNodes.get(el);
    if (en) en.children.push(...list);
    else for (const n of list) add(el, n);
  }
  const cat: Catalog = { P, items, tree, curatedOfLit };
  catalogs.set(model, cat);
  return cat;
}

function animItem(P: Program, an: Anim, id: string, element: ElementId, parent: string | undefined, label: string): RemovalItem {
  const toks = an.sh ? an.sh.toks : an.f.toks;
  const where = `${an.f.path.split("/").pop()}:${lineOf(an.f.lx.src, toks[an.a]!.s)}`;
  return {
    id,
    kind: "anim",
    label,
    element,
    parent,
    preview: [],
    where,
    apply: (R) => R.removeAnimation(an.f, an.a, an.b, an.sh),
    probe: (R) => (an.sh ? R.glslDead(an.sh, an.a) : R.isDead(an.f, an.a)),
  };
  void P;
}

// ---- values
/** Plans deleting the literals of one row (as written). A string explains why it is not possible. */
export function planValue(cat: Catalog, model: Model, R: Remover, ids: string[]): (() => void) | string {
  const P = cat.P;
  const plans: (() => void)[] = [];
  for (const id of ids) {
    const lit = model.lits.get(id);
    if (!lit) return "Ez az érték nincs a repóban.";
    const f = P.files.get(lit.file);
    if (!f) return "A fájl nem olvasható.";
    if (R.charDead(lit.file, lit.start)) continue;
    if (lit.glsl) {
      const sh = P.shaderAt(f, lit.start);
      if (!sh) return "Nem található a shaderben.";
      const a = shTokAt(sh, lit.start);
      const numTok = shTokAt(sh, lit.end - 1);
      if (a < 0 || numTok < 0) return "Nem található a shaderben.";
      const plan = R.planEditGlsl(sh, a, numTok + 1);
      if (plan) {
        plans.push(plan);
        continue;
      }
      const ab = R.planAbsentGlsl(sh, a);
      if ("why" in ab) return `Ez a szám nem vehető ki: ${ab.why}.`;
      plans.push(ab.plan);
      continue;
    }
    const a = tokAt(f, lit.start);
    const numTok = tokAt(f, lit.end - 1);
    if (a < 0 || numTok < 0) return "Nem található a kódban.";
    // a named value written only as this number: the declaration goes, and the name leaves every expression
    const chain = stmtChain(f, numTok);
    const st = chain[0];
    if (st && st.kind === "val" && st.initA === a && st.initB === numTok + 1 && st.name) {
      const d = f.decls.find((x) => x.stmt === st && x.name === st.name);
      if (!d) return "A deklaráció nem található.";
      const refs = P.refs(d.name).filter((r) => !R.isDead(r.file, r.tok) && P.resolve(r).includes(d));
      const sub: (() => void)[] = [];
      let soft = true;
      for (const r of refs) {
        const p = r.str === undefined ? R.planEditRef(r.file, r.tok) : null;
        if (!p) {
          soft = false;
          break;
        }
        sub.push(p);
      }
      if (soft)
        plans.push(() => {
          R.deleteStmtOnly(st);
          for (const p of sub) p();
        });
      // required somewhere: the declaration goes with everything that uses it
      else plans.push(() => R.deleteDecl(d));
      continue;
    }
    const plan = R.planEdit(f, a, numTok + 1);
    // required where it stands: what holds it goes (term, argument, statement …) with everything that depends on it
    plans.push(plan ?? (() => R.absentSpan(f, a, numTok + 1)));
  }
  return () => plans.forEach((p) => p());
}

export function valueItemId(ids: string[]) {
  return `v:${ids.join(",")}`;
}

// ---- state
export interface RemovalState {
  cat: Catalog;
  R: Remover;
  ids: string[];
  /** Items that could not be applied (with the reason). */
  failed: Map<string, string>;
  /** The texts with these removals and the given number edits. */
  render: (edits: ReadonlyMap<string, number>) => Map<string, string>;
  litDead: (id: string) => boolean;
  neutral: (id: string) => number;
  hidden: Set<string>;
  gone: (id: string) => boolean;
}

export function computeRemoval(model: Model, ids: readonly string[]): RemovalState {
  const cat = catalogFor(model);
  const R = new Remover(cat.P);
  const failed = new Map<string, string>();
  const sorted = [...new Set(ids)].sort((a, b) => ORDER[kindOf(a)] - ORDER[kindOf(b)]);
  const applied: string[] = [];
  for (const id of sorted) {
    const before = R.failures.length;
    let ok = false;
    if (id.startsWith("v:")) {
      const plan = planValue(cat, model, R, id.slice(2).split(","));
      if (typeof plan === "string") failed.set(id, plan);
      else {
        plan();
        ok = true;
      }
    } else {
      const item = cat.items.get(id);
      if (!item) failed.set(id, "Ebben a repóban nincs ilyen rész.");
      else ok = item.apply(R);
      if (item && !ok && !failed.has(id)) failed.set(id, "Nem sikerült a törlés.");
    }
    if (R.failures.length > before) failed.set(id, R.failures.slice(before).join("; "));
    if (ok) applied.push(id);
  }
  R.finish();
  const hidden = new Set<string>();
  for (const item of cat.items.values()) if (item.preview.length && (applied.includes(item.id) || item.probe?.(R))) item.preview.forEach((k) => hidden.add(k));
  const litDead = (id: string) => {
    const lit = model.lits.get(id);
    return !!lit && R.charDead(lit.file, lit.start);
  };
  return {
    cat,
    R,
    ids: applied,
    failed,
    render: (edits) => R.render(numberSpans(model, edits)),
    litDead,
    neutral: (id) => {
      const lit = model.lits.get(id);
      return lit ? R.neutralAt(lit.file, lit.start) : 0;
    },
    hidden,
    gone: (id) => {
      if (applied.includes(id)) return true;
      const item = cat.items.get(id);
      return !!item?.probe?.(R);
    },
  };
}

function kindOf(id: string): ItemKind {
  return id.startsWith("e:") ? "element" : id.startsWith("o:") ? "object" : id.startsWith("p:") ? "part" : id.startsWith("a:") ? "anim" : "value";
}

export function numberSpans(model: Model, edits: ReadonlyMap<string, number>): Map<string, Span[]> {
  const out = new Map<string, Span[]>();
  for (const [id, v] of edits) {
    const lit: Literal | undefined = model.lits.get(id);
    if (!lit || Math.abs(lit.value - v) <= 1e-12) continue;
    const a = out.get(lit.file) ?? [];
    a.push({ s: lit.start, e: lit.end, text: formatLiteral(lit, v) });
    out.set(lit.file, a);
  }
  return out;
}

/** Items in tree order for an element (for lists). */
export function flatTree(nodes: TreeNode[]): RemovalItem[] {
  const out: RemovalItem[] = [];
  const walk = (ns: TreeNode[]) => ns.forEach((n) => (out.push(n.item), walk(n.children)));
  walk(nodes);
  return out;
}

export function itemLabel(cat: Catalog, id: string, model: Model, labels?: Map<string, string>): string {
  const it = cat.items.get(id);
  if (it) return it.label;
  if (id.startsWith("v:")) {
    const ids = id.slice(2).split(",");
    const l = labels?.get(ids[0]!);
    const lit = model.lits.get(ids[0]!);
    return l ?? lit?.decl ?? (lit ? `${lit.file.split("/").pop()}:${lit.line}` : id);
  }
  return id;
}

const litCache = new WeakMap<Catalog, Map<string, string[]>>();

/** Ids of the numbers (any file, in code order) inside an object's or part's code. Empty for other items. */
export function itemLiteralIds(cat: Catalog, model: Model, id: string): string[] {
  let m = litCache.get(cat);
  if (!m) litCache.set(cat, (m = new Map()));
  const hit = m.get(id);
  if (hit) return hit;
  const spans = cat.items.get(id)?.spans?.() ?? [];
  const out: string[] = [];
  if (spans.length) {
    for (const l of model.lits.values()) {
      if (l.glsl) continue;
      if (spans.some((sp) => sp.path === l.file && l.start >= sp.s && l.end <= sp.e)) out.push(l.id);
    }
    out.sort((a, b) => {
      const x = model.lits.get(a)!, y = model.lits.get(b)!;
      return x.file === y.file ? x.start - y.start : x.file.localeCompare(y.file);
    });
  }
  m.set(id, out);
  return out;
}
