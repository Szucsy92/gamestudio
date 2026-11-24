/**
 * What the game objects are made of, for deleting them: each element (gates, black hole, power-ups) has objects
 * (stone gate, monolith …), each object has parts (posts, lintel, veil …). A part or object is a list of roots in
 * the code; the deletion engine follows everything that hangs on them. Roots are code patterns (`#` = any number,
 * as in curated.ts) or declaration names, so they survive value changes.
 */
import type { ElementId } from "./curated";

export type RootDef =
  /** A declaration: a class, function, value or enum entry (with `owner`). */
  | { decl: string; owner?: string }
  /** The statement that starts where the pattern matches (`after`: search from this text on). */
  | { file: string; stmt: string; after?: string; nth?: number }
  /** A `when` branch whose body is emptied (the branch itself stays). */
  | { file: string; branch: string; after?: string };

export interface PartDef {
  key: string;
  label: string;
  roots: RootDef[];
  /** 3D preview pieces this part hides. */
  preview: string[];
}

export interface ObjectDef {
  key: string;
  element: ElementId;
  label: string;
  /** Curated row groups (curated.ts) that belong to this object. */
  groups: string[];
  roots: RootDef[];
  parts: PartDef[];
  /** Loops over the object's instances: animations inside them belong to it. */
  scopes: string[];
  /** `when` branch selecting this object inside a shared loop. */
  branchOf?: string;
  preview: string[];
}

export interface ElementDefR {
  element: ElementId;
  label: string;
  roots: RootDef[];
  preview: string[];
}

const GR = "gl/GameRenderer.kt";

export const ELEMENT_REMOVALS: ElementDefR[] = [
  { element: "gates", label: "Minden kapu és titkos hely", roots: [{ decl: "Gate" }, { decl: "Secret" }, { decl: "SecretType" }], preview: ["gate", "mono", "ring", "lant"] },
  { element: "hole", label: "Fekete lyukak és féreglyuk", roots: [{ decl: "BlackHole" }], preview: ["hole"] },
  { element: "orbs", label: "Minden power-up", roots: [{ decl: "PowerUp" }], preview: ["orb"] },
];

