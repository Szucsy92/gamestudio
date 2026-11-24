import * as Slider from "@radix-ui/react-slider";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { GROUPS, PARAM_SPECS, type GroupId, type ParamKey, type ParamSpec, type TreeParams } from "@/tree/params";

export type TabId = GroupId | "tree";

/** Short tab labels so the tab strip fits a phone held in one hand. */
const TAB_LABEL: Record<TabId, string> = {
  join: "Csatlakozás",
  trunk: "Törzs",
  roots: "Gyökerek",
  base: "Talaj alatt",
  limbs: "Ágak",
  forks: "Mellékágak",
  bark: "Kéreg",
  quality: "Felbontás",
  tree: "Fafaj",
};

export const TABS: TabId[] = [...GROUPS.map((g) => g.id), "tree"];

function decimals(step: number) {
  const s = String(step);
  return s.includes(".") ? s.split(".")[1]!.length : 0;
}

function clampStep(spec: ParamSpec, v: number) {
  const c = Math.min(spec.max, Math.max(spec.min, v));
  return spec.int ? Math.round(c) : Number(c.toFixed(decimals(spec.step)));
}

/** − / + button that repeats while held, for precise one-thumb tuning. */
function StepButton({ dir, spec, valueRef, onChange }: { dir: -1 | 1; spec: ParamSpec; valueRef: React.MutableRefObject<number>; onChange: (key: ParamKey, value: number) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const bump = () => {
    const next = clampStep(spec, valueRef.current + dir * spec.step);
    valueRef.current = next;
    onChange(spec.key, next);
  };
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    bump();
    const loop = (delay: number) => {
      timer.current = setTimeout(() => {
        bump();
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
          bump();
        }
      }}
      aria-label={`${spec.label} ${dir < 0 ? "csökkentése" : "növelése"}`}
      className="flex h-10 w-10 shrink-0 touch-none select-none items-center justify-center rounded-full border border-border bg-card text-foreground/85 transition active:scale-95 active:border-primary active:text-primary lg:h-8 lg:w-8"
    >
      {dir < 0 ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
    </button>
  );
}

/** The Kotlin array behind a tree slider, in brackets under its Hungarian label: TREE_HEIGHT[2]. */
export function KtName({ name, index }: { name: string; index?: number | undefined }) {
  return (
    <span className="mt-0.5 block truncate font-mono text-[10.5px] leading-snug text-accent" title={`Meshes.kt · ${name}${index !== undefined ? `, ${index + 1}. fafaj` : ""}`}>
      ({name}
      {index !== undefined ? `[${index}]` : ""})
    </span>
  );
}

const ParamRow = memo(function ParamRow({
  spec,
  value,
  fileValue,
  onChange,
  ktIndex,
}: {
  spec: ParamSpec;
  value: number;
  fileValue: number;
  onChange: (key: ParamKey, value: number) => void;
  ktIndex?: number | undefined;
}) {
  const ktName = <KtName name={spec.kt} index={ktIndex} />;
  const valueRef = useRef(value);
  valueRef.current = value;
  const changed = Math.abs(value - fileValue) > 1e-9;
  const d = decimals(spec.step);
  if (spec.toggle) {
    const on = value >= 0.5;
    return (
      <div className="flex items-center justify-between gap-3 py-3">
        <span className="text-[14px] leading-tight text-foreground/90 lg:text-[13px]">
          {spec.label}
          {ktName}
          {spec.hint && <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{spec.hint}</span>}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={spec.label}
          onClick={() => onChange(spec.key, on ? 0 : 1)}
          className={`relative h-9 w-16 shrink-0 rounded-full border transition ${on ? "border-primary bg-primary" : "border-border bg-secondary"}`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-background shadow transition-all ${on ? "left-8" : "left-1"}`} />
        </button>
      </div>
    );
  }
  return (
    <div className="py-2.5">
      <div className="flex items-start justify-between gap-2">
        <label htmlFor={`p-${spec.key}`} className="text-[14px] leading-tight text-foreground/90 lg:text-[13px]">
          {spec.label}
          {ktName}
          {spec.hint && <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{spec.hint}</span>}
        </label>
        <div className="flex shrink-0 items-center gap-1">
          {changed && (
            <button
              type="button"
              onClick={() => onChange(spec.key, fileValue)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:text-primary"
              title={`Vissza az eredeti fájl értékére (${fileValue})`}
              aria-label={`${spec.label} visszaállítása`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <input
            id={`p-${spec.key}`}
            type="number"
            inputMode="decimal"
            value={Number(value.toFixed(d))}
            step={spec.step}
            min={spec.min}
            max={spec.max}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) onChange(spec.key, Math.min(spec.max, Math.max(spec.min, spec.int ? Math.round(v) : v)));
            }}
            className={`h-8 w-[4.8rem] rounded-md border border-input bg-background/60 px-2 text-right font-mono text-[13px] tabular-nums outline-none focus:border-primary ${changed ? "text-primary" : "text-foreground"}`}
          />
          {spec.unit && <span className="w-6 font-mono text-[10px] text-muted-foreground">{spec.unit}</span>}
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-2.5">
        <StepButton dir={-1} spec={spec} valueRef={valueRef} onChange={onChange} />
        <Slider.Root
          className="relative flex h-10 w-full touch-none select-none items-center lg:h-8"
          value={[value]}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onValueChange={(v) => onChange(spec.key, v[0] ?? value)}
          aria-label={spec.label}
        >
          <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-secondary">
            <Slider.Range className="absolute h-full bg-primary/75" />
          </Slider.Track>
          <Slider.Thumb className="block h-7 w-7 rounded-full border-2 border-primary bg-background shadow-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-110 lg:h-5 lg:w-5" />
        </Slider.Root>
        <StepButton dir={1} spec={spec} valueRef={valueRef} onChange={onChange} />
      </div>
    </div>
  );
});

export function changedIn(group: GroupId, params: TreeParams, fileValues: TreeParams) {
  return PARAM_SPECS.filter((s) => s.group === group && Math.abs(params[s.key] - fileValues[s.key]) > 1e-9).length;
}

/** The sliders of one group (one tab). */
export function ParamGroup({ group, params, fileValues, onChange, skip = [], ktIndex }: { group: GroupId; params: TreeParams; fileValues: TreeParams; onChange: (key: ParamKey, value: number) => void; skip?: ParamKey[]; ktIndex?: number | undefined }) {
  const specs = PARAM_SPECS.filter((s) => s.group === group && !skip.includes(s.key));
  return (
    <div className="divide-y divide-border/60">
      {specs.map((s) => (
        <ParamRow key={s.key} spec={s} value={params[s.key]} fileValue={fileValues[s.key]} onChange={onChange} ktIndex={ktIndex} />
      ))}
    </div>
  );
}

/** Horizontally scrolling tab strip; tapping the open tab again folds the panel away. */
export function ControlTabs({
  active,
  open,
  onSelect,
  params,
  fileValues,
  leading,
}: {
  active: TabId;
  open: boolean;
  onSelect: (t: TabId) => void;
  params: TreeParams;
  fileValues: TreeParams;
  leading?: React.ReactNode;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    strip.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [active]);
  return (
    <div ref={strip} role="tablist" aria-label="Beállítás csoportok" className="no-scrollbar flex gap-1.5 overflow-x-auto px-3 py-2 lg:flex-wrap lg:overflow-visible lg:px-4">
      {leading}
      {TABS.map((t) => {
        const n = t === "tree" ? 0 : changedIn(t, params, fileValues);
        const on = active === t && open;
        return (
          <button
            key={t}
            type="button"
            role="tab"
            data-tab={t}
            aria-selected={active === t}
            onClick={() => onSelect(t)}
            className={`relative inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition lg:min-h-9 lg:px-3 lg:text-xs ${
              on ? "border-primary bg-primary text-primary-foreground" : active === t ? "border-primary/60 text-primary" : "border-border text-foreground/80 hover:border-primary/40"
            }`}
          >
            {TAB_LABEL[t]}
            {n > 0 && <span className={`rounded-full px-1.5 font-mono text-[10px] ${on ? "bg-primary-foreground/20" : "bg-primary/15 text-primary"}`}>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
