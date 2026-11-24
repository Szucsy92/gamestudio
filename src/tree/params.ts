/**
 * Every tunable value of the tree body. Each parameter maps 1:1 to a per-species Kotlin array
 * (`kt`) in the generated Meshes.kt; the order of `def` is the species order of the game:
 * 0 = tölgy (oak), 1 = fenyő (pine), 2 = ősi fa (ancient), 3 = nyír (birch).
 * The `def` values reproduce Meshes_Reference_Tree.kt exactly.
 */
export type GroupId = "join" | "trunk" | "roots" | "base" | "limbs" | "forks" | "bark" | "quality";

export interface ParamSpec {
  key: ParamKey;
  kt: string;
  label: string;
  hint?: string;
  group: GroupId;
  min: number;
  max: number;
  step: number;
  int?: boolean;
  /** On/off switch (0 = off, 1 = on) instead of a slider. */
  toggle?: boolean;
  unit?: string;
  def: readonly [number, number, number, number];
}

export const PARAM_KEYS = [
  "height", "heightRand", "trunkScale", "trunkRadius", "trunkTaper", "footHeight", "footFlare", "lean", "sway",
  "rootCount", "rootLength", "rootLenMin", "rootLenRand", "rootStubChance", "rootStubScale", "rootHMin", "rootHRand",
  "rootSteepMin", "rootSteepRand", "rootWidth", "rootAngle", "rootSpread", "rootDepth",
  "cutDepth", "bottomCap",
  "limbCount", "limbsPerLevel", "limbStart", "limbSpacing", "limbJitter", "levelJitter", "limbLength", "limbLenBase",
  "limbLenSlope", "limbLenRand", "limbThick", "limbRiseMin", "limbRiseRange", "limbBend", "limbCurl", "limbHole", "limbRings",
  "forkCount", "forkStart", "forkSpread", "forkLength", "forkThick", "forkAngle", "forkRise",
  "fluting", "swell", "burl",
  "radialMult", "flareTop",
] as const;
export type ParamKey = (typeof PARAM_KEYS)[number];
export type TreeParams = Record<ParamKey, number>;

const all = (v: number) => [v, v, v, v] as const;

