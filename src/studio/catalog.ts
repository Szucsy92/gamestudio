/**
 * Turns a scanned repo into the element list of the studio: elements (trees, gates, …) → fold-out groups → rows,
 * every row a slider (or colour) bound to one or more literals of the Kotlin sources.
 */
import { CURATED, findFile, resolveCurated, type ElementId, type FileIndex } from "./curated";
import { autoRange, callContext, scanKotlin, type CallFrame, type Literal, type Range } from "./scan";
import { fileDefaults, PARAM_SPECS, SPECIES, type ParamKey, type SpeciesParams, type TreeParams } from "@/tree/params";
import { SECTION_END, SECTION_START } from "@/tree/kotlin";

export type SceneId = "tree" | "gates" | "hole" | "orbs" | "world" | "dynamic";

export interface Row {
  key: string;
  label: string;
  hint?: string | undefined;
  unit?: string | undefined;
  kind: "num" | "color" | "color3" | "bool";
  ids: string[];
  range: Range;
  /** Show the source line (generic rows). */
  code: boolean;
}

export interface Group {
  id: string;
  label: string;
  rows: Row[];
  sub?: Group[];
}

export interface ElementDef {
  id: ElementId;
  label: string;
  short: string;
  scene: SceneId;
  groups: Group[];
  /** Kotlin object/class section name for dynamically discovered elements (e.g. "Visuals.GateRing"). */
  section?: string | undefined;
  /** Repo-relative file path where this dynamic element is declared. */
  file?: string | undefined;
}

export interface TreeBase {
  found: boolean;
  species: SpeciesParams;
  count: number;
  available: Set<ParamKey>;
  ids: Partial<Record<ParamKey, string[]>>;
  soilBottom: boolean;
}

export interface Model {
  files: Map<string, FileIndex>;
  /** Every Kotlin source of the repo (tests included), for the deletion engine. */
  kt: Map<string, string>;
  lits: Map<string, Literal>;
  elements: ElementDef[];
  curated: Map<string, string[]>;
  tree: TreeBase;
  stats: { files: number; numbers: number; named: number };
  /** True when the repo defines modular visual objects (e.g. Visuals.* or arbitrary repo visual classes). */
  dynamic: boolean;
}

export const ELEMENTS: { id: ElementId; label: string; short: string; scene: SceneId }[] = [
  { id: "trees", label: "Fák", short: "Fák", scene: "tree" },
  { id: "gates", label: "Kapuk és oszlopok", short: "Kapuk", scene: "gates" },
  { id: "hole", label: "Fekete lyuk és féreglyuk", short: "Fekete lyuk", scene: "hole" },
  { id: "orbs", label: "Power-up gömbök", short: "Power-up", scene: "orbs" },
  { id: "colors", label: "Színek", short: "Színek", scene: "world" },
  { id: "lights", label: "Fények és ég", short: "Fények", scene: "world" },
  { id: "graphics", label: "Grafika", short: "Grafika", scene: "world" },
  { id: "gameplay", label: "Játékmenet", short: "Játékmenet", scene: "world" },
  { id: "sound", label: "Hang", short: "Hang", scene: "world" },
  { id: "other", label: "Egyéb", short: "Egyéb", scene: "world" },
  { id: "code", label: "Kód – minden szám", short: "Kód", scene: "world" },
];

