import { useMemo } from "react";
import { ItemAction, useRemoval } from "@/components/removal-context";
import { Fold, GroupList, RowView } from "@/components/ValuePanel";
import type { Group, Model, Row } from "@/studio/catalog";
import type { ElementId } from "@/studio/curated";
import { extraRows, KIND_LABEL, splitByObject } from "@/studio/removal-state";
import type { RemovalItem, TreeNode } from "@/studio/removals";

interface Props {
  element: ElementId;
  model: Model;
  groups: Group[];
  edits: Record<string, number>;
  onSet: (pairs: [string, number][]) => void;
  openFirst: boolean;
}

/** One deletable thing in a list: a part or an animation, with its place in the code and its delete/undo button. */
function ItemRow({ item }: { item: RemovalItem }) {
  const api = useRemoval();
  if (!api) return null;
  const own = api.removed.includes(item.id);
  const gone = api.state.gone(item.id);
  const problem = api.state.failed.get(item.id);
  return (
    <div className={`flex items-center gap-2 py-2 ${gone ? "opacity-70" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[14px] leading-tight lg:text-[13px] ${gone ? "text-muted-foreground line-through" : "text-foreground/90"}`}>{item.label}</p>
        <p className="truncate font-mono text-[10.5px] text-muted-foreground">
          {KIND_LABEL[item.kind]}
          {item.where ? ` · ${item.where}` : ""}
          {problem ? ` · nem alkalmazható: ${problem}` : gone && !own ? " · másik törlés miatt eltűnt" : ""}
        </p>
      </div>
      <ItemAction id={item.id} label={item.label} />
    </div>
  );
}

interface RowsCtx {
  model: Model;
  edits: Record<string, number>;
  onSet: Props["onSet"];
}

function RowsOf({ rows, ctx }: { rows: Row[]; ctx: RowsCtx }) {
  return (
    <div className="divide-y divide-border/50">
      {rows.map((r) => (
        <RowView key={r.key} model={ctx.model} row={r} edits={ctx.edits} onSet={ctx.onSet} />
      ))}
    </div>
  );
}

/**
 * The parts and animations of an object. A part with numbers in its code (the glow fog of the fairy ring, in
 * GameRenderer.kt, or values in Simulation.kt) is a fold-out holding all of them as sliders; the others are rows.
 */
function ItemList({ nodes, extra, ctx }: { nodes: TreeNode[]; extra: (id: string) => Row[]; ctx: RowsCtx }) {
  if (!nodes.length) return null;
  return (
    <div className="divide-y divide-border/50">
      {nodes.map((n) => {
        const rows = n.item.kind === "part" ? extra(n.item.id) : [];
        if (!rows.length) return <ItemRow key={n.item.id} item={n.item} />;
        return (
          <Fold key={n.item.id} depth={1} title={<ObjectTitle item={n.item} />} count={rows.length} action={<ItemAction id={n.item.id} label={n.item.label} />}>
            {() => <RowsOf rows={rows} ctx={ctx} />}
          </Fold>
        );
      })}
    </div>
  );
}

function ObjectTitle({ item }: { item: RemovalItem }) {
  const api = useRemoval();
  const gone = !!api?.state.gone(item.id);
  return <span className={gone ? "text-muted-foreground line-through" : undefined}>{item.label}</span>;
}

/**
 * The drawer body of an element that has deletable parts: every object is a fold-out (delete button in its header)
 * holding its parts, its animations and its own sliders; animations that belong to no object come last. Without a
 * catalog (nothing deletable) it is the plain group list.
 */
export function RemovalTree({ element, model, groups, edits, onSet, openFirst }: Props) {
  const api = useRemoval();
  const nodes = api?.cat.tree.get(element);
  const split = useMemo(() => {
    const top = nodes?.find((n) => n.item.kind === "element")?.children ?? nodes ?? [];
    const objects = top.filter((n) => n.item.kind === "object");
    const loose = top.filter((n) => n.item.kind === "anim");
    return { objects, loose, ...splitByObject(groups, new Set(objects.map((n) => n.item.id.slice(2)))) };
  }, [nodes, groups]);

  // per object: its curated groups, the extra sliders of each part and of the rest of its code
  const perObject = useMemo(() => {
    const out = new Map<string, { own: Group[]; partRows: Map<string, Row[]>; rest: Row[] }>();
    if (!api) return out;
    for (const n of split.objects) {
      const own = split.byObject.get(n.item.id.slice(2)) ?? [];
      // numbers already shown as curated sliders of this object's groups are not listed twice
      const shown = new Set<string>();
      const walk = (gs: Group[]) => gs.forEach((g) => (g.rows.forEach((r) => r.ids.forEach((i) => shown.add(i))), g.sub && walk(g.sub)));
      walk(own);
      const partRows = new Map<string, Row[]>();
      for (const c of n.children) {
        if (c.item.kind !== "part") continue;
        const rows = extraRows(model, api.cat, c.item.id, shown);
        partRows.set(c.item.id, rows);
        rows.forEach((r) => r.ids.forEach((i) => shown.add(i)));
      }
      // what is left of the object's own code (e.g. its declaration in Simulation.kt)
      out.set(n.item.id, { own, partRows, rest: extraRows(model, api.cat, n.item.id, shown) });
    }
    return out;
  }, [api, model, split]);

  if (!api || !nodes) return <GroupList model={model} groups={groups} edits={edits} onSet={onSet} openFirst={openFirst} />;
  const { objects, loose, rest } = split;
  const ctx: RowsCtx = { model, edits, onSet };
  const noExtra = () => [] as Row[];
  return (
    <>
      {objects.map((n) => {
        const { own, partRows, rest: rest2 } = perObject.get(n.item.id)!;
        if (!n.children.length && !own.length && !rest2.length) return <ItemRow key={n.item.id} item={n.item} />;
        return (
          <Fold key={n.item.id} title={<ObjectTitle item={n.item} />} count={n.children.length || undefined} action={<ItemAction id={n.item.id} label={n.item.label} />}>
            {() => (
              <>
                <ItemList nodes={n.children} extra={(id) => partRows.get(id) ?? []} ctx={ctx} />
                {own.length > 0 && <GroupList model={model} groups={own} edits={edits} onSet={onSet} depth={1} openFirst={false} />}
                {rest2.length > 0 && (
                  <Fold depth={1} title="További számok az objektum kódjában" count={rest2.length}>
                    {() => <RowsOf rows={rest2} ctx={ctx} />}
                  </Fold>
                )}
              </>
            )}
          </Fold>
        );
      })}
      {rest.length > 0 && <GroupList model={model} groups={rest} edits={edits} onSet={onSet} openFirst={openFirst && objects.length === 0} />}
      {loose.length > 0 && (
        <Fold title="Animációk" count={loose.length}>
          {() => <ItemList nodes={loose} extra={noExtra} ctx={ctx} />}
        </Fold>
      )}
    </>
  );
}
