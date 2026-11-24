import { ClipboardCopy, Download, FileCode2, FileDiff as FileDiffIcon, Folder, History, RotateCcw, Trash2, Undo2, Upload } from "lucide-react";
import { useMemo } from "react";
import { useRemoval } from "@/components/removal-context";
import { Fold } from "@/components/ValuePanel";
import { codeNameOf, type Model } from "@/studio/catalog";
import { countDirs, folderTree, type DirNode, type FileDiff } from "@/studio/diff";
import { KIND_LABEL, removedViews } from "@/studio/removal-state";
import { formatLiteral } from "@/studio/scan";

interface Props {
  model: Model;
  repoName: string;
  diffs: FileDiff[];
  labels: Map<string, string>;
  onDownloadPatch: (revert?: boolean) => void;
  onDownloadFilePatch: (d: FileDiff, revert?: boolean) => void;
  onCopy: () => void;
  onApply: () => void;
  onRevert: (ids: string[]) => void;
}

const btn = "inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-[13px] lg:min-h-9 lg:text-xs";

/** The changes against the base repo, folder by folder, with the diff of each file and patch downloads. */
export function ChangesPanel({ model, repoName, diffs, labels, onDownloadPatch, onDownloadFilePatch, onCopy, onApply, onRevert }: Props) {
  const tree = useMemo(() => folderTree(diffs), [diffs]);
  const values = diffs.reduce((a, d) => a + d.changes.length, 0);
  const removedCount = useRemoval()?.removed.length ?? 0;
  return (
    <div className="space-y-3 py-2">
      <div className="rounded-xl border border-border p-3 text-[12px] leading-relaxed">
        <p className="font-medium text-foreground">Alap: {repoName}</p>
        <p className="text-muted-foreground">
          {values} módosított érték{removedCount > 0 ? ` · ${removedCount} törlés` : ""} · {diffs.length} fájl · {countDirs(tree)} mappa
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onDownloadPatch()} disabled={!diffs.length} className={`${btn} border-primary/50 text-primary disabled:opacity-40`}>
            <Download className="h-4 w-4" /> Patch letöltése
          </button>
          <button type="button" onClick={() => onDownloadPatch(true)} disabled={!diffs.length} className={`${btn} border-accent/60 text-accent disabled:opacity-40`}>
            <History className="h-4 w-4" /> Visszaállító patch
          </button>
          <button type="button" onClick={onCopy} disabled={!diffs.length} className={`${btn} border-border text-foreground/80 disabled:opacity-40`}>
            <ClipboardCopy className="h-4 w-4" /> Diff másolása
          </button>
          <button type="button" onClick={onApply} className={`${btn} border-border text-foreground/80`}>
            <Upload className="h-4 w-4" /> Patch alkalmazása
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          A repó gyökérmappájában: <code className="font-mono text-foreground/80">git apply valtozasok.patch</code> vagy <code className="font-mono text-foreground/80">patch -p1 &lt; valtozasok.patch</code>
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">Ha az alkalmazás után gond van, a visszaállító patch ugyanígy alkalmazva visszahozza az alap repó eredeti értékeit.</p>
      </div>
      <RemovedList model={model} labels={labels} />
      {diffs.length === 0 ? (
        <p className="py-3 text-[13px] text-muted-foreground">Még nincs eltérés az alap repótól. Mozdíts meg egy csúszkát, és itt látod mappánként, fájlonként.</p>
      ) : (
        <DirView node={tree} depth={0} model={model} labels={labels} onDownloadFilePatch={onDownloadFilePatch} onRevert={onRevert} />
      )}
    </div>
  );
}