export const PARAM_SPECS: readonly ParamSpec[] = [
  // ---- Magasság és törzs
  { key: "height", kt: "TREE_HEIGHT", label: "Magasság", hint: "A törzs tetejének legkisebb magassága", group: "trunk", min: 6, max: 40, step: 0.1, unit: "m", def: all(20.5) },
  { key: "heightRand", kt: "TREE_HEIGHT_RAND", label: "Magasság szórása", group: "trunk", min: 0, max: 8, step: 0.1, unit: "m", def: all(3.0) },
  { key: "trunkScale", kt: "TREE_TRUNK_SCALE", label: "Törzs vastagsága", group: "trunk", min: 0.3, max: 4, step: 0.01, unit: "×", def: [1.45, 0.85, 2.15, 0.75] },
  { key: "trunkRadius", kt: "TREE_TRUNK_RADIUS", label: "Csúcs sugara", hint: "A törzs sugara a fa tetején (szorzó előtt)", group: "trunk", min: 0.08, max: 0.8, step: 0.005, unit: "m", def: all(0.27) },
  { key: "trunkTaper", kt: "TREE_TRUNK_TAPER", label: "Elvékonyodás felfelé", group: "trunk", min: 0, max: 0.6, step: 0.005, unit: "m", def: all(0.13) },
  { key: "footHeight", kt: "TREE_FOOT_H", label: "Tő kiszélesedés magassága", group: "trunk", min: 0.3, max: 6, step: 0.05, unit: "m", def: [1.7, 1.7, 2.4, 1.7] },
  { key: "footFlare", kt: "TREE_FOOT_FLARE", label: "Tő kiszélesedés mértéke", group: "trunk", min: 0, max: 2, step: 0.01, unit: "×", def: [0.38, 0.38, 0.48, 0.38] },
  { key: "lean", kt: "TREE_LEAN", label: "Dőlés", group: "trunk", min: 0, max: 0.15, step: 0.001, unit: "rad", def: [0.008, 0.014, 0.03, 0.01] },
  { key: "sway", kt: "TREE_SWAY_AMT", label: "Középvonal hullámzása", group: "trunk", min: 0, max: 4, step: 0.05, unit: "×", def: all(1) },
  // ---- Gyökércsatlakozás
  { key: "rootCount", kt: "TREE_RIDGES", label: "Gyökerek száma", hint: "Hány gyökér indul a törzsből", group: "join", min: 2, max: 14, step: 1, int: true, unit: "db", def: [7, 5, 8, 4] },
  { key: "rootWidth", kt: "TREE_ROOT_SIGMA", label: "Gyökerek vastagsága", hint: "A gyökér keresztmetszete: kisebb = vékonyabb, élesebb gerinc", group: "join", min: 0.1, max: 1.5, step: 0.01, def: [0.42, 0.42, 0.46, 0.42] },
  { key: "rootHMin", kt: "TREE_ROOT_H", label: "Csatlakozás magassága", hint: "Milyen magasan fut bele a gyökér a törzsbe", group: "join", min: 0.05, max: 8, step: 0.05, unit: "m", def: [1.5, 0.6, 2.5, 0.35] },
  { key: "rootAngle", kt: "TREE_ROOT_ANGLE", label: "Csatlakozási szög", hint: "A gyökér gerince legfeljebb ekkora szögben fut be a törzs függőlegesébe. Kisebb = lankásabb, simább átmenet; 90° = nincs korlátozás", group: "join", min: 5, max: 90, step: 1, unit: "°", def: all(90) },
  // ---- Gyökerek
  { key: "rootLength", kt: "TREE_ROOT_LEN", label: "Gyökerek hossza", group: "roots", min: 0.1, max: 5, step: 0.01, unit: "×", def: [1.65, 0.9, 2.45, 0.85] },
  { key: "rootLenMin", kt: "TREE_ROOT_LEN_MIN", label: "Legrövidebb gyökér", hint: "A hossz alsó határa (szorzó)", group: "roots", min: 0, max: 2, step: 0.01, def: all(0.65) },
  { key: "rootLenRand", kt: "TREE_ROOT_LEN_RAND", label: "Hossz szórása", group: "roots", min: 0, max: 2, step: 0.01, def: all(0.9) },
  { key: "rootStubChance", kt: "TREE_ROOT_STUB", label: "Csonka gyökerek esélye", group: "roots", min: 0, max: 1, step: 0.01, def: all(0.1) },
  { key: "rootStubScale", kt: "TREE_ROOT_STUB_SCALE", label: "Csonka gyökér hossza", group: "roots", min: 0, max: 1, step: 0.01, unit: "×", def: all(0.4) },
  { key: "rootHRand", kt: "TREE_ROOT_H_RAND", label: "Csatlakozási magasság szórása", group: "roots", min: 0, max: 4, step: 0.05, unit: "m", def: [0.6, 0.4, 0.9, 0.35] },
  { key: "rootSteepMin", kt: "TREE_ROOT_STEEP", label: "Csúcsosság", hint: "A borda profiljának íve: nagyobb = homorúbb, csúcsosabb", group: "roots", min: 0.2, max: 6, step: 0.05, def: [1.2, 1.2, 1.8, 1.2] },
  { key: "rootSteepRand", kt: "TREE_ROOT_STEEP_RAND", label: "Csúcsosság szórása", group: "roots", min: 0, max: 3, step: 0.05, def: [0.5, 0.5, 0.4, 0.5] },
  { key: "rootSpread", kt: "TREE_ROOT_SPREAD", label: "Elhelyezés szabálytalansága", group: "roots", min: 0, max: 1.5, step: 0.01, def: all(0.7) },
  { key: "rootDepth", kt: "TREE_ROOT_DEPTH", label: "Talaj alatti kiszélesedés", group: "roots", min: 0, max: 1, step: 0.01, def: all(0.12) },
  // ---- Talaj alatti rész (alsó vágás és lezárás)
  { key: "cutDepth", kt: "TREE_CUT_DEPTH", label: "Vágás mélysége a talaj alatt", hint: "Ilyen mélyen van vízszintesen elvágva a törzs és a gyökerek a talajszint alatt. 0 = pont a talajszinten", group: "base", min: 0, max: 3, step: 0.05, unit: "m", def: all(0.6) },
  { key: "bottomCap", kt: "TREE_BOTTOM_CAP", label: "Zárt alj", hint: "Bekapcsolva egy lap zárja le a vágást, alulról nem lehet belelátni a fába", group: "base", min: 0, max: 1, step: 1, int: true, toggle: true, def: all(0) },
  // ---- Ágak
  { key: "limbCount", kt: "TREE_LIMB_COUNT", label: "Ágak száma", group: "limbs", min: 0, max: 24, step: 1, int: true, unit: "db", def: [9, 9, 11, 6] },
  { key: "limbsPerLevel", kt: "TREE_LIMBS_PER_LEVEL", label: "Ágak szintenként", group: "limbs", min: 1, max: 4, step: 1, int: true, unit: "db", def: [2, 3, 3, 2] },
  { key: "limbStart", kt: "TREE_LIMB_START", label: "Első ág magassága", group: "limbs", min: 1, max: 35, step: 0.1, unit: "m", def: [7.2, 5.0, 6.8, 10.0] },
  { key: "limbSpacing", kt: "TREE_LIMB_SPACING", label: "Ágak távolsága", group: "limbs", min: 0, max: 5, step: 0.01, unit: "m", def: [1.42, 1.4, 1.32, 1.55] },
  { key: "limbJitter", kt: "TREE_LIMB_JITTER", label: "Ágmagasság szórása", group: "limbs", min: 0, max: 3, step: 0.01, unit: "m", def: [0.45, 0.42, 0.5, 0.45] },
  { key: "levelJitter", kt: "TREE_LEVEL_JITTER", label: "Szintek szórása", group: "limbs", min: 0, max: 5, step: 0.05, unit: "m", def: all(1.4) },
  { key: "limbLength", kt: "TREE_LIMB_LEN", label: "Ágak hossza", group: "limbs", min: 0.1, max: 4, step: 0.01, unit: "×", def: [1.2, 0.95, 1.45, 0.95] },
  { key: "limbLenBase", kt: "TREE_LIMB_LEN_BASE", label: "Alap ághossz", group: "limbs", min: 0, max: 10, step: 0.05, unit: "m", def: [3.0, 4.1, 3.1, 2.0] },
  { key: "limbLenSlope", kt: "TREE_LIMB_LEN_SLOPE", label: "Hossz változása felfelé", hint: "Ágonként; negatív = felfelé rövidül (fenyőforma)", group: "limbs", min: -1, max: 1, step: 0.01, unit: "m", def: [0, -0.26, 0, 0] },
  { key: "limbLenRand", kt: "TREE_LIMB_LEN_RAND", label: "Ághossz szórása", group: "limbs", min: 0, max: 4, step: 0.05, unit: "m", def: [1.25, 0, 1.15, 0.9] },
  { key: "limbThick", kt: "TREE_LIMB_THICK", label: "Ágak vastagsága", group: "limbs", min: 0.1, max: 4, step: 0.01, unit: "×", def: [1.4, 0.85, 1.95, 0.75] },
  { key: "limbRiseMin", kt: "TREE_LIMB_RISE", label: "Emelkedés (legkisebb)", hint: "Negatív = lehajló ág", group: "limbs", min: -4, max: 4, step: 0.05, unit: "m", def: all(-0.6) },
  { key: "limbRiseRange", kt: "TREE_LIMB_RISE_RAND", label: "Emelkedés szórása", group: "limbs", min: 0, max: 6, step: 0.05, unit: "m", def: all(2.4) },
  { key: "limbBend", kt: "TREE_LIMB_BEND", label: "Oldalirányú hajlás", group: "limbs", min: 0, max: 5, step: 0.05, def: all(1.8) },
  { key: "limbCurl", kt: "TREE_LIMB_CURL", label: "Kanyargás", group: "limbs", min: 0, max: 4, step: 0.05, def: all(1.1) },
  { key: "limbHole", kt: "TREE_LIMB_HOLE", label: "Ágtő magassága", hint: "Az ágcsatlakozás fél magassága a törzsön", group: "limbs", min: 0.1, max: 1, step: 0.01, unit: "m", def: all(0.3) },
  { key: "limbRings", kt: "TREE_LIMB_RINGS", label: "Ág gyűrűi (simaság)", group: "limbs", min: 1, max: 6, step: 1, int: true, unit: "db", def: all(2) },
  // ---- Mellékágak
  { key: "forkCount", kt: "TREE_FORK_COUNT", label: "Mellékágak ágonként", group: "forks", min: 0, max: 4, step: 1, int: true, unit: "db", def: all(0) },
  { key: "forkStart", kt: "TREE_FORK_START", label: "Elágazás helye", hint: "Az ág hosszának hányadánál", group: "forks", min: 0.1, max: 0.95, step: 0.01, def: all(0.5) },
  { key: "forkSpread", kt: "TREE_FORK_SPREAD", label: "Elágazások szórása", group: "forks", min: 0, max: 0.8, step: 0.01, def: all(0.35) },
  { key: "forkLength", kt: "TREE_FORK_LEN", label: "Mellékág hossza", group: "forks", min: 0.1, max: 1.2, step: 0.01, unit: "×", def: all(0.45) },
  { key: "forkThick", kt: "TREE_FORK_THICK", label: "Mellékág vastagsága", group: "forks", min: 0.2, max: 1, step: 0.01, unit: "×", def: all(0.6) },
  { key: "forkAngle", kt: "TREE_FORK_ANGLE", label: "Elágazási szög", group: "forks", min: 0, max: 3, step: 0.05, def: all(0.9) },
  { key: "forkRise", kt: "TREE_FORK_RISE", label: "Mellékág emelkedése", group: "forks", min: -1.5, max: 2, step: 0.05, def: all(0.5) },
  // ---- Kéreg és forma
  { key: "fluting", kt: "TREE_FLUTE", label: "Hosszanti barázdák", group: "bark", min: 0, max: 0.4, step: 0.005, unit: "m", def: [0.04, 0.04, 0.1, 0.04] },
  { key: "swell", kt: "TREE_SWELL", label: "Kéreg duzzanata", group: "bark", min: 0, max: 4, step: 0.05, unit: "×", def: all(1) },
  { key: "burl", kt: "TREE_BURL", label: "Göcs mérete", group: "bark", min: 0, max: 5, step: 0.05, unit: "×", def: all(1) },
  // ---- Felbontás
  { key: "radialMult", kt: "TREE_RADIAL", label: "Körbeosztás (gyökerenként)", hint: "Oldalak száma = max(12, ez × gyökerek)", group: "quality", min: 2, max: 6, step: 1, int: true, def: all(3) },
  { key: "flareTop", kt: "TREE_FLARE_TOP", label: "Sűrű gyűrűk magassága", hint: "Eddig a magasságig sűrű a rács a tőnél", group: "quality", min: 2, max: 12, step: 0.1, unit: "m", def: all(5.0) },
];

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: "join", label: "Gyökércsatlakozás" },
  { id: "trunk", label: "Magasság és törzs" },
  { id: "roots", label: "Gyökerek" },
  { id: "base", label: "Talaj alatti rész" },
  { id: "limbs", label: "Ágak" },
  { id: "forks", label: "Mellékágak" },
  { id: "bark", label: "Kéreg és forma" },
  { id: "quality", label: "Felbontás" },
];