/** Hungarian names for the named values of the game. Unknown names show the Kotlin name and its code comment. */
export const LABELS: Record<string, [string, string?]> = {
  CELL: ["Erdőrács cellamérete", "m"], RADIUS: ["Látható cellák sugara", "cella"], FOG_END: ["Köd vége", "m"],
  "MAX_HEADING[0]": ["Legnagyobb irányszög", "°"], IMPACT_DURATION: ["Ütközés hossza", "s"], MAX_IMPACTS: ["Ütközések a bukásig", "db"],
  PAUSE_SLOW: ["Megállás lassítása", "s"], RESUME_TIME: ["Folytatás ideje", "s"], EXIT_TIME: ["Kilépés ideje", "s"],
  POWERUP_START: ["Első power-up távolsága", "m"], POWERUP_DURATION: ["Power-up hatásideje", "s"], POWERUP_GAP: ["Power-upok távolsága", "m"],
  "SHOCKWAVE_FULL[0]": ["Lökéshullám teljes hatótáv (köd vége +)", "m"], SHOCKWAVE_REACH: ["Lökéshullám elérése (arány)"], SHOCKWAVE_SIDE: ["Lökéshullám oldalt", "m"],
  SHOCKWAVE_SPREAD: ["Lökéshullám szétterülése"], SHOCKWAVE_WAVE: ["Egy hullám ideje", "s"], SHOCKWAVE_GAP: ["Hullámok közti idő", "s"],
  SHOCKWAVE_RINGS: ["Hullámgyűrűk száma", "db"], SHOCKWAVE_DISSOLVE: ["Fák feloldódása", "s"], SHOCKWAVE_COMMIT: ["Lökés véglegesítése", "s"],
  SURVIVE_DARK_AT: ["Túlélés: sötétedés kezdete", "s"], LIGHTS_DIE: ["Fények kialvása", "s"], DARK_PAUSE: ["Sötét szünet", "s"], FREEROAM_TURN: ["Szabad mód fordulási sebesség"],
  SECRET_CELL: ["Titkos helyek rácsa", "m"], SECRET_REACH: ["Titkos hely elérési távolsága", "m"], SECRET_CLEARING: ["Tisztás a titkos hely körül", "m"],
  GATE_CELL: ["Kapuk rácstávolsága", "m"], GATE_HALF: ["Kapu nyílásának fél szélessége", "m"], GATE_DEPTH: ["Kapu átlépési mélysége", "m"],
  GATE_CLEARING: ["Tisztás a kapu körül", "m"], GATE_REARM: ["Kapu újraélesedése", "s"],
  HOLE_CELL: ["Fekete lyukak rácsa", "m"], HOLE_CHANCE: ["Fekete lyuk esélye cellánként"], HOLE_SEE: ["Láthatósági távolság", "m"],
  HOLE_RADIUS: ["Fekete lyuk sugara", "m"], HOLE_HEIGHT: ["Lebegési magasság", "m"], HOLE_CORE: ["Elnyelési sugár", "m"], HOLE_CLEARING: ["Tisztás a lyuk körül", "m"],
  WARP_DURATION: ["Féreglyuk-utazás hossza", "s"], WARP_FADE_IN: ["Belépés áttűnése", "s"], WARP_FADE_OUT: ["Kilépés áttűnése", "s"], WARP_EXIT_TIME: ["Kilépés ideje", "s"],
  BASE_SPEED: ["Alapsebesség", "m/s"], STRIDE_RATE: ["Lépésritmus"], STRIDE_MAX_MUL: ["Legnagyobb lépésszorzó", "×"], OBSTACLE_DENSITY: ["Akadálysűrűség"],
  TILT_SETTLE_MS: ["Döntés: beállási idő", "ms"], TILT_SAMPLES: ["Döntés: minták", "db"], TILT_STEADY: ["Döntés: nyugalmi küszöb"], TILT_FORCE_MS: ["Döntés: kényszerített kalibrálás", "ms"],
  TILT_PEG: ["Döntés: ütköző"], TILT_PEG_MS: ["Döntés: ütköző ideje", "ms"],
  ORB_ALPHA: ["Gömb átlátszatlansága"], FOV: ["Látószög", "°"], RENDER_SCALE: ["Renderelési felbontás", "×"], MIN_DENSITY: ["Legkisebb fasűrűség"], START_DENSITY: ["Kezdő fasűrűség"],
  SHADOW_RADIUS: ["Árnyékvető fák sugara", "cella"], SHADOW_EVERY: ["Árnyék frissítése (képkockánként)"], WINDOW: ["Látható ablak", "m"],
  CROWN_NEAR_SUBDIVISIONS: ["Lombkorona részletessége közel"], CROWN_FAR_SUBDIVISIONS: ["Lombkorona részletessége távol"], CROWN_LOD_DISTANCE: ["Lombkorona váltási távolság", "m"],
  HOLE_SLOTS: ["Egyszerre rajzolt fekete lyukak", "db"], SWARM: ["Spórák száma", "db"], REMNANTS: ["Maradványok száma", "db"],
  GLITCH_PEAK: ["Glitch csúcs"], GLITCH_FALL: ["Glitch lecsengés"], GLITCH_KICK_TIME: ["Glitch időtartam", "s"],
  MUFFLED_HZ: ["Tompított hang szűrő", "Hz"], MENU_HZ: ["Menü hang szűrő", "Hz"], RUN_HZ: ["Futás hang szűrő", "Hz"],
  bloomThreshold: ["Ragyogás küszöb"], bloomStrength: ["Ragyogás erőssége"], exposure: ["Expozíció"], grain: ["Filmszemcse"], chroma: ["Színi aberráció"],
  lodBias: ["Textúra élesség (LOD)"], fogFarScale: ["Köd távolság szorzó", "×"], lampSoft: ["Fejlámpa lágysága"], shadowRes: ["Árnyéktérkép felbontás", "px"],
  shadowExtent: ["Árnyék kiterjedése", "m"], ssaoRadius: ["SSAO sugár", "m"], ssaoStrength: ["SSAO erősség"], shaftSteps: ["Fénynyaláb lépések", "db"],
  shaftMax: ["Fénynyaláb hossza", "m"], fogDensity: ["Ködsűrűség"], dofStrength: ["Mélységélesség erőssége"], focus: ["Fókusztávolság", "m"], motionBlurMax: ["Mozgási elmosás"],
  "SUN.minElDeg": ["Nap: legalacsonyabb állás", "°"], "SUN.maxElDeg": ["Nap: legmagasabb állás", "°"], "SUN.intensityLow": ["Nap: fény a horizonton"], "SUN.intensityHigh": ["Nap: fény delelőn"],
  "SUN.startCyc": ["Napkelte (ciklus)"], "SUN.lenCyc": ["Nappal hossza (ciklus)"],
  "MOON.minElDeg": ["Hold: legalacsonyabb állás", "°"], "MOON.maxElDeg": ["Hold: legmagasabb állás", "°"], "MOON.intensityLow": ["Hold: fény a horizonton"], "MOON.intensityHigh": ["Hold: fény delelőn"],
  "MOON.startCyc[0]": ["Holdkelte (ciklus)"], "MOON.lenCyc[0]": ["Éjszaka hossza (ciklus)"], OVERLAP: ["Nap és hold átfedése (ciklus)"], fade: ["Fel- és lehalványulás"],
  fog: ["Köd (éjjel)"], moon: ["Holdfény"], lamp: ["Fejlámpa / lámpás"], green: ["Zöld fény (gyűrű)"], purple: ["Lila"], lavender: ["Levendula"], lemon: ["Citrom"],
  trunk: ["Fatörzs"], ground: ["Talaj"], crown: ["Lombkorona"], rock: ["Kő"], plant: ["Növények"], pollen: ["Pollen"], pollenWarm: ["Meleg pollen"], pollenDay: ["Nappali pollen"],
  ember: ["Parázs (kapu izzás)"], pursuer: ["Üldöző (kapu hártya)"], blood: ["Vér"], freezer: ["Fagyasztó power-up"], ghost: ["Szellem power-up"], shock: ["Lökéshullám power-up"],
  secret: ["Titkos fény"], dayFog: ["Nappali köd"], daySky: ["Nappali ég"], dayFogLight: ["Nappali köd (világos)"], daySkyLight: ["Nappali ég (világos)"], dayMoon: ["Nappali hold"],
  ghostGlow: ["Szellem ragyogás"], sunDawn: ["Napfény hajnalban"], sunDay: ["Napfény délben"], sunDusk: ["Napfény alkonyatkor"],
};
for (let i = 0; i < 8; i++) LABELS[`odd[${i}]`] = [`Féreglyuk ereklye szín ${i + 1}.`];

