import { createFileRoute } from "@tanstack/react-router";
import { Box, ChevronDown, Download, Eye, FolderUp, GitCompareArrows, Grid3x3, ImageIcon, Layers, List, Loader2, Minus, Mountain, Plus, RotateCcw, Search, Sparkles, Upload, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { KtName, ParamGroup } from "@/components/ParamPanel";
import { ChangesPanel } from "@/components/ChangesPanel";
import { ItemAction, RemovalContext, type RemovalApi } from "@/components/removal-context";
import { RemovalTree } from "@/components/RemovalTree";
import { StudioViewport, type CameraView } from "@/components/StudioViewport";
import { Fold, GroupList, RowView, type SetValues } from "@/components/ValuePanel";
import referenceAsset from "@/assets/reference-forest.png.asset.json";
import { buildTree, MAX_VERTICES } from "@/tree/mesh";
import { clampParams, GROUPS, PARAM_SPECS, referencePreset, scaleRootJoint, SPECIES, type GroupId, type ParamKey, type SpeciesParams } from "@/tree/params";
import { buildModel, countChanged, ELEMENTS, labelIndex, treeChangedCount, treeEdits, type Model, type Row, type SceneId } from "@/studio/catalog";
import { applyPatch, buildPatch, editsFromPatched, fileDiffs, folderTree, restorePatch, treeText, type FileDiff } from "@/studio/diff";
import type { ElementId } from "@/studio/curated";
import { lookFrom } from "@/studio/look";
import { previewEdits, tryRemove, validRemovals } from "@/studio/removal-state";
import { catalogFor, computeRemoval, itemLabel } from "@/studio/removals";
import { buildRepoZip, clearStoredRepo, downloadBlob, openStartRepo, parseRepoZip, patchHeader, readRepoText, repoKey, repoWithFiles, saveStoredRepo, tuningJson, type RepoData } from "@/studio/repo";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "GameStudio – a Woodland Weave Run minden eleme 3D-ben" },
      { name: "description", content: "Fák, kapuk, oszlopok, fekete lyuk, power-upok, színek és fények: a játék összes értéke csúszkával, élő 3D előnézettel és teljes repo ZIP exporttal." },
      { property: "og:title", content: "GameStudio – a Woodland Weave Run minden eleme 3D-ben" },
      { property: "og:description", content: "A játék repójának minden értéke csúszkával, élő 3D előnézettel; letöltés teljes, fordítható ZIP-ként." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GameStudio,
});

const STORAGE_KEY = "gamestudio/v1";

interface Saved {
  base: string;
  edits: Record<string, number>;
  species: SpeciesParams;
  active: number;
  shape: number;
  prop: boolean;
  /** Deleted items (removals.ts ids), applied on top of the base repo. */
  removed?: string[];
}

type Panel = ElementId | "all" | "view" | "changes";

const VIEW_BUTTONS: { id: CameraView; label: string }[] = [
  { id: "full", label: "Teljes fa" },
  { id: "base", label: "Tő és gyökerek" },
  { id: "crown", label: "Ágak" },
  { id: "top", label: "Felülről" },
];

const ROOT_COUNT_SPEC = PARAM_SPECS.find((s) => s.key === "rootCount")!;