export const OBJECTS: ObjectDef[] = [
  {
    key: "gate",
    element: "gates",
    label: "Kőkapu",
    groups: ["Kőkapu", "Kapu energiahártyája"],
    roots: [{ decl: "Gate" }],
    scopes: ["e.gates"],
    preview: ["gate"],
    parts: [
      { key: "gate.posts", label: "Oszlopok", roots: [{ file: GR, stmt: "for (side in intArrayOf(-1, 1)) prim(box, parent, side * (GATE_HALF + #)" }], preview: ["gate.posts"] },
      { key: "gate.lintel", label: "Gerenda", roots: [{ file: GR, stmt: "prim(box, parent, #, #, #, #, #, #, GATE_HALF * # + #, #, #)" }], preview: ["gate.lintel"] },
      { key: "gate.veil", label: "Energiahártya", roots: [{ file: GR, stmt: "additiveVeil(Palette.pursuer," }], preview: ["gate.veil"] },
      { key: "gate.glow", label: "Fényudvar", roots: [{ file: GR, stmt: "for (g in e.gates) bGlow.add(" }], preview: ["gate.glow"] },
    ],
  },
  {
    key: "mono",
    element: "gates",
    label: "Monolit",
    groups: ["Monolit (álló kőoszlop)"],
    roots: [{ decl: "MONOLITH", owner: "SecretType" }],
    scopes: ["e.secrets"],
    branchOf: "SecretType.MONOLITH",
    preview: ["mono"],
    parts: [
      { key: "mono.block", label: "Kőtömb", roots: [{ file: GR, after: "SecretType.MONOLITH -> {", stmt: "prim(box, parent, #, #, #, #, #, #, #, #, #)" }], preview: ["mono.block"] },
      { key: "mono.strip", label: "Fénycsík", roots: [{ file: GR, after: "SecretType.MONOLITH -> {", stmt: "prim(box, parent, #, #, #, #, #, #, #, #, #)", nth: 2 }], preview: ["mono.strip"] },
      { key: "mono.glow", label: "Fényköd", roots: [{ file: GR, branch: "SecretType.MONOLITH -> bGlowFog.add(" }], preview: ["mono.glow"] },
    ],
  },
  {
    key: "ring",
    element: "gates",
    label: "Fénygyűrű",
    groups: ["Fénygyűrű"],
    roots: [{ decl: "RING", owner: "SecretType" }],
    scopes: ["e.secrets"],
    branchOf: "SecretType.RING",
    preview: ["ring"],
    parts: [
      { key: "ring.orbs", label: "Fénygömbök", roots: [{ file: GR, after: "SecretType.RING -> {", stmt: "for (m in 0 until #) {" }], preview: ["ring.orbs"] },
      { key: "ring.glow", label: "Fényköd", roots: [{ file: GR, branch: "SecretType.RING -> for (m in 0 until #) {" }], preview: ["ring.glow"] },
    ],
  },
  {
    key: "lant",
    element: "gates",
    label: "Lámpás",
    groups: ["Lámpás"],
    roots: [{ decl: "LANTERN", owner: "SecretType" }],
    scopes: ["e.secrets"],
    branchOf: "SecretType.LANTERN",
    preview: ["lant"],
    parts: [
      { key: "lant.post", label: "Oszlop", roots: [{ file: GR, after: "SecretType.LANTERN -> {", stmt: "prim(cyl, parent, #, #, #, #, #, #, #, #, #)" }], preview: ["lant.post"] },
      { key: "lant.lamp", label: "Lámpa", roots: [{ file: GR, after: "SecretType.LANTERN -> {", stmt: "prim(box, parent, #, #, #, #, #, #, #, #, #)" }], preview: ["lant.lamp"] },
      { key: "lant.glow", label: "Fényköd", roots: [{ file: GR, branch: "SecretType.LANTERN -> bGlowFog.add(" }], preview: ["lant.glow"] },
    ],
  },
  {
    key: "hole",
    element: "hole",
    label: "Fekete lyuk",
    groups: ["Test", "Fénygyűrűk (akkréciós fátyol)"],
    roots: [{ decl: "BlackHole" }],
    scopes: ["holesAround("],
    preview: ["hole"],
    parts: [
      { key: "hole.body", label: "Fekete test", roots: [{ file: GR, stmt: "uploadOne(holeBody, parent)" }], preview: ["hole.body"] },
      { key: "hole.veil", label: "Akkréciós fátyol (gyűrűk)", roots: [{ file: GR, stmt: "val rings = arrayOf(Triple(" }], preview: ["hole.veil"] },
      { key: "hole.halo", label: "Lila fényudvar", roots: [{ file: GR, stmt: "bHole.add(h.x, hy, h.z, #, #, Palette.purple, #)" }], preview: ["hole.halo"] },
      { key: "hole.sparks", label: "Keringő szikrák", roots: [{ file: GR, after: "bHole.add(h.x, hy, h.z,", stmt: "for (k in 0 until #) {" }], preview: ["hole.sparks"] },
      { key: "hole.lens", label: "Lencsehatás a képen", roots: [{ decl: "holeScreen" }], preview: [] },
      { key: "hole.warp", label: "Elnyelés és féreglyuk-utazás", roots: [{ decl: "enterHole" }], preview: [] },
    ],
  },
  {
    key: "orb",
    element: "orbs",
    label: "Power-up gömb",
    groups: ["Üveggömb", "Plazmasávok a gömbben", "Sávgyűrűk alakja"],
    roots: [{ decl: "PowerUp" }],
    scopes: ["e.orbs"],
    preview: ["orb"],
    parts: [
      { key: "orb.shell", label: "Üveggömb", roots: [{ file: GR, stmt: "uploadOne(orb, parent)" }], preview: ["orb.shell"] },
      { key: "orb.band1", label: "1. plazmasáv", roots: [{ file: GR, stmt: "prim(torusA, parent," }], preview: ["orb.band1"] },
      { key: "orb.band2", label: "2. plazmasáv", roots: [{ file: GR, stmt: "prim(torusB, parent, #, #, #, #, -t" }], preview: ["orb.band2"] },
      { key: "orb.band3", label: "3. plazmasáv", roots: [{ file: GR, stmt: "prim(torusC, parent," }], preview: ["orb.band3"] },
      { key: "orb.band4", label: "Finom szálak", roots: [{ file: GR, stmt: "prim(torusB, parent, #, #, #, #, t * # + i * #" }], preview: ["orb.band4"] },
      { key: "orb.aura", label: "Fényudvar", roots: [{ file: GR, after: "// Orb auras.", stmt: "bGlowFog.add(px, py, pz, size, size, col," }], preview: ["orb.aura"] },
    ],
  },
  { key: "orb.freezer", element: "orbs", label: "Fagyasztó power-up", groups: [], roots: [{ decl: "FREEZER", owner: "PowerUpType" }], scopes: [], preview: ["orb.freezer"], parts: [] },
  { key: "orb.ghost", element: "orbs", label: "Szellem power-up", groups: [], roots: [{ decl: "GHOST", owner: "PowerUpType" }], scopes: [], preview: ["orb.ghost"], parts: [] },
  { key: "orb.shock", element: "orbs", label: "Lökéshullám power-up", groups: [], roots: [{ decl: "SHOCKWAVE", owner: "PowerUpType" }], scopes: [], preview: ["orb.shock"], parts: [] },
];
