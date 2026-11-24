import { Trash2, Undo2 } from "lucide-react";
import { createContext, useContext } from "react";
import { valueItemId, type Catalog, type RemovalState } from "@/studio/removals";

/** What the controls need to delete and bring back: the catalog, the state of the deletions and the two actions. */
export interface RemovalApi {
  cat: Catalog;
  state: RemovalState;
  /** The items the person deleted (not what went with them). */
  removed: readonly string[];
  remove: (ids: string[]) => void;
  restore: (ids: string[]) => void;
}

export const RemovalContext = createContext<RemovalApi | null>(null);

/** Null while the catalog is not built yet (nothing opened) and in tests: the controls then show no delete buttons. */
export const useRemoval = () => useContext(RemovalContext);

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The delete (or, once deleted, undo) button of one item: a whole element, an object, a part, an animation or a
 * value (`v:` id of a row). Items the repo does not have show nothing; items that went with something bigger show a
 * dimmed icon.
 */
export function ItemAction({ id, label, dead }: { id: string; label: string; dead?: boolean }) {
  const api = useRemoval();
  if (!api) return null;
  if (!id.startsWith("v:") && !api.cat.items.has(id)) return null;
  const own = api.removed.includes(id);
  if (own)
    return (
      <button type="button" onClick={() => api.restore([id])} className={`${iconBtn} hover:text-primary`} title={`${label}: törlés visszavonása`} aria-label={`${label} törlésének visszavonása`}>
        <Undo2 className="h-4 w-4" />
      </button>
    );
  if (dead ?? api.state.gone(id))
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground/35" title="Egy másik törlés miatt már nincs a kódban">
        <Trash2 className="h-4 w-4" />
      </span>
    );
  return (
    <button type="button" onClick={() => api.remove([id])} className={iconBtn} title={`${label} törlése`} aria-label={`${label} törlése`}>
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

/** State of a slider/colour row: its deletion item, whether the person deleted it, whether it is gone anyway. */
export function rowRemoval(api: RemovalApi | null, ids: string[]): { id: string; own: boolean; dead: boolean } | null {
  if (!api) return null;
  const id = valueItemId(ids);
  const own = api.removed.includes(id);
  return { id, own, dead: own || (ids.length > 0 && ids.every((i) => api.state.litDead(i))) };
}
