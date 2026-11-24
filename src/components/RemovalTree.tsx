import { useMemo } from "react";
import { ItemAction, useRemoval } from "@/components/removal-context";
import { Fold, GroupList } from "@/components/ValuePanel";
import type { Group, Model } from "@/studio/catalog";
import type { ElementId } from "@/studio/curated";
import { KIND_LABEL, splitByObject } from "@/studio/removal-state";
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

function ItemList({ nodes }: { nodes: TreeNode[] }) {
  if (!nodes.length) return null;
  return (
    <div className="divide-y divide-border/50">
      {nodes.map((n) => (
        <ItemRow key={n.item.id} item={n.item} />
      ))}
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

  if (!api || !nodes) return <GroupList model={model} groups={groups} edits={edits} onSet={onSet} openFirst={openFirst} />;
  const { objects, loose, byObject, rest } = split;
  return (
    <>
      {objects.map((n) => {
        const own = byObject.get(n.item.id.slice(2)) ?? [];
        // an object with nothing inside (a power-up kind) is a plain row
        if (!n.children.length && !own.length) return <ItemRow key={n.item.id} item={n.item} />;
        return (
          <Fold key={n.item.id} title={<ObjectTitle item={n.item} />} count={n.children.length || undefined} action={<ItemAction id={n.item.id} label={n.item.label} />}>
            {() => (
              <>
                <ItemList nodes={n.children} />
                {own.length > 0 && <GroupList model={model} groups={own} edits={edits} onSet={onSet} depth={1} openFirst={false} />}
              </>
            )}
          </Fold>
        );
      })}
      {rest.length > 0 && <GroupList model={model} groups={rest} edits={edits} onSet={onSet} openFirst={openFirst && objects.length === 0} />}
      {loose.length > 0 && (
        <Fold title="Animációk" count={loose.length}>
          {() => <ItemList nodes={loose} />}
        </Fold>
      )}
    </>
  );
}