/** Structural indices and plain state defaults: changing them breaks the game rather than tuning it. */
const SKIP_DECL = /^(K_\w+|KINDS|SHAPES|XYZ|YXZ|RATE|VOLUME_POLL_NS|SLOTS|vertexCount|eps)$/;
const SKIP_SECTION = new Set(["UiState", "Settings", "UpdateEvent", "MeshData", "EffectState", "Blip", "MainActivity", "SettingsRepo", "Updater", "EffectsModel", "FxTuning", "Features", "SkyLights", "Sprites"]);
const CORE_SINGLETONS = new Set(["Palette", "SkyLight", "Quality", "Shaders", "Meshes", "GameRenderer", "Simulation", "GameEngine", "PostFx", "ShadowMap", "Effects", "GlUtil", "Mat", "GlassState", "PerfStats", "ForestAudio", "Haptics", "TiltSensor", "ForestUi", "Visuals"]);
const NON_OBJECT_FILE = /^(Shaders|Quality|PostFx|Effects|SkyLight|ShadowMap|Palette|GlUtil|Mat|GlassState|PerfStats|GameRenderer)\.kt$/i;

export const COMMON_WORDS: Record<string, string> = {
  ON: "Bekapcsolva",
  BODY: "Test",
  VEILS: "Fátylak",
  GLOW: "Ragyogás",
  LENS: "Lencsehatás",
  LENS_MAGNIFY: "Lencse nagyítás",
  LENS_FADE_NEAR: "Lencse közeli elhalványulás",
  WARP_SPORES: "Féreglyuk spórák",
  SIZE: "Méret",
  ALPHA: "Átlátszóság",
  EMISSIVE: "Izzás",
  ROUGH: "Érdesség",
  HEIGHT: "Magasság",
  RADIUS: "Sugár",
  GAP: "Rés a talajtól",
  SEE: "Láthatósági táv",
  MAX: "Maximum",
  COUNT: "Darabszám",
  RANGE: "Hatótáv",
  BOB: "Lebegés",
  PULSE: "Pulzálás",
  SPIN: "Forgás",
  SPEED: "Sebesség",
  WIDTH: "Szélesség",
  DEPTH: "Mélység",
  DAY_DIM: "Nappali halványítás",
  TORUS_R: "Gyűrű sugara",
  TORUS_TUBE: "Gyűrű vastagsága",
  VANISH_TIME: "Eltűnési idő",
  FLOW: "Belső áramlás",
  RING_SIZE: "Gyűrű mérete",
  RING_ALPHA: "Gyűrű átlátszósága",
  GLITCH_PEAK: "Glitch csúcs",
  GLITCH_FALL: "Glitch lecsengés",
  GLITCH_KICK_TIME: "Glitch időtartam",
};