export const SPECIES = [
  { id: 0, label: "Tölgy", kt: "oak" },
  { id: 1, label: "Fenyő", kt: "pine" },
  { id: 2, label: "Ősi fa", kt: "ancient" },
  { id: 3, label: "Nyír", kt: "birch" },
] as const;

export type SpeciesParams = [TreeParams, TreeParams, TreeParams, TreeParams];

/** Values of Meshes_Reference_Tree.kt for one species. */
export function fileDefaults(sp: number): TreeParams {
  const out = {} as TreeParams;
  for (const s of PARAM_SPECS) out[s.key] = s.def[sp] ?? s.def[0];
  return out;
}

/**
 * Tuned to the reference forest picture: tall, straight, thick columns that stay bare for a long way,
 * a high concave buttress flare whose ridges run out into long, tapering surface roots, few heavy limbs
 * high up with a couple of forks each, and shallow bark fluting.
 */
export function referencePreset(sp: number): TreeParams {
  return {
    ...fileDefaults(sp),
    height: 24,
    heightRand: 2,
    trunkScale: 2.1,
    trunkRadius: 0.28,
    trunkTaper: 0.12,
    footHeight: 3.0,
    footFlare: 0.55,
    lean: 0.012,
    sway: 0.45,
    rootCount: 7,
    rootLength: 1.9,
    rootLenMin: 0.7,
    rootLenRand: 0.8,
    rootStubChance: 0.18,
    rootStubScale: 0.45,
    rootHMin: 2.4,
    rootHRand: 1.0,
    rootSteepMin: 1.7,
    rootSteepRand: 0.5,
    rootWidth: 0.62,
    rootAngle: 30,
    rootSpread: 0.75,
    rootDepth: 0.2,
    cutDepth: 0.6,
    bottomCap: 1,
    limbCount: 7,
    limbsPerLevel: 2,
    limbStart: 12,
    limbSpacing: 1.5,
    limbJitter: 0.5,
    levelJitter: 1.0,
    limbLength: 1.35,
    limbLenBase: 3.4,
    limbLenSlope: -0.08,
    limbLenRand: 1.0,
    limbThick: 1.9,
    limbRiseMin: 0.4,
    limbRiseRange: 2.2,
    limbBend: 1.2,
    limbCurl: 0.8,
    limbHole: 0.45,
    limbRings: 5,
    forkCount: 2,
    forkStart: 0.5,
    forkSpread: 0.35,
    forkLength: 0.6,
    forkThick: 0.8,
    forkAngle: 0.7,
    forkRise: 0.35,
    fluting: 0.05,
    swell: 0.9,
    burl: 0.8,
    radialMult: 4,
    flareTop: 6,
  };
}

