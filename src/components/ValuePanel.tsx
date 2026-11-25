import * as Slider from "@radix-ui/react-slider";
import { ChevronDown, Minus, Plus, RotateCcw } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { codeRef, countChanged, valueOf, type Group, type Model, type Row } from "@/studio/catalog";
import { hintFor, snippetFor } from "@/studio/scan";
import { linearTripleToHex, srgb2lin } from "@/studio/look";
import { ItemAction, rowRemoval, useRemoval } from "@/components/removal-context";

export type SetValues = (pairs: [string, number][]) => void;

function decimals(step: number) {
  if (step >= 1) return 0;
  return Math.min(6, Math.max(0, -Math.floor(Math.log10(step))));
}

/** − / + that repeats while held, for one-thumb fine tuning. */
export function RepeatButton({ dir, label, onStep }: { dir: -1 | 1; label: string; onStep: (dir: -1 | 1) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    onStep(dir);
    const loop = (delay: number) => {
      timer.current = setTimeout(() => {
        onStep(dir);
        loop(Math.max(35, delay * 0.8));
      }, delay);
    };
    loop(380);
  };
  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onStep(dir);
        }
      }}
      aria-label={`${label} ${dir < 0 ? "csökkentése" : "növelése"}`}
      className="flex h-10 w-10 shrink-0 touch-none select-none items-center justify-center rounded-full border border-border bg-card text-foreground/85 transition active:scale-95 active:border-primary active:text-primary lg:h-8 lg:w-8"
    >
      {dir < 0 ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
    </button>
  );
}

function CodeLine({ model, id }: { model: Model; id: string }) {
  const lit = model.lits.get(id);
  const src = lit ? model.files.get(lit.file)?.src : undefined;
  const snip = useMemo(() => (lit && src ? snippetFor(src, lit) : null), [lit, src]);
  if (!lit || !snip) return null;
  return (
    <code className="mt-1 block truncate font-mono text-[10.5px] leading-snug text-muted-foreground">
      <span className="text-muted-foreground/70">{lit.file.split("/").pop()}:{lit.line} </span>
      {snip.before}
      <span className="rounded bg-primary/15 px-0.5 text-primary">{snip.text}</span>
      {snip.after}
    </code>
  );
}

/** The row's name in the code, in brackets under the Hungarian label; nothing when they are the same. */
export function CodeRef({ model, row }: { model: Model; row: Row }) {
  const ref = useMemo(() => codeRef(model, row), [model, row]);
  if (!ref) return null;
  return (
    <span className="mt-0.5 block truncate font-mono text-[10.5px] leading-snug text-accent" title={ref.title}>
      ({ref.name})<span className="text-muted-foreground/70"> · {ref.where}</span>
    </span>
  );
}

function useHint(model: Model, row: Row) {
  return useMemo(() => {
    if (row.hint) return row.hint;
    if (!row.code) return undefined;
    const lit = model.lits.get(row.ids[0]!);
    const src = lit ? model.files.get(lit.file)?.src : undefined;
    return lit && src && lit.decl ? hintFor(src, lit) : undefined;
  }, [model, row]);
}

/** A row whose number was deleted (by itself or by something bigger): dimmed, with its undo. */
function DeletedRow({ row, id, own }: { row: Row; id: string; own: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2.5 opacity-70">
      <span className="min-w-0 text-[14px] leading-tight text-muted-foreground line-through lg:text-[13px]">
        {row.label}
        <span className="mt-0.5 block text-[11px] no-underline">{own ? "Törölve a kódból" : "Egy másik törlés miatt eltűnt"}</span>
      </span>
      <ItemAction id={id} label={row.label} dead={!own} />
    </div>
  );
}