/** Converts UPPER_SNAKE_CASE or camelCase into a clean readable label. */
export function humanizeIdent(name: string): string {
  const base = name.split(/[.[]/)[0]!;
  const idxMatch = /\[(\d+)\]/.exec(name);
  const suffix = idxMatch ? ` #${Number(idxMatch[1]) + 1}` : "";
  if (COMMON_WORDS[base]) return `${COMMON_WORDS[base]!}${suffix}`;
  const spaced = base
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
  if (!spaced) return name;
  return `${spaced.charAt(0).toUpperCase() + spaced.slice(1)}${suffix}`;
}

export function humanizeObject(section: string): string {
  const leaf = section.split(".").pop() ?? section;
  return leaf.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
}

function isVisualCandidate(path: string, section: string, lits: Literal[]): boolean {
  if (!lits.length) return false;
  const leaf = section.split(".").pop() ?? section;
  if (SKIP_SECTION.has(leaf) || CORE_SINGLETONS.has(section)) return false;
  if (/\/(audio|ui|update|data|input)\//i.test(path)) return false;
  if (NON_OBJECT_FILE.test(fileName(path))) return false;
  // Nested object inside a container (e.g. Visuals.GateRing, Entities.Ship) is always a first-class visual object.
  if (section.includes(".")) return true;
  // Top-level object/class in a visual/rendering/3D/entity file with >= 2 tunable constants
  const inVisualDir = /\/(gl|render|visual|scene|entity|entities|mesh|3d|world|objects?)\//i.test(path) || /(Visual|Render|Scene|Mesh|Entity|Object|Prop|Effect)/i.test(fileName(path));
  if (inVisualDir && !CORE_SINGLETONS.has(leaf) && lits.length >= 2) return true;
  // Or any object/class with explicit visual dimension/toggle constants
  const visualNames = lits.filter((l) => /^(ON|SIZE|RADIUS|HEIGHT|WIDTH|DEPTH|ALPHA|EMISSIVE|ROUGH|TORUS_R|GLOW|COLOR|COUNT|SPIN|BOB)$/i.test(l.declBase ?? "")).length;
  return visualNames >= 2;
}

function classify(path: string, decl: string, lit: Literal): ElementId {
  const base = decl.split(/[.[]/)[0]!;
  if (lit.kind === "hex" || /Palette\.kt$/i.test(path)) return "colors";
  if (/SkyLight|Light|Sun|Moon|Atmos/i.test(fileName(path))) return "lights";
  if (path.endsWith("/Meshes.kt")) return "trees";
  if (/\/(gl|shader|render)\//i.test(path) || /Shader|PostFx|Quality|Shadow|Renderer/i.test(fileName(path))) return "graphics";
  if (/\/(audio|sound)\//i.test(path) || /Audio|Sound|Haptics/i.test(fileName(path))) return "sound";
  if (/\/(sim|input|game|physics)\//i.test(path) || /Engine|Simulation|Gameplay/i.test(fileName(path))) return "gameplay";
  return "other";
}

const fileName = (p: string) => p.split("/").pop()!;

export function scanFiles(texts: Map<string, string>): Map<string, FileIndex> {
  const files = new Map<string, FileIndex>();
  for (const [path, src] of texts) {
    if (!path.endsWith(".kt") || /\/src\/test\//.test(path)) continue;
    const lits = scanKotlin(path, src);
    const byDecl = new Map<string, Literal[]>();
    for (const l of lits) {
      if (!l.declBase) continue;
      const a = byDecl.get(l.declBase);
      if (a) a.push(l);
      else byDecl.set(l.declBase, [l]);
    }
    files.set(path, { path, src, byStart: new Map(lits.map((l) => [l.start, l])), byDecl });
  }
  return files;
}

function treeRegion(f: FileIndex | undefined): [number, number] | null {
  if (!f) return null;
  const a = f.src.indexOf(SECTION_START);
  const b = f.src.indexOf(SECTION_END);
  return a >= 0 && b > a ? [a, b] : null;
}

export function treeBaseFrom(files: Map<string, FileIndex>): TreeBase {
  const f = findFile(files, "gl/Meshes.kt");
  const species = [fileDefaults(0), fileDefaults(1), fileDefaults(2), fileDefaults(3)] as SpeciesParams;
  const available = new Set<ParamKey>();
  const ids: Partial<Record<ParamKey, string[]>> = {};
  let count = 4;
  if (f) {
    for (const s of PARAM_SPECS) {
      const lits = f.byDecl.get(s.kt);
      if (!lits || !lits.length) continue;
      available.add(s.key);
      ids[s.key] = lits.map((l) => l.id);
      count = Math.min(count, lits.length);
      lits.forEach((l, i) => {
        if (i < 4) species[i] = { ...species[i]!, [s.key]: l.value };
      });
    }
  }
  return {
    found: available.size > 0,
    species,
    count: available.size ? Math.max(1, count) : 4,
    available,
    ids,
    soilBottom: !!f && /val\s+bottom\s*=\s*TREE_GROUND\b/.test(f.src),
  };
}

/** The literal edits that write the tree editor's values into the TREE_* arrays of Meshes.kt. */
export function treeEdits(base: TreeBase, species: SpeciesParams, lits: Map<string, Literal>): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of PARAM_SPECS) {
    const ids = base.ids[s.key];
    if (!ids) continue;
    for (let i = 0; i < Math.min(base.count, ids.length); i++) {
      const lit = lits.get(ids[i]!);
      const v = s.int ? Math.round(species[i]![s.key]) : species[i]![s.key];
      if (lit && Math.abs(lit.value - v) > 1e-12) out.set(lit.id, v);
    }
  }
  return out;
}

export function rowFor(l: Literal, label: string, unit?: string): Row {
  const kind: Row["kind"] = l.kind === "hex" ? "color" : l.kind === "bool" ? "bool" : "num";
  return { key: l.id, label, unit, kind, ids: [l.id], range: autoRange(l), code: true };
}

export function buildModel(texts: Map<string, string>): Model {
  const files = scanFiles(texts);
  const lits = new Map<string, Literal>();
  for (const f of files.values()) for (const l of f.byStart.values()) lits.set(l.id, l);
  const meshes = findFile(files, "gl/Meshes.kt");
  const region = treeRegion(meshes);
  const inTree = (l: Literal) => !!region && meshes!.path === l.file && l.start >= region[0] && l.start < region[1];
  const tree = treeBaseFrom(files);

  // 1. Discover dynamic visual objects directly from the AST/sections of the repo.
  const bySection = new Map<string, { file: string; lits: Literal[] }>();
  for (const f of files.values()) {
    for (const l of f.byStart.values()) {
      if (!l.decl || l.inFunction || inTree(l)) continue;
      const base = l.decl.split(/[.[]/)[0]!;
      if (SKIP_DECL.test(base) || SKIP_SECTION.has(l.section)) continue;
      const key = `${f.path}::${l.section}`;
      const entry = bySection.get(key);
      if (entry) entry.lits.push(l);
      else bySection.set(key, { file: f.path, lits: [l] });
    }
  }

  const dynamicObjects: { id: ElementId; section: string; file: string; lits: Literal[] }[] = [];
  const dynamicLitIds = new Set<string>();
  for (const [key, { file, lits: secLits }] of bySection) {
    const section = key.split("::")[1]!;
    if (!isVisualCandidate(file, section, secLits)) continue;
    const id: ElementId = `obj:${section}`;
    dynamicObjects.push({ id, section, file, lits: secLits });
    for (const l of secLits) dynamicLitIds.add(l.id);
  }
  const isDynamic = dynamicObjects.length > 0;

  const groups = new Map<ElementId, Map<string, Group>>();
  const groupOf = (el: ElementId, id: string, label: string) => {
    let m = groups.get(el);
    if (!m) groups.set(el, (m = new Map()));
    let g = m.get(id);
    if (!g) m.set(id, (g = { id, label, rows: [] }));
    return g;
  };

  // Curated controls: kept for legacy repos (when no dynamic visual objects supersede them).
  const curated = new Map<string, string[]>();
  const used = new Set<string>();
  for (const c of CURATED) {
    const ids = resolveCurated(c, files);
    curated.set(c.key, ids);
    if (!ids.length) continue;
    if (isDynamic && (c.element === "gates" || c.element === "hole" || c.element === "orbs")) continue;
    const first = lits.get(ids[0]!)!;
    const range = c.min !== undefined ? { min: c.min, max: c.max ?? c.min + 1, step: c.step ?? 0.01, int: (c.step ?? 0.01) >= 1 } : autoRange(first);
    const g = groupOf(c.element, `cur:${c.group}`, c.group);
    // A colour may appear under several elements (e.g. the secret colour); keep it editable in each.
    g.rows.push({ key: `cur:${c.key}`, label: c.label, hint: c.hint, unit: c.unit, kind: c.kind ?? "num", ids, range, code: false });
    if (c.kind !== "color") ids.forEach((id) => used.add(id));
  }

  // Every named value (class- or file-level declaration).
  for (const f of files.values()) {
    for (const l of f.byStart.values()) {
      if (!l.decl || l.inFunction || used.has(l.id) || inTree(l) || dynamicLitIds.has(l.id)) continue;
      const base = l.decl.split(/[.[]/)[0]!;
      if (SKIP_DECL.test(base) || SKIP_SECTION.has(l.section)) continue;
      let el = classify(f.path, l.decl, l);
      if (!isDynamic) {
        if (/^(GATE_|SECRET_)/.test(base)) el = "gates";
        else if (/^(HOLE_|WARP_|LENS_)/.test(base)) el = "hole";
        else if (/^(POWERUP_|SHOCKWAVE_|ORB_)/.test(base)) el = "orbs";
      }
      const lab = LABELS[l.decl] ?? LABELS[l.declBase ?? ""];
      const label = lab
        ? l.decl !== l.declBase && LABELS[l.declBase ?? ""] && !LABELS[l.decl]
          ? `${lab[0]} (${l.decl.slice(l.declBase!.length)})`
          : lab[0]
        : humanizeIdent(l.decl);
      const gid = el === "colors" && fileName(f.path) === "Palette.kt" ? "named:palette" : `named:${f.path}:${l.section}`;
      const glabel = gid === "named:palette" ? "Játék paletta" : l.glsl ? `Shader állandók – ${l.section}` : `${fileName(f.path)} · ${l.section}`;
      groupOf(el, gid, glabel).rows.push(rowFor(l, label, lab?.[1]));
    }
  }

  // Code: every number of every file, file → section.
  const codeGroups: Group[] = [];
  for (const f of [...files.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const subs = new Map<string, Group>();
    for (const l of f.byStart.values()) {
      if (inTree(l)) continue;
      let g = subs.get(l.section);
      if (!g) subs.set(l.section, (g = { id: `code:${f.path}:${l.section}`, label: l.section, rows: [] }));
      g.rows.push(rowFor(l, l.decl ?? `${l.line}. sor`));
    }
    if (!subs.size) continue;
    const sub = [...subs.values()];
    codeGroups.push({ id: `code:${f.path}`, label: `${fileName(f.path)} (${sub.reduce((a, g) => a + g.rows.length, 0)} szám)`, rows: [], sub });
  }

  // Build dynamic visual object elements (placed right after Trees if trees exist, or first otherwise).
  const dynamicElements: ElementDef[] = dynamicObjects.map((obj) => {
    const name = humanizeObject(obj.section);
    const rows: Row[] = obj.lits.map((l) => {
      const label = humanizeIdent(l.decl ?? "");
      return rowFor(l, label);
    });
    return {
      id: obj.id,
      label: name,
      short: name,
      scene: "dynamic",
      section: obj.section,
      file: obj.file,
      groups: [{ id: `dyn:${obj.section}`, label: `${fileName(obj.file)} · ${obj.section}`, rows }],
    };
  });

  const baseElements: ElementDef[] = [];
  for (const e of ELEMENTS) {
    if (e.id === "trees") {
      const m = groups.get(e.id);
      const list = m ? [...m.values()] : [];
      if (tree.found || list.length > 0) baseElements.push({ ...e, groups: list });
      // Insert dynamically discovered visual elements right after Trees.
      baseElements.push(...dynamicElements);
      continue;
    }
    if (isDynamic && (e.id === "gates" || e.id === "hole" || e.id === "orbs")) continue;
    if (e.id === "code") {
      baseElements.push({ ...e, groups: codeGroups });
      continue;
    }
    const m = groups.get(e.id);
    const list = m ? [...m.values()] : [];
    list.sort((a, b) => Number(b.id.startsWith("cur:")) - Number(a.id.startsWith("cur:")));
    if (list.length > 0 || !isDynamic) baseElements.push({ ...e, groups: list });
  }
  const elements = baseElements;

  let named = 0;
  for (const e of elements) if (e.id !== "code") for (const g of e.groups) named += g.rows.length;
  return {
    files,
    kt: new Map([...texts].filter(([p]) => p.endsWith(".kt"))),
    lits,
    elements,
    curated,
    tree,
    stats: { files: files.size, numbers: lits.size, named },
    dynamic: isDynamic,
  };
}

export function valueOf(model: Model, edits: Record<string, number>, id: string): number {
  return edits[id] ?? model.lits.get(id)?.value ?? 0;
}

/** Current value of a curated control (first literal), or `fallback` when this repo lacks it. */
export function curatedValue(model: Model, edits: Record<string, number>, key: string, fallback: number): number {
  const ids = model.curated.get(key);
  return ids && ids.length ? valueOf(model, edits, ids[0]!) : fallback;
}

export function rowChanged(model: Model, edits: Record<string, number>, row: Row): boolean {
  return row.ids.some((id) => id in edits && Math.abs(edits[id]! - (model.lits.get(id)?.value ?? 0)) > 1e-12);
}

export function countChanged(model: Model, edits: Record<string, number>, g: Group): number {
  return g.rows.filter((r) => rowChanged(model, edits, r)).length + (g.sub ?? []).reduce((a, s) => a + countChanged(model, edits, s), 0);
}

export function treeChangedCount(base: TreeBase, species: SpeciesParams): number {
  let n = 0;
  for (let i = 0; i < base.count; i++) for (const s of PARAM_SPECS) if (Math.abs(base.species[i]![s.key] - species[i]![s.key]) > 1e-9) n++;
  return n;
}

/** How a literal is referred to in the code: its declaration ("Palette.fog", "GATE_HALF") or, for an inline number, the call and argument it sits in ("prim(#8)"). */
export function codeNameOf(model: Model, lit: Literal): string {
  const f = model.files.get(lit.file);
  if (lit.decl) {
    if (!f) return lit.decl;
    if (lit.section.includes(".")) {
      // Nested object/class path (e.g. Visuals.GateRing) vs function section
      const leaf = lit.section.split(".").pop()!;
      const m = new RegExp(`\\b(?:object|class)\\s+${leaf}\\b`).exec(f.src);
      return m && m.index < lit.start ? `${lit.section}.${lit.decl}` : lit.decl;
    }
    // Members of an object/class are written with its name; top-level values (section = file name) without.
    const m = new RegExp(`\\b(?:object|class)\\s+${lit.section}\\b`).exec(f.src);
    return m && m.index < lit.start ? `${lit.section}.${lit.decl}` : lit.decl;
  }
  const frames = f ? callContext(f.src, lit.start) : [];
  const assign = f ? assignedName(f.src, lit) : undefined;
  if (!frames.length) return assign ? `${assign} = …` : lit.section;
  return `${assign ? `${assign} = ` : ""}${frameText(frames)}`;
}

/** `bob` for a number inside `val bob = …` (same statement, at most a few lines up). */
function assignedName(src: string, lit: Literal): string | undefined {
  let from = lit.start;
  for (let k = 0; k <= lit.line - lit.stmtLine && from > 0; k++) from = src.lastIndexOf("\n", from - 1);
  const m = /\b(?:val|var)\s+([A-Za-z_]\w*)(?:\s*:\s*[\w<>?, ]+)?\s*=(?!=)/.exec(src.slice(Math.max(0, from), lit.start));
  return m?.[1];
}

const argText = (fr: CallFrame) => (fr.name ? `${fr.name} = …` : `#${fr.arg}`);
function frameText(frames: CallFrame[], lastArg?: CallFrame) {
  return [...frames]
    .reverse()
    .map((fr, i, a) => `${fr.fn}(${i === a.length - 1 && lastArg && !fr.name ? `#${fr.arg}–${lastArg.arg}` : argText(fr)})`)
    .join(" › ");
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóöőúüű]/g, "");

/**
 * The code name shown under a row's Hungarian label, or nothing when the label already is the code name.
 * `where` is "File.kt:line" of the (first) number.
 */
export function codeRef(model: Model, row: Row): { name: string; where: string; title: string } | undefined {
  const lit = model.lits.get(row.ids[0]!);
  if (!lit) return undefined;
  let name = codeNameOf(model, lit);
  if (row.ids.length > 1) {
    const last = model.lits.get(row.ids[row.ids.length - 1]!);
    const f = model.files.get(lit.file);
    const a = !lit.decl && f ? callContext(f.src, lit.start) : [];
    const b = last && !last.decl && last.file === lit.file && f ? callContext(f.src, last.start) : [];
    const sameCall = a.length && b.length && a[0]!.fn === b[0]!.fn && last!.line === lit.line;
    if (sameCall) name = frameText(a, b[0]);
    else if (row.kind === "num") name += ` +${row.ids.length - 1}`;
  }
  if (norm(name) === norm(row.label) || norm(lit.decl ?? "") === norm(row.label)) return undefined;
  const where = `${lit.file.split("/").pop()}:${lit.line}`;
  const title = lit.decl ? `${name} – ${lit.section}, ${where}` : `${lit.section}: ${name} (#n = az n. paraméter), ${where}`;
  return { name, where, title };
}

/** A readable name for every literal: the Hungarian row label where there is one, the tree parameter for TREE_* values. */
export function labelIndex(model: Model): Map<string, string> {
  const out = new Map<string, string>();
  for (const el of model.elements) {
    const walk = (gs: Group[]) => {
      for (const g of gs) {
        for (const r of g.rows) for (const id of r.ids) if (!out.has(id)) out.set(id, r.label);
        if (g.sub) walk(g.sub);
      }
    };
    if (el.id !== "code") walk(el.groups);
  }
  const code = model.elements.find((e) => e.id === "code");
  if (code) {
    const walk = (gs: Group[]) => gs.forEach((g) => (g.rows.forEach((r) => r.ids.forEach((id) => !out.has(id) && out.set(id, r.label))), g.sub && walk(g.sub)));
    walk(code.groups);
  }
  for (const s of PARAM_SPECS) model.tree.ids[s.key]?.forEach((id, i) => out.set(id, `${s.label} – ${SPECIES[i]?.label ?? i + 1}`));
  return out;
}

export type { TreeParams };
