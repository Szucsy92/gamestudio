import { Gauge } from "lucide-react";
import { useMemo, useState } from "react";
import { avgTriangles, LOD_KEYS, reduceTree, type LodKey, type LodResult } from "@/tree/lod";
import { SPECIES, type ParamKey, type SpeciesParams } from "@/tree/params";

interface Props {
  /** The tuned values per species, and the values of the untouched repo. */
  species: SpeciesParams;
  base: SpeciesParams;
  count: number;
  active: number;
  soilBottom: boolean;
  /** Settings this repo's Meshes.kt has. */
  available: ReadonlySet<ParamKey>;
  onApply: (sp: number, knobs: Record<LodKey, number>) => void;
}

const fmt = (n: number) => Math.round(n).toLocaleString("hu-HU");

/**
 * Triangles per tree, and a one-tap reduction: pick a share of the original triangles, the studio tries the settings
 * that cost triangles but not shape (sides, flare rows, limb rings) and applies the closest to the original look.
 */
export function LodPanel({ species, base, count, active, soilBottom, available, onApply }: Props) {
  const [target, setTarget] = useState(50);
  const [results, setResults] = useState<{ sp: number; r: LodResult }[]>([]);
  const [busy, setBusy] = useState(false);
  const allowed = useMemo(() => new Set<ParamKey>(LOD_KEYS.filter((k) => available.has(k))), [available]);
  const now = useMemo(() => avgTriangles(species[active]!, active, { soilBottom }), [species, active, soilBottom]);
  const orig = useMemo(() => avgTriangles(base[active]!, active, { soilBottom }), [base, active, soilBottom]);
  const total = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += avgTriangles(species[i]!, i, { soilBottom }, [0, 4, 8, 12]);
    return sum / count;
  }, [species, count, soilBottom]);

  const run = (list: number[]) => {
    setBusy(true);
    // let the button repaint before the (few hundred ms) search
    setTimeout(() => {
      const out: { sp: number; r: LodResult }[] = [];
      for (const sp of list) {
        const r = reduceTree(base[sp]!, species[sp]!, sp, { target: target / 100, allowed, soilBottom });
        onApply(sp, r.knobs);
        out.push({ sp, r });
      }
      setResults(out);
      setBusy(false);
    }, 30);
  };

  if (!allowed.size)
    return <p className="rounded-lg border border-destructive/50 p-3 text-[12px] text-destructive">Ebben a repóban a fa-kód nem tartalmaz háromszög-beállításokat (és nem is frissíthető), ezért az optimalizálás nem érhető el.</p>;

  const btn = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2 text-[13px] transition disabled:opacity-50 lg:min-h-9 lg:text-xs";
  return (
    <div className="space-y-3 border-b border-border/60 py-3">
      <p className="flex items-center gap-2 text-[13px] font-medium">
        <Gauge className="h-4 w-4 text-primary" /> Háromszögek csökkentése
      </p>
      <p className="font-mono text-[12px] text-muted-foreground">
        {SPECIES[active]!.label}: {fmt(now)} háromszög / fa (eredeti: {fmt(orig)}, {orig > 0 ? Math.round((100 * now) / orig) : 100}%) · a {count} faj átlaga: {fmt(total)}
      </p>
      <label className="block text-[13px]">
        <span className="flex justify-between">
          <span>Cél: az eredeti háromszögek</span>
          <span className="font-mono">{target}%</span>
        </span>
        <input type="range" min={25} max={100} step={5} value={target} onChange={(e) => setTarget(Number(e.target.value))} aria-label="Cél háromszögszám százalékban" className="mt-1 h-8 w-full accent-primary" />
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" disabled={busy} onClick={() => run([active])} className={`${btn} border-primary/60 text-primary hover:bg-primary/10`}>
          Ennél a fajnál
        </button>
        <button type="button" disabled={busy} onClick={() => run(Array.from({ length: count }, (_, i) => i))} className={`${btn} border-border text-foreground/80 hover:border-primary/40`}>
          Mind a {count} fajnál
        </button>
      </div>
      {busy && <p className="text-[12px] text-muted-foreground">Beállítások keresése…</p>}
      {results.length > 0 && (
        <ul className="space-y-1 text-[12px]">
          {results.map(({ sp, r }) => (
            <li key={sp} className="rounded-lg border border-border/70 p-2">
              <p className="font-medium">
                {SPECIES[sp]!.label}: {fmt(r.baseline)} → {fmt(r.triangles)} háromszög ({Math.round((100 * r.triangles) / r.baseline)}%){r.short ? " – a cél ennyivel nem érhető el" : ""}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                oldalak ≥ {r.knobs.radialMin}, körbeosztás ×{r.knobs.radialMult}, törzstő {r.knobs.flareRows} sor, ágak {r.knobs.limbRings} gyűrű · eltérés az eredetitől: átlag {r.meanCm.toFixed(1)} cm, legnagyobb {r.worstCm.toFixed(1)} cm{r.limbCm > 0.05 ? `, ágak ${r.limbCm.toFixed(0)} cm` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">Csak a felbontás változik (oldalak, törzstő sorai, ágak gyűrűi), a fa alakja és mérete nem. A beállítások lent állíthatók tovább, és a „Repó értékei” visszahozza az eredetit.</p>
    </div>
  );
}