/** What was deleted from the code, each item undone on its own or all at once. */
function RemovedList({ model, labels }: Pick<Props, "model" | "labels">) {
  const api = useRemoval();
  const views = useMemo(() => (api ? removedViews(model, api.cat, api.state, api.removed, labels) : []), [api, model, labels]);
  if (!api || !views.length) return null;
  return (
    <div className="rounded-xl border border-destructive/40 p-3 text-[12px] leading-relaxed">
      <div className="flex items-center gap-2">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-foreground">
          <Trash2 className="h-4 w-4 shrink-0 text-destructive" /> Törölt tételek · {views.length}
        </p>
        <button type="button" onClick={() => api.restore(views.map((v) => v.id))} className={`${btn} shrink-0 border-primary/50 text-primary`}>
          <Undo2 className="h-4 w-4" /> Mind vissza
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">A törölt rész minden hivatkozásával együtt kikerül a kódból és a 3D nézetből. A visszavonás visszahozza.</p>
      <ul className="mt-1 divide-y divide-border/50">
        {views.map((v) => (
          <li key={v.id} className="flex items-center gap-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-foreground/90">{v.label}</p>
              <p className="truncate font-mono text-[10.5px] text-muted-foreground">
                {KIND_LABEL[v.kind]}
                {v.where ? ` · ${v.where}` : ""}
                {v.problem ? ` · nem alkalmazható: ${v.problem}` : ""}
              </p>
            </div>
            <button type="button" onClick={() => api.restore([v.id])} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-primary" aria-label={`${v.label} törlésének visszavonása`} title="Törlés visszavonása">
              <Undo2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DirView({ node, depth, ...rest }: { node: DirNode; depth: number } & Pick<Props, "model" | "labels" | "onDownloadFilePatch" | "onRevert">) {
  return (
    <>
      {node.dirs.map((d) => (
        <Fold
          key={d.path}
          depth={depth}
          defaultOpen={depth < 2}
          badge={d.count}
          title={
            <span className="flex min-w-0 items-center gap-1.5">
              <Folder className="h-4 w-4 shrink-0 text-primary/80" />
              <span className="truncate font-mono text-[12.5px]">{d.name}/</span>
            </span>
          }
        >
          {() => <DirView node={d} depth={depth + 1} {...rest} />}
        </Fold>
      ))}
      {node.files.map((f) => (
        <FileView key={f.path} file={f} depth={depth} {...rest} />
      ))}
    </>
  );
}

function FileView({ file, depth, model, labels, onDownloadFilePatch, onRevert }: { file: FileDiff; depth: number } & Pick<Props, "model" | "labels" | "onDownloadFilePatch" | "onRevert">) {
  return (
    <Fold
      depth={depth}
      badge={file.changes.length}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-[12.5px]">{file.path.split("/").pop()}</span>
          {file.removed > 0 && <span className="shrink-0 font-mono text-[10.5px] text-destructive">−{file.removed} sor</span>}
        </span>
      }
    >
      {() => (
        <div className="space-y-2 pb-1">
          <ul className="divide-y divide-border/50">
            {file.changes.map(({ lit, to }) => (
              <li key={lit.id} className="flex items-center gap-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-foreground/90">{labels.get(lit.id) ?? lit.decl ?? `${lit.line}. sor`}</p>
                  <p className="truncate font-mono text-[10.5px] text-muted-foreground">
                    ({codeNameOf(model, lit)}) · {lit.line}. sor
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[11.5px] tabular-nums">
                  <span className="text-destructive line-through decoration-destructive/50">{lit.raw}</span>
                  <span className="text-muted-foreground"> → </span>
                  <span className="text-primary">{formatLiteral(lit, to)}</span>
                </span>
                <button type="button" onClick={() => onRevert([lit.id])} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-primary" aria-label="Érték visszaállítása" title="Vissza a repó értékére">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => onDownloadFilePatch(file)} className={`${btn} border-border text-foreground/80`}>
              <FileDiffIcon className="h-4 w-4" /> Fájl patch
            </button>
            <button type="button" onClick={() => onDownloadFilePatch(file, true)} className={`${btn} border-border text-foreground/80`}>
              <History className="h-4 w-4" /> Fájl visszaállító patch
            </button>
            <button type="button" onClick={() => onRevert(file.changes.map((c) => c.lit.id))} className={`${btn} border-border text-foreground/80`}>
              <RotateCcw className="h-4 w-4" /> Csúszkák vissza
            </button>
          </div>
          <p className="truncate font-mono text-[10px] text-muted-foreground" title={file.path}>
            {file.path}
          </p>
          <DiffView patch={file.patch} />
        </div>
      )}
    </Fold>
  );
}

/** Coloured unified diff; the file header lines are left out (the path is shown above). */
export function DiffView({ patch }: { patch: string }) {
  const lines = useMemo(() => patch.split("\n").filter((l, i) => l !== "" && !(i < 3 && /^(diff --git|--- |\+\+\+ )/.test(l))), [patch]);
  return (
    <pre className="max-h-[40dvh] overflow-auto rounded-lg border border-border bg-background/70 py-1.5 font-mono text-[10.5px] leading-[1.5]">
      <div className="min-w-max">
        {lines.map((l, i) => {
          const c = l[0];
          const cls = c === "@" ? "bg-secondary/60 text-muted-foreground" : c === "-" ? "bg-destructive/10 text-destructive" : c === "+" ? "bg-primary/10 text-primary" : c === "\\" ? "text-muted-foreground italic" : "text-foreground/70";
          return (
            <div key={i} className={`whitespace-pre px-2 ${cls}`}>
              {l}
            </div>
          );
        })}
      </div>
    </pre>
  );
}