const NumRow = memo(function NumRow({ model, row, value, base, onSet }: { model: Model; row: Row; value: number; base: number; onSet: SetValues }) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const hint = useHint(model, row);
  const rem = rowRemoval(useRemoval(), row.ids);
  const changed = Math.abs(value - base) > 1e-12;
  const { step, int } = row.range;
  const min = Math.min(row.range.min, value);
  const max = Math.max(row.range.max, value);
  const d = decimals(step);
  const set = (v: number) => {
    const c = int ? Math.round(v) : Number(v.toFixed(Math.max(d, 6)));
    valueRef.current = c;
    onSet(row.ids.map((id) => [id, c]));
  };
  if (rem?.dead) return <DeletedRow row={row} id={rem.id} own={rem.own} />;
  return (
    <div className="py-2.5">
      <div className="flex items-start justify-between gap-2">
        <label className="min-w-0 text-[14px] leading-tight text-foreground/90 lg:text-[13px]">
          {row.label}
          <CodeRef model={model} row={row} />
          {hint && <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
        </label>
        <div className="flex shrink-0 items-center gap-1">
          {changed && (
            <button type="button" onClick={() => set(base)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:text-primary" title={`Vissza a repó értékére (${base})`} aria-label={`${row.label} visszaállítása`}>
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <input
            type="number"
            inputMode="decimal"
            value={Number(value.toFixed(Math.max(d, 3)))}
            step={step}
            aria-label={`${row.label} értéke`}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) set(v);
            }}
            className={`h-8 w-[5.4rem] rounded-md border border-input bg-background/60 px-2 text-right font-mono text-[13px] tabular-nums outline-none focus:border-primary ${changed ? "text-primary" : "text-foreground"}`}
          />
          {row.unit && <span className="w-7 font-mono text-[10px] text-muted-foreground">{row.unit}</span>}
          {rem && <ItemAction id={rem.id} label={row.label} />}
        </div>
      </div>
      {row.code && <CodeLine model={model} id={row.ids[0]!} />}
      <div className="mt-1.5 flex items-center gap-2.5">
        <RepeatButton dir={-1} label={row.label} onStep={(dir) => set(Math.max(min, valueRef.current + dir * step))} />
        <Slider.Root className="relative flex h-10 w-full touch-none select-none items-center lg:h-8" value={[value]} min={min} max={max} step={step} onValueChange={(v) => set(v[0] ?? value)} aria-label={row.label}>
          <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-secondary">
            <Slider.Range className="absolute h-full bg-primary/75" />
          </Slider.Track>
          <Slider.Thumb className="block h-7 w-7 rounded-full border-2 border-primary bg-background shadow-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-110 lg:h-5 lg:w-5" />
        </Slider.Root>
        <RepeatButton dir={1} label={row.label} onStep={(dir) => set(Math.min(max, valueRef.current + dir * step))} />
      </div>
    </div>
  );
});

const hex6 = (n: number) => `#${Math.max(0, Math.min(0xffffff, Math.round(n))).toString(16).padStart(6, "0")}`;

