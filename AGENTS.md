<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules

- `src/tree/mesh.ts` mirrors the Kotlin emitted by `src/tree/kotlin.ts` formula for formula (same hash salts, order, Float32 rounding); change both together and re-check with a compiled Kotlin run, because the preview must be exactly the mesh the game builds.
- Every tunable value is declared once in `PARAM_SPECS` (`src/tree/params.ts`) and becomes a per-species Kotlin array; file defaults there must keep reproducing `Meshes_Reference_Tree.kt` exactly so untouched species stay unchanged.
- The game repo is data, not code: it is loaded as a ZIP in the browser (`src/studio/repo.ts`, kept in IndexedDB; the built-in default is a CDN asset), and the export patches numbers in place (`patchSource`) so every other byte of the repo stays identical. `src/kotlin/` only feeds the tree tests.

## Project rules

- The 3D view is always full screen; all controls live in the bottom workbench (dock of element chips + one drawer that opens upwards, `src/routes/index.tsx`) on every screen size. Lists are fold-outs (`Fold`/`GroupList` in `src/components/ValuePanel.tsx`); never add side panels or top bars.
- Every number shown comes from scanning the repo's Kotlin (`src/studio/scan.ts`); Hungarian named controls with a 3D preview are pattern references in `src/studio/curated.ts` (`#` = any number), so they survive value changes. Tree values are the repo's `TREE_*` arrays; the preview follows the repo's tree variant via `BuildOptions.soilBottom`.
- A new shape parameter must have a neutral file default that skips its formula (e.g. joint angle 90° = off), so untouched species keep reproducing the reference Kotlin bit for bit.
- Diffs and patches come from `src/studio/diff.ts`: git-style unified diffs with `a/`/`b/` paths relative to the repo root (so `git apply` / `patch -p1` work there), always against the currently loaded base repo; an imported patch becomes slider edits only when it changes nothing but numbers (same literal skeleton), otherwise it can only become a new base. Every forward patch has a restore patch (`FileDiff.revert`, tuned → base; `restorePatch` for a patch taken as new base); a patch that does not fit the base is tried on the current tuned state.
- Each control shows its code name under the Hungarian label (`codeRef` in `src/studio/catalog.ts`: declaration name, or call + argument for inline numbers), hidden when it equals the label.
- Deleting is part of the same workbench: the trash buttons come from `ItemAction` (`src/components/removal-context.tsx`) and exist only where the deletion catalog (`catalogFor`, `src/studio/removals.ts`) has the item: drawer header (`e:` whole element), object fold-out headers (`o:`), part and animation rows (`p:`, `a:`) in `RemovalTree`, and the end of every slider/colour row (`v:`). The list of deleted ids is the only state (`removed` in `src/routes/index.tsx`, saved with the edits): applying it is `computeRemoval`, so undo is just a shorter list, and diff, patch, ZIP and the 3D `hidden` set all read the same `RemovalState`. Add deletions only through `tryRemove` (`src/studio/removal-state.ts`) so an item that does not apply is reported instead of stored.
- Deleting is part of the same workbench: the trash buttons come from `ItemAction` (`src/components/removal-context.tsx`) and exist only where the deletion catalog (`catalogFor`, `src/studio/removals.ts`) has the item: drawer header (`e:` whole element), object fold-out headers (`o:`), part and animation rows (`p:`, `a:`) in `RemovalTree`, and the end of every slider/colour row (`v:`). The list of deleted ids is the only state (`removed` in `src/routes/index.tsx`, saved with the edits): applying it is `computeRemoval`, so undo is just a shorter list, and diff, patch, ZIP and the 3D `hidden` set all read the same `RemovalState`. Add deletions only through `tryRemove` (`src/studio/removal-state.ts`) so an item that does not apply is reported instead of stored.