function SpeciesPicker({ active, count, onSelect }: { active: number; count: number; onSelect: (sp: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 py-2">
      <span className="shrink-0 text-[11px] text-muted-foreground">Fafaj:</span>
      <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
        {SPECIES.slice(0, count).map((s) => (
          <button key={s.id} type="button" onClick={() => onSelect(s.id)} aria-pressed={active === s.id} className={`min-h-10 rounded-lg border px-1 text-[12px] transition lg:min-h-8 ${active === s.id ? "border-primary bg-primary/15 text-primary" : "border-border text-foreground/75 hover:border-primary/40"}`}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RootCountPerSpecies({ species, base, count, onSet }: { species: SpeciesParams; base: SpeciesParams; count: number; onSet: (sp: number, value: number) => void }) {
  return (
    <div className="py-3">
      <p className="text-[14px] leading-tight text-foreground/90 lg:text-[13px]">
        Gyökerek száma fafajonként
        <KtName name={ROOT_COUNT_SPEC.kt} />
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {SPECIES.slice(0, count).map((s) => {
          const v = species[s.id]!.rootCount;
          const changed = v !== base[s.id]!.rootCount;
          return (
            <div key={s.id} className="flex items-center justify-between gap-1 rounded-xl border border-border bg-card/60 p-1">
              <button type="button" onClick={() => onSet(s.id, v - 1)} disabled={v <= ROOT_COUNT_SPEC.min} aria-label={`${s.label}: kevesebb gyökér`} className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-foreground/85 active:scale-95 disabled:opacity-40">
                <Minus className="h-4 w-4" />
              </button>
              <div className="text-center leading-tight">
                <span className={`block font-mono text-[16px] tabular-nums ${changed ? "text-primary" : "text-foreground"}`}>{v}</span>
                <span className="block text-[10px] text-muted-foreground">{s.label}</span>
              </div>
              <button type="button" onClick={() => onSet(s.id, v + 1)} disabled={v >= ROOT_COUNT_SPEC.max} aria-label={`${s.label}: több gyökér`} className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-foreground/85 active:scale-95 disabled:opacity-40">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Switch({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-[14px] leading-tight text-foreground/90 lg:text-[13px]">
        {label}
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={`relative h-9 w-16 shrink-0 rounded-full border transition ${on ? "border-primary bg-primary" : "border-border bg-secondary"}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-background shadow transition-all ${on ? "left-8" : "left-1"}`} />
      </button>
    </div>
  );
}

function Toggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition lg:min-h-9 lg:text-xs ${on ? "border-primary/60 bg-secondary text-foreground" : "border-border text-muted-foreground hover:bg-secondary/60"}`}>
      {icon}
      {label}
    </button>
  );
}

function GameStudio() {
  const [repo, setRepo] = useState<RepoData | null>(null);
  const [status, setStatus] = useState("GameStudio indul…");
  const [failed, setFailed] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [species, setSpecies] = useState<SpeciesParams | null>(null);
  const [active, setActive] = useState(2);
  const [shape, setShape] = useState(0);
  const [prop, setProp] = useState(true);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [lastScene, setLastScene] = useState<SceneId>("tree");
  const [query, setQuery] = useState("");
  const [lifelike, setLifelike] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [showGround, setShowGround] = useState(true);
  const [view, setView] = useState<CameraView>("full");
  const [viewNonce, setViewNonce] = useState(0);
  const [showRef, setShowRef] = useState(false);
  const [refLarge, setRefLarge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const restoredFor = useRef<string | null>(null);
  const bench = useRef<HTMLDivElement>(null);
  const [benchH, setBenchH] = useState(0);
  useEffect(() => {
    const el = bench.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBenchH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    openStartRepo(setStatus)
      .then(setRepo)
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
  }, []);

  const model: Model | null = useMemo(() => (repo ? buildModel(repo.texts) : null), [repo]);
  const key = repo ? repoKey(repo) : null;

  // A new base repo: restore the saved work for exactly this repo, otherwise start from its values.
  useEffect(() => {
    if (!model || !key || restoredFor.current === key) return;
    restoredFor.current = key;
    let saved: Saved | null = null;
    try {
      const j = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Saved | null;
      if (j && j.base === key) saved = j;
    } catch {
      saved = null;
    }
    const base = model.tree.species;
    if (saved) {
      setEdits(Object.fromEntries(Object.entries(saved.edits).filter(([id]) => model.lits.has(id))));
      setSpecies(base.map((b, i) => clampParams((saved!.species[i] ?? {}) as Record<string, unknown>, b)) as SpeciesParams);
      setActive(Math.min(model.tree.count - 1, Math.max(0, saved.active)));
      setShape(saved.shape);
      setProp(saved.prop);
      setRemoved(Array.isArray(saved.removed) && saved.removed.length ? validRemovals(model, catalogFor(model), saved.removed) : []);
    } else {
      setRemoved([]);
      setEdits({});
      setSpecies(base.map((p) => ({ ...p })) as SpeciesParams);
      setActive(Math.min(2, model.tree.count - 1));
    }
  }, [model, key]);

  useEffect(() => {
    if (!key || !species || restoredFor.current !== key) return;
    const t = setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify({ base: key, edits, species, active, shape, prop, removed } satisfies Saved)), 250);
    return () => clearTimeout(t);
  }, [key, edits, species, active, shape, prop, removed]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  const labels = useMemo(() => (model ? labelIndex(model) : new Map<string, string>()), [model]);
  // Deletions: the catalog (the parsed repo) is built only once something is opened or deleted.
  const needCat = panel !== null || removed.length > 0;
  const cat = useMemo(() => (model && needCat ? catalogFor(model) : null), [model, needCat]);
  const removal = useMemo(() => (model && cat ? computeRemoval(model, removed) : null), [model, cat, removed]);
  const onRemove = useCallback(
    (ids: string[]) => {
      if (!model) return;
      const r = tryRemove(model, removed, ids);
      const c = catalogFor(model);
      if (r.failed.length) setNotice(`Nem törölhető: ${r.failed.map((f) => `${itemLabel(c, f.id, model, labels)} (${f.reason})`).join("; ")}`);
      else if (r.added.length) setNotice(`${r.added.map((id) => itemLabel(c, id, model, labels)).join(", ")} törölve. A Változások lapon visszavonható.`);
      if (r.added.length) setRemoved(r.next);
    },
    [model, removed, labels],
  );
  const onRestore = useCallback((ids: string[]) => {
    const drop = new Set(ids);
    setRemoved((prev) => prev.filter((id) => !drop.has(id)));
    setNotice(ids.length > 1 ? `${ids.length} törlés visszavonva.` : "Törlés visszavonva.");
  }, []);
  const removalApi = useMemo<RemovalApi | null>(() => (cat && removal ? { cat, state: removal, removed, remove: onRemove, restore: onRestore } : null), [cat, removal, removed, onRemove, onRestore]);
  const removedNames = useMemo(() => (model && cat ? removed.map((id) => itemLabel(cat, id, model, labels)) : []), [model, cat, removed, labels]);

  const tree = model?.tree;
  const count = tree?.count ?? 4;
  const baseSpecies = tree?.species;
  const params = species?.[active] ?? baseSpecies?.[active] ?? referencePreset(2);
  const deferredParams = useDeferredValue(params);
  const mesh = useMemo(() => buildTree(deferredParams, active, shape, { lifelike, soilBottom: tree?.soilBottom ?? false }), [deferredParams, active, shape, lifelike, tree?.soilBottom]);
  const look = useMemo(() => (model ? lookFrom(model, previewEdits(model, edits, removal)) : null), [model, edits, removal]);
  const overLimit = mesh.vertexCount > MAX_VERTICES;

  const onSet: SetValues = useCallback((pairs) => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const [id, v] of pairs) next[id] = v;
      return next;
    });
  }, []);

  const onTreeChange = useCallback(
    (k: ParamKey, value: number) => {
      setSpecies((prev) => {
        if (!prev) return prev;
        const next = [...prev] as SpeciesParams;
        next[active] = k === "rootLength" && prop ? scaleRootJoint(prev[active]!, value) : { ...prev[active]!, [k]: value };
        return next;
      });
    },
    [active, prop],
  );

  const setRootCount = useCallback((sp: number, value: number) => {
    setSpecies((prev) => {
      if (!prev) return prev;
      const next = [...prev] as SpeciesParams;
      next[sp] = { ...prev[sp]!, rootCount: Math.min(ROOT_COUNT_SPEC.max, Math.max(ROOT_COUNT_SPEC.min, Math.round(value))) };
      return next;
    });
  }, []);

  const openPanel = (p: Panel) => {
    if (panel === p) {
      setPanel(null);
      return;
    }
    setPanel(p);
    const el = ELEMENTS.find((e) => e.id === p);
    if (el) setLastScene(el.scene);
  };

  const scene: SceneId = lastScene;
  const treeChanged = tree && species ? treeChangedCount(tree, species) : 0;
  const changedBy = (id: ElementId) => {
    if (!model) return 0;
    const el = model.elements.find((e) => e.id === id)!;
    return el.groups.reduce((a, g) => a + countChanged(model, edits, g), 0) + (id === "trees" ? treeChanged : 0);
  };
  const totalChanged = model ? Object.entries(edits).filter(([id, v]) => Math.abs((model.lits.get(id)?.value ?? v) - v) > 1e-12 && !removal?.litDead(id)).length + treeChanged : 0;
  /** Changed values plus deleted items. */
  const changeTotal = totalChanged + removed.length;

  /** Every literal edit, the tree editor's TREE_* values included. */
  const allEdits = useMemo(() => {
    const all = new Map<string, number>(Object.entries(edits));
    if (model && tree && species) for (const [id, v] of treeEdits(tree, species, model.lits)) all.set(id, v);
    return all;
  }, [model, tree, species, edits]);
  const deferredEdits = useDeferredValue(allEdits);
  const diffs = useMemo<FileDiff[]>(() => (model && panel === "changes" ? fileDiffs(model, deferredEdits, removal) : []), [model, deferredEdits, panel, removal]);
  const today = () => new Date().toISOString().slice(0, 10);

  const patchText = (ds: FileDiff[], revert = false) => (repo ? buildPatch(ds, patchHeader(repo, ds.reduce((a, d) => a + d.changes.length, 0), ds.length, revert, removedNames), revert) : "");
  const currentDiffs = () => (model ? fileDiffs(model, allEdits, removal) : []);
  const onDownloadPatch = (revert = false) => {
    const ds = currentDiffs();
    if (!ds.length || !repo) return setNotice("Nincs változás, nincs mit patch-be tenni.");
    downloadBlob(new Blob([patchText(ds, revert)], { type: "text/x-diff" }), `${repo.root || "repo"}-gamestudio-${today()}${revert ? "-visszaallito" : ""}.patch`);
    setNotice(revert ? `Visszaállító patch letöltve: ${ds.length} fájl eredeti értékei.` : `Patch letöltve: ${ds.length} fájl változása.`);
  };
  const onDownloadFilePatch = (d: FileDiff, revert = false) => {
    downloadBlob(new Blob([patchText([d], revert)], { type: "text/x-diff" }), `${d.path.split("/").pop()!.replace(/\.kt$/, "")}-${today()}${revert ? "-visszaallito" : ""}.patch`);
  };
  const onCopyDiff = async () => {
    const ds = currentDiffs();
    try {
      await navigator.clipboard.writeText(`${treeText(folderTree(ds))}\n\n${patchText(ds)}`);
      setNotice("Mappa-összegzés és diff a vágólapon.");
    } catch {
      setNotice("A vágólap nem érhető el ebben a böngészőben.");
    }
  };

  /** Back to the repo value for these literals (tree values through the tree editor). */
  const revertIds = useCallback(
    (ids: string[]) => {
      if (!model || !tree || !baseSpecies) return;
      const drop = new Set(ids);
      setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !drop.has(k))));
      setSpecies((prev) => {
        if (!prev) return prev;
        let next = prev;
        for (const s of PARAM_SPECS) {
          tree.ids[s.key]?.forEach((id, i) => {
            if (!drop.has(id) || i >= count) return;
            if (next === prev) next = [...prev] as SpeciesParams;
            next[i] = { ...next[i]!, [s.key]: baseSpecies[i]![s.key] };
          });
        }
        return next;
      });
    },
    [model, tree, baseSpecies, count],
  );

  /** A .patch/.diff: applied onto the base repo; number changes become slider values, anything else may become a new base. */
  const loadPatchFile = async (file: File) => {
    if (!repo || !model || !tree || !baseSpecies) return;
    const text = await file.text();
    const paths = [...repo.files.keys()];
    // First onto the base repo; a patch that only fits the tuned state (e.g. a restore patch) goes onto the current values.
    let patched: Map<string, string>;
    let ontoCurrent = false;
    try {
      patched = applyPatch(text, paths, (p) => readRepoText(repo, p));
    } catch (e) {
      const tuned = new Map(currentDiffs().map((d) => [d.path, d.after]));
      try {
        patched = applyPatch(text, paths, (p) => tuned.get(p) ?? readRepoText(repo, p));
        ontoCurrent = true;
      } catch {
        setNotice(`A patch nem alkalmazható: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    const { edits: found, structural } = editsFromPatched(model, patched);
    if (structural.length) {
      const ok = window.confirm(
        `A patch nem csak számokat módosít (${structural.map((p) => p.split("/").pop()).join(", ")}).\n\nAlkalmazzam a repóra, és legyen ez az új alap? A mostani ${changeTotal} módosításod elvész. A visszaállító patch-et (új alap → mostani alap) letöltöm, hogy bármikor visszaléphess.`,
      );
      if (!ok) return;
      setBusy(true);
      try {
        const name = `${repo.name} + ${file.name.replace(/\.(patch|diff)$/i, "")}`;
        const old = new Map([...patched.keys()].map((p) => [p, readRepoText(repo, p) ?? ""]));
        const restore = restorePatch(old, patched, [`GameStudio VISSZAÁLLÍTÓ patch – a(z) ${file.name} alkalmazását vonja vissza`, `Az új alapból (${name}) visszaállítja ezt: ${repo.name}`, "Alkalmazás a repó gyökérmappájában: git apply <fájl>.patch   vagy   patch -p1 < <fájl>.patch"]);
        const next = await repoWithFiles(repo, patched, name);
        await saveStoredRepo({ name, data: next.data, source: "upload", loadedAt: next.repo.loadedAt });
        localStorage.removeItem(STORAGE_KEY);
        downloadBlob(new Blob([restore], { type: "text/x-diff" }), `${file.name.replace(/\.(patch|diff)$/i, "")}-visszaallito.patch`);
        setRepo(next.repo);
        setNotice(`Patch alkalmazva, új alap: ${patched.size} fájl. A visszaállító patch letöltve.`);
      } catch (e) {
        setNotice(`Nem sikerült: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    const treeIds = new Map<string, [ParamKey, number]>();
    for (const s of PARAM_SPECS) tree.ids[s.key]?.forEach((id, i) => i < count && treeIds.set(id, [s.key, i]));
    const sp = (species ?? baseSpecies).map((p) => ({ ...p })) as SpeciesParams;
    const next: Record<string, number> = { ...edits };
    if (ontoCurrent) {
      // The patched files are the full new state: values the patch brought back to the base lose their edit.
      const touched = new Set(patched.keys());
      for (const id of Object.keys(next)) if (touched.has(model.lits.get(id)?.file ?? "")) delete next[id];
      for (const [id, [k, i]] of treeIds) if (touched.has(model.lits.get(id)?.file ?? "")) sp[i] = { ...sp[i]!, [k]: baseSpecies[i]![k] };
    }
    for (const [id, v] of found) {
      const t = treeIds.get(id);
      if (t) sp[t[1]] = { ...sp[t[1]]!, [t[0]]: v };
      else next[id] = v;
    }
    setSpecies(sp);
    setEdits(next);
    setNotice(ontoCurrent ? `Patch alkalmazva a mostani értékekre (${patched.size} fájl).` : `Patch alkalmazva: ${found.size} érték a csúszkákon.`);
  };

  const loadRepoFile = async (file: File) => {
    if (/\.(patch|diff)$/i.test(file.name)) return loadPatchFile(file);
    if (file.name.toLowerCase().endsWith(".json")) {
      try {
        const j = JSON.parse(await file.text()) as { species?: { params?: Record<string, unknown> }[]; activeSpecies?: number };
        if (!Array.isArray(j.species) || !baseSpecies) throw new Error();
        setSpecies(baseSpecies.map((b, i) => (j.species![i]?.params ? clampParams(j.species![i]!.params!, b) : b)) as SpeciesParams);
        if (typeof j.activeSpecies === "number") setActive(Math.min(count - 1, Math.max(0, j.activeSpecies)));
        setNotice("Fa beállítások betöltve.");
      } catch {
        setNotice("Ez a JSON nem fa-beállítás (TreeTuning.json kell).");
      }
      return;
    }
    if (changeTotal > 0 && !window.confirm(`${changeTotal} módosításod van. Az új repo lesz az alap, és ezek elvesznek. Előtte töltsd le a ZIP-et, ha kellenek. Folytatod?`)) return;
    setBusy(true);
    try {
      const data = await file.arrayBuffer();
      const next = await parseRepoZip(data, file.name.replace(/\.zip$/i, ""), "upload");
      await saveStoredRepo({ name: next.name, data, source: "upload", loadedAt: next.loadedAt });
      localStorage.removeItem(STORAGE_KEY);
      setRepo(next);
      setNotice(`Új alap: ${next.name}. Minden érték innen indul.`);
    } catch (e) {
      setNotice(`Nem sikerült betölteni: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const resetToBuiltin = async () => {
    if (!window.confirm("Visszaállítod a beépített repót alapnak? A módosítások elvesznek.")) return;
    await clearStoredRepo();
    localStorage.removeItem(STORAGE_KEY);
    setRepo(null);
    setStatus("Beépített repo betöltése…");
    restoredFor.current = null;
    openStartRepo(setStatus).then(setRepo).catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
  };

  const onDownload = async () => {
    if (!repo || !model || !species || !tree) return;
    setBusy(true);
    try {
      const blob = await buildRepoZip({ repo, model, edits: allEdits, species, speciesCount: count, activeSpecies: active, soilBottom: tree.soilBottom, removal, removedLabels: removedNames });
      downloadBlob(blob, `${repo.root || "repo"}-gamestudio-${new Date().toISOString().slice(0, 10)}.zip`);
      setNotice(`ZIP letöltve: teljes repo, ${totalChanged} módosított értékkel${removed.length ? ` és ${removed.length} törléssel` : ""}.`);
    } catch (e) {
      setNotice(`Nem sikerült a ZIP: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const resetElement = (id: ElementId) => {
    if (!model) return;
    const el = model.elements.find((e) => e.id === id)!;
    const ids = new Set<string>();
    const walk = (gs: typeof el.groups) => gs.forEach((g) => (g.rows.forEach((r) => r.ids.forEach((x) => ids.add(x))), g.sub && walk(g.sub)));
    walk(el.groups);
    setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !ids.has(k))));
    if (id === "trees" && baseSpecies) setSpecies(baseSpecies.map((p) => ({ ...p })) as SpeciesParams);
    setNotice("Az elem értékei visszaálltak a repó értékeire.");
  };

  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!model || q.length < 2) return [] as { row: Row; where: string }[];
    const out: { row: Row; where: string }[] = [];
    const seen = new Set<string>();
    for (const el of model.elements) {
      const walk = (gs: typeof el.groups, where: string) => {
        for (const g of gs) {
          for (const r of g.rows) {
            if (out.length >= 60 || seen.has(r.key)) continue;
            const lit = model.lits.get(r.ids[0]!);
            if (r.label.toLowerCase().includes(q) || lit?.decl?.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)) {
              seen.add(r.key);
              out.push({ row: r, where: `${where} › ${g.label}` });
            }
          }
          if (g.sub) walk(g.sub, `${where} › ${g.label}`);
        }
      };
      walk(el.groups, el.short);
    }
    return out;
  }, [model, query]);

  const treeBody = () => {
    if (!tree || !species || !baseSpecies) return null;
    const missing = PARAM_SPECS.filter((s) => !tree.available.has(s.key)).map((s) => s.key);
    const skipFor = (g: GroupId): ParamKey[] => [...missing, ...(g === "join" ? (["rootCount"] as ParamKey[]) : []), ...(g === "base" && tree.soilBottom ? (["cutDepth"] as ParamKey[]) : [])];
    return (
      <>
        {!tree.found && <p className="rounded-lg border border-destructive/50 p-3 text-[12px] text-destructive">Ebben a repóban nincs hangolható fa (TREE_* tömbök a Meshes.kt-ban). Az előnézet az alapfát mutatja, a ZIP-be nem kerül fa-változás.</p>}
        <SpeciesPicker active={active} count={count} onSelect={setActive} />
        <Fold title="Gyökércsatlakozás" defaultOpen badge={0}>
          {() => (
            <>
              <RootCountPerSpecies species={species} base={baseSpecies} count={count} onSet={setRootCount} />
              <ParamGroup group="join" params={params} fileValues={baseSpecies[active]!} onChange={onTreeChange} skip={skipFor("join")} ktIndex={active} />
            </>
          )}
        </Fold>
        {GROUPS.filter((g) => g.id !== "join").map((g) => (
          <Fold key={g.id} title={g.label}>
            {() => (
              <>
                {g.id === "roots" && <Switch on={prop} onClick={() => setProp((p) => !p)} label="Arányos gyökérhossz" hint="A gyökerek hosszával együtt arányosan változik a csatlakozás magassága, szórása, a tő kiszélesedése és a gyökér vastagsága." />}
                {g.id === "base" && tree.soilBottom && <p className="py-2 text-[11px] text-muted-foreground">Ebben a repóban a fa pontosan a talajszinten kezdődik, ezért a vágás mélysége itt nem számít.</p>}
                <ParamGroup group={g.id} params={params} fileValues={baseSpecies[active]!} onChange={onTreeChange} skip={skipFor(g.id)} ktIndex={active} />
              </>
            )}
          </Fold>
        ))}
        <Fold title="Alakváltozat és előbeállítások">
          {() => (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-8 gap-1.5">
                {Array.from({ length: 16 }, (_, i) => (
                  <button key={i} type="button" onClick={() => setShape(i)} className={`h-10 rounded-md font-mono text-[12px] transition lg:h-8 ${shape === i ? "bg-primary text-primary-foreground" : i < 4 ? "bg-secondary text-foreground hover:bg-secondary/70" : "text-muted-foreground hover:bg-secondary"}`}>
                    {i}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">A játék a 0–3 alakot használja.</p>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => (setSpecies((p) => (p ? (p.map((x, i) => (i === active ? referencePreset(active) : x)) as SpeciesParams) : p)), setNotice("Referencia kép szerinti beállítás betöltve."))} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-accent/50 px-2 text-[13px] text-accent hover:bg-accent/10 lg:min-h-9 lg:text-xs">
                  <Sparkles className="h-4 w-4" /> Referencia kép szerint
                </button>
                <button type="button" onClick={() => (setSpecies((p) => (p ? (p.map((x, i) => (i === active ? { ...baseSpecies[active]! } : x)) as SpeciesParams) : p)), setNotice("A repó értékei visszaállítva ennél a fafajnál."))} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-[13px] text-foreground/80 hover:border-primary/40 lg:min-h-9 lg:text-xs">
                  <RotateCcw className="h-4 w-4" /> Repó értékei
                </button>
                <button type="button" onClick={async () => (await navigator.clipboard.writeText(tuningJson(species, count, active)), setNotice("Fa beállítások a vágólapra másolva."))} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-[13px] text-foreground/80 hover:border-primary/40 lg:min-h-9 lg:text-xs">
                  <Box className="h-4 w-4" /> Fa beállítások másolása (JSON)
                </button>
              </div>
            </div>
          )}
        </Fold>
      </>
    );
  };

  const elementBody = (id: ElementId) => {
    if (!model) return null;
    const el = model.elements.find((e) => e.id === id)!;
    return (
      <>
        {id === "trees" && treeBody()}
        {id === "code" && <p className="py-2 text-[11px] text-muted-foreground">A repó összes Kotlin fájljának minden száma, függvényenként. A fa törzs-szakaszát a „Fák” elem kezeli.</p>}
        {removalApi?.cat.tree.has(id) ? (
          <RemovalTree element={id} model={model} groups={el.groups} edits={edits} onSet={onSet} openFirst={id !== "trees" && id !== "code"} />
        ) : (
          el.groups.length > 0 && <GroupList model={model} groups={el.groups} edits={edits} onSet={onSet} openFirst={id !== "trees" && id !== "code"} />
        )}
      </>
    );
  };

  const viewBody = () => (
    <div className="space-y-3 py-2">
      {scene === "tree" && (
        <div className="flex flex-wrap gap-1.5">
          {VIEW_BUTTONS.map((v) => (
            <button key={v.id} type="button" onClick={() => (setView(v.id), setViewNonce((n) => n + 1))} className={`min-h-10 rounded-lg px-3 text-[13px] transition lg:min-h-9 lg:text-xs ${view === v.id ? "bg-primary text-primary-foreground" : "border border-border text-foreground/80 hover:bg-secondary"}`}>
              {v.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Toggle on={wireframe} onClick={() => setWireframe((w) => !w)} icon={<Grid3x3 className="h-3.5 w-3.5" />} label="Rács" />
        <Toggle on={showGround} onClick={() => setShowGround((g) => !g)} icon={<Mountain className="h-3.5 w-3.5" />} label="Talaj" />
        <Toggle on={lifelike} onClick={() => setLifelike((l) => !l)} icon={<Layers className="h-3.5 w-3.5" />} label={lifelike ? "Lifelike fa" : "Alap fa"} />
        <Toggle on={showRef} onClick={() => setShowRef((r) => !r)} icon={<ImageIcon className="h-3.5 w-3.5" />} label="Referencia kép" />
        <button type="button" onClick={() => setViewNonce((n) => n + 1)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-foreground/80 lg:min-h-9 lg:text-xs">
          <Eye className="h-3.5 w-3.5" /> Kamera alaphelyzet
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-muted-foreground">
        <span className={overLimit ? "text-destructive" : undefined}>{mesh.vertexCount.toLocaleString("hu-HU")} csúcs</span>
        <span>{mesh.triangleCount.toLocaleString("hu-HU")} háromszög</span>
        <span>{mesh.ringSides} oldal</span>
        <span>{(mesh.topY - 1.1).toFixed(1)} m magas fa</span>
      </div>
      {repo && model && (
        <div className="rounded-xl border border-border p-3 text-[12px] leading-relaxed">
          <p className="font-medium text-foreground">Alap repo: {repo.name}</p>
          <p className="text-muted-foreground">
            {repo.files.size} fájl · {model.stats.files} Kotlin fájl · {model.stats.numbers.toLocaleString("hu-HU")} szám, ebből {model.stats.named} megnevezett érték
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-primary/50 px-3 text-[13px] text-primary lg:min-h-9 lg:text-xs">
              <FolderUp className="h-4 w-4" /> Új repo betöltése (ZIP)
            </button>
            <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-foreground/80 lg:min-h-9 lg:text-xs">
              <Upload className="h-4 w-4" /> TreeTuning.json
            </button>
            {repo.source === "upload" && (
              <button type="button" onClick={resetToBuiltin} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-foreground/80 lg:min-h-9 lg:text-xs">
                <RotateCcw className="h-4 w-4" /> Beépített repo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const panelTitle = panel === "all" ? "Összes elem" : panel === "view" ? "Nézet és repo" : panel === "changes" ? "Változások és patch" : panel ? ELEMENTS.find((e) => e.id === panel)!.label : "";
  const visible = model ? model.elements.filter((e) => e.groups.length > 0 || e.id === "trees") : [];

  return (
    <RemovalContext.Provider value={removalApi}>
      <div className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
        {look ? (
          <StudioViewport scene={scene} mesh={mesh} look={look} wireframe={wireframe} showGround={showGround} view={view} viewNonce={viewNonce} bottomInset={benchH} hidden={removal?.hidden} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {failed ? (
              <>
                <p className="text-sm text-destructive">{failed}</p>
                <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm text-primary-foreground">
                  <FolderUp className="h-4 w-4" /> Repo ZIP betöltése
                </button>
              </>
            ) : (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">{status}</p>
              </>
            )}
          </div>
        )}

        <div className="pointer-events-none absolute left-3 top-3 max-w-[70%] truncate font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/55">
          GameStudio{repo ? ` · ${repo.name}` : ""}
        </div>

        {showRef && (
          <button type="button" onClick={() => setRefLarge(true)} className="absolute right-3 top-3 overflow-hidden rounded-md border border-border shadow-2xl" title="Referencia kép nagyítása">
            <img src={referenceAsset.url} alt="Referencia: erdő vastag, támasztógyökeres fatörzsekkel" className="h-24 w-auto object-cover opacity-90 sm:h-32" />
          </button>
        )}

        {notice && (
          <div role="status" className="absolute left-1/2 top-9 z-30 w-max max-w-[90%] -translate-x-1/2 rounded-md border border-primary/40 bg-card/95 px-3 py-1.5 text-center text-xs shadow-lg">
            {notice}
          </div>
        )}

        {/* Bottom workbench: the drawer opens upwards from the dock; nothing else covers the 3D view. */}
        <div ref={bench} className="absolute inset-x-0 bottom-0 z-20 flex flex-col">
          {panel && model && (
            <div className="mx-auto w-full max-w-[1500px] animate-in fade-in slide-in-from-bottom-4 rounded-t-2xl border-x border-t border-border bg-sidebar/92 shadow-[0_-12px_40px_-20px_var(--color-glow)] backdrop-blur-md lg:mx-4 lg:w-auto">
              <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 lg:px-4">
                <h2 className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">{panelTitle}</h2>
                <label className="relative flex h-9 w-36 items-center sm:w-56">
                  <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Keresés…" aria-label="Érték keresése" className="h-9 w-full rounded-lg border border-input bg-background/60 pl-7 pr-2 text-[13px] outline-none focus:border-primary" />
                </label>
                {panel !== "all" && panel !== "view" && panel !== "changes" && <ItemAction id={`e:${panel}`} label={cat?.items.get(`e:${panel}`)?.label ?? panelTitle} />}
                {panel !== "all" && panel !== "view" && panel !== "changes" && changedBy(panel) > 0 && (
                  <button type="button" onClick={() => resetElement(panel)} className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-primary" title="Elem visszaállítása" aria-label="Elem visszaállítása">
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
                <button type="button" onClick={() => setPanel(null)} className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground/80" aria-label="Panel lecsukása">
                  <ChevronDown className="h-5 w-5" />
                </button>
              </div>
              <div className="panel-scroll max-h-[48dvh] overflow-y-auto overscroll-contain px-4 lg:max-h-[44dvh]">
                {query.trim().length >= 2 ? (
                  <div className="divide-y divide-border/50 py-1">
                    {searchHits.length === 0 && <p className="py-4 text-[13px] text-muted-foreground">Nincs találat.</p>}
                    {searchHits.map(({ row, where }) => (
                      <div key={row.key}>
                        <p className="pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">{where}</p>
                        <RowView model={model} row={row} edits={edits} onSet={onSet} />
                      </div>
                    ))}
                  </div>
                ) : panel === "view" ? (
                  viewBody()
                ) : panel === "changes" ? (
                  <ChangesPanel model={model} repoName={repo?.name ?? ""} diffs={diffs} labels={labels} onDownloadPatch={onDownloadPatch} onDownloadFilePatch={onDownloadFilePatch} onCopy={onCopyDiff} onApply={() => fileInput.current?.click()} onRevert={revertIds} />
                ) : panel === "all" ? (
                  <div className="py-1">
                    {visible.map((e) => (
                      <Fold key={e.id} title={e.label} badge={changedBy(e.id)} action={<ItemAction id={`e:${e.id}`} label={cat?.items.get(`e:${e.id}`)?.label ?? e.label} />}>
                        {() => <div className="pl-1">{elementBody(e.id)}</div>}
                      </Fold>
                    ))}
                  </div>
                ) : (
                  <div className={panel === "trees" ? "py-1" : "gap-6 py-1 lg:columns-2 2xl:columns-3"}>{elementBody(panel)}</div>
                )}
              </div>
            </div>
          )}

          <nav className="flex items-center gap-1.5 border-t border-border bg-sidebar/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:px-3" aria-label="Elemek">
            <div className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
              <DockChip on={panel === "all"} onClick={() => openPanel("all")} label="Lista" icon={<List className="h-4 w-4" />} />
              {visible.map((e) => (
                <DockChip key={e.id} on={panel === e.id} current={scene === e.scene && e.scene !== "world"} onClick={() => openPanel(e.id)} label={e.short} badge={changedBy(e.id)} />
              ))}
              <DockChip on={panel === "changes"} onClick={() => openPanel("changes")} label="Változások" icon={<GitCompareArrows className="h-4 w-4" />} badge={changeTotal} />
              <DockChip on={panel === "view"} onClick={() => openPanel("view")} label="Nézet" icon={<Eye className="h-4 w-4" />} />
            </div>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-foreground/85 disabled:opacity-50" title="Repo (ZIP), patch vagy TreeTuning.json betöltése" aria-label="Repo betöltése">
              <FolderUp className="h-5 w-5" />
            </button>
            <button type="button" onClick={onDownload} disabled={busy || !model} className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground shadow-[0_0_30px_-8px_var(--color-glow)] transition hover:brightness-110 disabled:opacity-60 lg:px-4">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span>ZIP</span>
              {changeTotal > 0 && <span className="rounded-full bg-primary-foreground/20 px-1.5 font-mono text-[10px]">{changeTotal}</span>}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".zip,.json,.patch,.diff,application/zip,application/json,text/x-diff,text/x-patch"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadRepoFile(f);
                e.target.value = "";
              }}
            />
          </nav>
        </div>

        {refLarge && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-6 backdrop-blur" onClick={() => setRefLarge(false)}>
            <img src={referenceAsset.url} alt="Referencia kép" className="max-h-full max-w-full rounded-lg shadow-2xl" />
            <button type="button" className="absolute right-4 top-4 rounded-full bg-card p-2" aria-label="Bezárás">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </RemovalContext.Provider>
  );
}

function DockChip({ on, current, onClick, label, icon, badge }: { on: boolean; current?: boolean; onClick: () => void; label: string; icon?: React.ReactNode; badge?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`relative inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition lg:min-h-10 ${on ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary/60 text-primary" : "border-border text-foreground/80 hover:border-primary/40"}`}
    >
      {icon}
      {label}
      {!!badge && <span className={`rounded-full px-1.5 font-mono text-[10px] ${on ? "bg-primary-foreground/20" : "bg-primary/15 text-primary"}`}>{badge}</span>}
    </button>
  );
}