export function initialSpecies(): SpeciesParams {
  return [fileDefaults(0), fileDefaults(1), referencePreset(2), fileDefaults(3)];
}

export function clampParams(p: Partial<Record<string, unknown>>, base: TreeParams): TreeParams {
  const out = { ...base };
  for (const s of PARAM_SPECS) {
    const v = p[s.key];
    if (typeof v === "number" && Number.isFinite(v)) {
      const c = Math.min(s.max, Math.max(s.min, v));
      out[s.key] = s.int ? Math.round(c) : c;
    }
  }
  return out;
}

/**
 * Proportional root length: when the roots get longer (or shorter) the joint into the trunk follows, so the transition
 * keeps its shape. Connection height, its spread and the foot flare height scale with the length ratio; the root
 * thickness with its square root (otherwise long roots turn into blobs). Results stay inside the slider ranges.
 */
export function scaleRootJoint(p: TreeParams, newLength: number): TreeParams {
  const spec = (k: ParamKey) => PARAM_SPECS.find((s) => s.key === k)!;
  const clamp = (k: ParamKey, v: number) => {
    const s = spec(k);
    const dec = String(s.step).includes(".") ? String(s.step).split(".")[1]!.length + 1 : 0;
    return Number(Math.min(s.max, Math.max(s.min, v)).toFixed(dec));
  };
  const len = clamp("rootLength", newLength);
  const ratio = p.rootLength > 0 ? len / p.rootLength : 1;
  return {
    ...p,
    rootLength: len,
    rootHMin: clamp("rootHMin", p.rootHMin * ratio),
    rootHRand: clamp("rootHRand", p.rootHRand * ratio),
    footHeight: clamp("footHeight", p.footHeight * ratio),
    rootWidth: clamp("rootWidth", p.rootWidth * Math.sqrt(ratio)),
  };
}
