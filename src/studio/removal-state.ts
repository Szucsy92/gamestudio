/**
 * The glue between the deletion engine (removals.ts) and the workbench UI: adding deletions only when they really
 * apply, the 3D preview values of deleted numbers, and which value groups belong under which object. Pure functions,
 * no React, so they are tested without a browser.
 */
import { rowFor, type Group, type Model, type Row } from "./catalog";
import { computeRemoval, itemLabel, itemLiteralIds, valueItemId, type Catalog, type ItemKind, type RemovalState } from "./removals";
import { OBJECTS } from "./structure";

export interface RemoveResult {
  /** The new list of deleted item ids (the old one plus what applied). */
  next: string[];
  /** What was added now. */
  added: string[];
  /** What could not be deleted, with the reason. */
  failed: { id: string; reason: string }[];
}

/**
 * Adds `ids` to the deleted list, but only those that apply to the code. Ids that are already deleted, or already
 * gone because something bigger was deleted, are left out. Nothing here touches the state: the caller stores `next`.
 */
export function tryRemove(model: Model, current: readonly string[], ids: readonly string[]): RemoveResult {
  const base = computeRemoval(model, current);
  const fresh = [...new Set(ids)].filter((id) => {
    if (current.includes(id)) return false;
    if (id.startsWith("v:")) return !id.slice(2).split(",").every((l) => base.litDead(l));
    return !base.gone(id);
  });
  if (!fresh.length) return { next: [...current], added: [], failed: [] };
  const state = computeRemoval(model, [...current, ...fresh]);
  const failed = fresh.filter((id) => state.failed.has(id)).map((id) => ({ id, reason: state.failed.get(id)! }));
  const bad = new Set(failed.map((f) => f.id));
  const added = fresh.filter((id) => !bad.has(id));
  return { next: [...current, ...added], added, failed };
}

/** Saved ids that this repo can still resolve (a stale list from another repo version loses what no longer exists). */
export function validRemovals(model: Model, cat: Catalog, ids: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || out.includes(id)) continue;
    if (id.startsWith("v:")) {
      if (id.slice(2).split(",").every((l) => model.lits.has(l))) out.push(id);
    } else if (cat.items.has(id)) out.push(id);
  }
  return out;
}

/**
 * The edits the 3D preview should use: a deleted number takes the value the code has without it (0 for a removed
 * term, 1 for a removed factor …), so the preview shows what the game will do.
 */
export function previewEdits(model: Model, edits: Record<string, number>, state: RemovalState | null): Record<string, number> {
  if (!state || !state.ids.length) return edits;
  let out = edits;
  for (const id of model.lits.keys()) {
    if (!state.litDead(id)) continue;
    if (out === edits) out = { ...edits };
    out[id] = state.neutral(id);
  }
  return out;
}

/** Kind of an item id, for lists. */
export function kindOfId(id: string): ItemKind {
  return id.startsWith("e:") ? "element" : id.startsWith("o:") ? "object" : id.startsWith("p:") ? "part" : id.startsWith("a:") ? "anim" : "value";
}

export const KIND_ORDER: Record<ItemKind, number> = { element: 0, object: 1, part: 2, anim: 3, value: 4 };
export const KIND_LABEL: Record<ItemKind, string> = { element: "Elem", object: "Objektum", part: "Alkatrész", anim: "Animáció", value: "Érték" };

export interface RemovedView {
  id: string;
  kind: ItemKind;
  label: string;
  where?: string | undefined;
  /** Why it could not be applied (a deleted id that no longer fits the code). */
  problem?: string | undefined;
}

/** The deleted items for the Changes list: elements first, then objects, parts, animations and values. */
export function removedViews(model: Model, cat: Catalog, state: RemovalState, removed: readonly string[], labels: Map<string, string>): RemovedView[] {
  const views = removed.map((id): RemovedView => {
    const kind = kindOfId(id);
    let where = cat.items.get(id)?.where;
    if (kind === "value") {
      const lit = model.lits.get(id.slice(2).split(",")[0]!);
      if (lit) where = `${lit.file.split("/").pop()}:${lit.line}`;
    }
    return { id, kind, label: itemLabel(cat, id, model, labels), where, problem: state.failed.get(id) };
  });
  return views.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/**
 * The value groups of an element split by the object they belong to (structure.ts `groups`), so each object's
 * fold-out holds its parts and its own sliders. Only objects that exist in this repo (`present`) take groups.
 */
export function splitByObject(groups: Group[], present: ReadonlySet<string>): { byObject: Map<string, Group[]>; rest: Group[] } {
  const owner = new Map<string, string>();
  for (const o of OBJECTS) if (present.has(o.key)) for (const g of o.groups) owner.set(`cur:${g}`, o.key);
  const byObject = new Map<string, Group[]>();
  const rest: Group[] = [];
  for (const g of groups) {
    const key = owner.get(g.id);
    if (!key) rest.push(g);
    else byObject.set(key, [...(byObject.get(key) ?? []), g]);
  }
  return { byObject, rest };
}

/** "bGlowFog.add · 3. érték": the call a number is an argument of, or null outside a call. */
function callLabel(src: string, pos: number): string | null {
  let depth = 0;
  let commas = 0;
  for (let i = pos - 1; i >= 0 && pos - i < 600; i--) {
    const c = src[i];
    if (c === ")" || c === "]") depth++;
    else if (c === "(" || c === "[") {
      if (depth > 0) depth--;
      else if (c === "(") {
        const m = /([A-Za-z_][\w.]*)\s*$/.exec(src.slice(Math.max(0, i - 48), i));
        return m && !/^(for|if|while|when|return)$/.test(m[1]!) ? `${m[1]} · ${commas + 1}. érték` : null;
      } else return null;
    } else if (depth === 0 && (c === "{" || c === "}" || c === ";")) return null;
    else if (depth === 0 && c === ",") commas++;
  }
  return null;
}

/**
 * Sliders for every number in the code of an object or part (in any file: the renderer's fog and glow as well as
 * the simulation's values), minus the ones already shown as curated rows (`shown`). Labelled by the call they sit in.
 */
export function extraRows(model: Model, cat: Catalog, id: string, shown: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  for (const lid of itemLiteralIds(cat, model, id)) {
    if (shown.has(lid)) continue;
    const l = model.lits.get(lid);
    if (!l) continue;
    const src = model.files.get(l.file)?.src ?? "";
    rows.push(rowFor(l, callLabel(src, l.start) ?? l.decl ?? `${l.line}. sor`));
  }
  return rows;
}

export { valueItemId };