function ColorRow({ model, row, edits, onSet }: { model: Model; row: Row; edits: Record<string, number>; onSet: SetValues }) {
  const hint = useHint(model, row);
  const rem = rowRemoval(useRemoval(), row.ids);
  let hex: string, baseHex: string;
  if (row.kind === "color") {
    hex = hex6(valueOf(model, edits, row.ids[0]!));
    baseHex = hex6(model.lits.get(row.ids[0]!)?.value ?? 0);
  } else {
    const v = row.ids.map((id) => valueOf(model, edits, id)) as [number, number, number];
    const b = row.ids.map((id) => model.lits.get(id)?.value ?? 0) as [number, number, number];
    hex = linearTripleToHex(...v);
    baseHex = linearTripleToHex(...b);
  }
  const changed = row.ids.some((id) => id in edits && Math.abs(edits[id]! - (model.lits.get(id)?.value ?? 0)) > 1e-12);
  const apply = (h: string) => {
    const n = parseInt(h.slice(1), 16);
    if (row.kind === "color") onSet([[row.ids[0]!, n]]);
    else {
      const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Number(srgb2lin(c / 255).toFixed(3)));
      onSet(row.ids.map((id, k) => [id, ch[k]!]));
    }
  };
  const reset = () => onSet(row.ids.map((id) => [id, model.lits.get(id)?.value ?? 0]));
  if (rem?.dead) return <DeletedRow row={row} id={rem.id} own={rem.own} />;
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-[14px] leading-tight text-foreground/90 lg:text-[13px]">
          {row.label}
          <CodeRef model={model} row={row} />
          {hint && <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {changed && (
            <button type="button" onClick={reset} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-primary" title={`Vissza: ${baseHex}`} aria-label={`${row.label} visszaállítása`}>
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <span className={`font-mono text-[12px] ${changed ? "text-primary" : "text-muted-foreground"}`}>{hex}</span>
          <label className="relative h-10 w-14 cursor-pointer overflow-hidden rounded-lg border border-border lg:h-8 lg:w-12" style={{ background: hex }}>
            <input type="color" value={hex} onChange={(e) => apply(e.target.value)} aria-label={`${row.label} színe`} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          </label>
          {rem && <ItemAction id={rem.id} label={row.label} />}
        </div>
      </div>
      {row.code && <CodeLine model={model} id={row.ids[0]!} />}
    </div>
  );
}

function BoolRow({ model, row, edits, onSet }: { model: Model; row: Row; edits: Record<string, number>; onSet: SetValues }) {
  const hint = useHint(model, row);
  const rem = rowRemoval(useRemoval(), row.ids);
  const id = row.ids[0]!;
  const lit = model.lits.get(id);
  const base = (lit?.value ?? 0) >= 0.5;
  const on = valueOf(model, edits, id) >= 0.5;
  const changed = on !== base;
  if (rem?.dead) return <DeletedRow row={row} id={rem.id} own={rem.own} />;
  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-[14px] leading-tight text-foreground/90 lg:text-[13px]">
          {row.label}
          <CodeRef model={model} row={row} />
          {hint && <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{hint}</span>}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {changed && (
            <button type="button" onClick={() => onSet([[id, base ? 1 : 0]])} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:text-primary" title={`Vissza: ${base ? "be" : "ki"}`} aria-label={`${row.label} visszaállítása`}>
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={row.label}
            onClick={() => onSet([[id, on ? 0 : 1]])}
            className={`relative h-8 w-14 shrink-0 rounded-full border transition ${on ? "border-primary bg-primary" : "border-border bg-secondary"}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-background shadow transition-all ${on ? "left-7" : "left-1"}`} />
          </button>
          {rem && <ItemAction id={rem.id} label={row.label} />}
        </div>
      </div>
      {row.code && <CodeLine model={model} id={id} />}
    </div>
  );
}

export function RowView({ model, row, edits, onSet }: { model: Model; row: Row; edits: Record<string, number>; onSet: SetValues }) {
  if (row.kind === "bool") return <BoolRow model={model} row={row} edits={edits} onSet={onSet} />;
  if (row.kind !== "num") return <ColorRow model={model} row={row} edits={edits} onSet={onSet} />;
  const lit = model.lits.get(row.ids[0]!);
  return <NumRow model={model} row={row} value={valueOf(model, edits, row.ids[0]!)} base={lit?.value ?? 0} onSet={onSet} />;
}

/** A fold-out ("lenyíló") section; `action` (e.g. a delete button) sits at the end of its header, outside the toggle. */
export function Fold({ title, badge, count, defaultOpen = false, children, depth = 0, action }: { title: React.ReactNode; badge?: number; count?: number | undefined; defaultOpen?: boolean; children: () => React.ReactNode; depth?: number; action?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`break-inside-avoid border-b border-border/60 ${depth ? "ml-2 border-l border-b-0 pl-3" : ""}`}>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 py-2 text-left lg:min-h-10">
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition ${open ? "" : "-rotate-90"}`} />
          <span className={`min-w-0 flex-1 ${depth ? "text-[13px] text-foreground/85" : "text-[14px] font-medium text-foreground"}`}>{title}</span>
          {count !== undefined && <span className="font-mono text-[10px] text-muted-foreground">{count}</span>}
          {!!badge && <span className="rounded-full bg-primary/15 px-1.5 font-mono text-[10px] text-primary">{badge}</span>}
        </button>
        {action}
      </div>
      {open && <div className="pb-2">{children()}</div>}
    </section>
  );
}

export function GroupList({ model, groups, edits, onSet, depth = 0, openFirst = true }: { model: Model; groups: Group[]; edits: Record<string, number>; onSet: SetValues; depth?: number; openFirst?: boolean }) {
  return (
    <>
      {groups.map((g, i) => (
        <Fold key={g.id} title={g.label} depth={depth} badge={countChanged(model, edits, g)} count={g.sub ? undefined : g.rows.length} defaultOpen={openFirst && i === 0 && depth === 0}>
          {() => (
            <>
              {g.rows.length > 0 && (
                <div className="divide-y divide-border/50">
                  {g.rows.map((r) => (
                    <RowView key={r.key} model={model} row={r} edits={edits} onSet={onSet} />
                  ))}
                </div>
              )}
              {g.sub && <GroupList model={model} groups={g.sub} edits={edits} onSet={onSet} depth={depth + 1} openFirst={false} />}
            </>
          )}
        </Fold>
      ))}
    </>
  );
}
