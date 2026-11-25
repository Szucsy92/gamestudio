/**
 * Hand-picked controls with Hungarian names for the game objects that get a 3D preview (gates, standing stones,
 * black hole, power-up orbs). Each one points at numbers already found by scan.ts, either by declaration name or by a
 * code pattern where `#` stands for any number, so it keeps working when the values in the repo change.
 */
import type { Literal } from "./scan";

export type BuiltinElementId = "trees" | "gates" | "hole" | "orbs" | "colors" | "lights" | "graphics" | "gameplay" | "sound" | "other" | "code";
/** Built-in categories plus dynamically discovered visual objects ("obj:<section>"). */
export type ElementId = BuiltinElementId | (string & {});

export type CuratedSrc =
  | { file: string; decl: string }
  | { file: string; find: string; pick: number[]; after?: string; nth?: number; all?: boolean };

export interface CuratedDef {
  key: string;
  element: ElementId;
  group: string;
  label: string;
  hint?: string;
  unit?: string;
  /** "color" = one 0xRRGGBB literal, "color3" = three linear 0…1 floats. */
  kind?: "num" | "color" | "color3";
  min?: number;
  max?: number;
  step?: number;
  src: CuratedSrc;
}

const GR = "gl/GameRenderer.kt";
const SIM = "sim/Simulation.kt";
const PAL = "gl/Palette.kt";
const LAND = "private fun drawLandmarks";
const MONO = "SecretType.MONOLITH ->";
const LANT = "SecretType.LANTERN ->";
const HOLES = "private fun drawHoles";

const d = (file: string, decl: string): CuratedSrc => ({ file, decl });

export const CURATED: CuratedDef[] = [
  // ---- Kőkapu
  { key: "gate.half", element: "gates", group: "Kőkapu", label: "Nyílás fél szélessége", unit: "m", src: d(SIM, "GATE_HALF") },
  { key: "gate.postOut", element: "gates", group: "Kőkapu", label: "Oszlopok kiállása a nyílástól", unit: "m", src: { file: GR, after: LAND, find: "prim(box, parent, side * (GATE_HALF + #), #, #, #, #, #, #, #, #)", pick: [0] } },
  { key: "gate.postY", element: "gates", group: "Kőkapu", label: "Oszlop középmagassága", unit: "m", src: { file: GR, after: LAND, find: "prim(box, parent, side * (GATE_HALF + #), #, #, #, #, #, #, #, #)", pick: [1] } },
  { key: "gate.postW", element: "gates", group: "Kőkapu", label: "Oszlop szélessége", unit: "m", src: { file: GR, after: LAND, find: "prim(box, parent, side * (GATE_HALF + #), #, #, #, #, #, #, #, #)", pick: [6] } },
  { key: "gate.postH", element: "gates", group: "Kőkapu", label: "Oszlop magassága", unit: "m", src: { file: GR, after: LAND, find: "prim(box, parent, side * (GATE_HALF + #), #, #, #, #, #, #, #, #)", pick: [7] } },
  { key: "gate.postD", element: "gates", group: "Kőkapu", label: "Oszlop mélysége", unit: "m", src: { file: GR, after: LAND, find: "prim(box, parent, side * (GATE_HALF + #), #, #, #, #, #, #, #, #)", pick: [8] } },
  { key: "gate.lintelY", element: "gates", group: "Kőkapu", label: "Gerenda magassága", unit: "m", src: { file: GR, after: LAND, find: "prim(box, parent, #, #, #, #, #, #, GATE_HALF * # + #, #, #)", pick: [1] } },
  { key: "gate.lintelOver", element: "gates", group: "Kőkapu", label: "Gerenda túlnyúlása", unit: "m", src: { file: GR, after: LAND, find: "prim(box, parent, #, #, #, #, #, #, GATE_HALF * # + #, #, #)", pick: [7] } },
  { key: "gate.lintelH", element: "gates", group: "Kőkapu", label: "Gerenda vastagsága", unit: "m", src: { file: GR, after: LAND, find: "prim(box, parent, #, #, #, #, #, #, GATE_HALF * # + #, #, #)", pick: [8] } },
  { key: "gate.lintelD", element: "gates", group: "Kőkapu", label: "Gerenda mélysége", unit: "m", src: { file: GR, after: LAND, find: "prim(box, parent, #, #, #, #, #, #, GATE_HALF * # + #, #, #)", pick: [9] } },
  { key: "gate.emis", element: "gates", group: "Kőkapu", label: "Kő izzása", src: { file: GR, after: "for (g in e.gates)", find: "material(litProg, Palette.rock, Palette.ember, #, rough = #, metal = #)", pick: [0] } },
  { key: "gate.rough", element: "gates", group: "Kőkapu", label: "Kő érdessége", src: { file: GR, after: "for (g in e.gates)", find: "material(litProg, Palette.rock, Palette.ember, #, rough = #, metal = #)", pick: [1] } },
  { key: "gate.metal", element: "gates", group: "Kőkapu", label: "Kő fémessége", src: { file: GR, after: "for (g in e.gates)", find: "material(litProg, Palette.rock, Palette.ember, #, rough = #, metal = #)", pick: [2] } },
  // ---- Kapu hártya és fény
  { key: "gate.veilA", element: "gates", group: "Kapu energiahártyája", label: "Hártya fényereje", src: { file: GR, find: "additiveVeil(Palette.pursuer, (# + sin(t * # + i * #) * #).toFloat(), whiteTex, parent, GATE_HALF * #, #, ly = #)", pick: [0] } },
  { key: "gate.veilSpeed", element: "gates", group: "Kapu energiahártyája", label: "Pulzálás sebessége", src: { file: GR, find: "additiveVeil(Palette.pursuer, (# + sin(t * # + i * #) * #).toFloat(), whiteTex, parent, GATE_HALF * #, #, ly = #)", pick: [1] } },
  { key: "gate.veilAmt", element: "gates", group: "Kapu energiahártyája", label: "Pulzálás mértéke", src: { file: GR, find: "additiveVeil(Palette.pursuer, (# + sin(t * # + i * #) * #).toFloat(), whiteTex, parent, GATE_HALF * #, #, ly = #)", pick: [3] } },
  { key: "gate.veilH", element: "gates", group: "Kapu energiahártyája", label: "Hártya magassága", unit: "m", src: { file: GR, find: "additiveVeil(Palette.pursuer, (# + sin(t * # + i * #) * #).toFloat(), whiteTex, parent, GATE_HALF * #, #, ly = #)", pick: [5] } },
  { key: "gate.veilY", element: "gates", group: "Kapu energiahártyája", label: "Hártya középmagassága", unit: "m", src: { file: GR, find: "additiveVeil(Palette.pursuer, (# + sin(t * # + i * #) * #).toFloat(), whiteTex, parent, GATE_HALF * #, #, ly = #)", pick: [6] } },
  { key: "gate.glowY", element: "gates", group: "Kapu energiahártyája", label: "Fényudvar magassága", unit: "m", src: { file: GR, find: "for (g in e.gates) bGlow.add(g.x, groundHeight(g.x, g.z) + #, g.z, #, #, Palette.ember, # *", pick: [0] } },
  { key: "gate.glowSize", element: "gates", group: "Kapu energiahártyája", label: "Fényudvar mérete", unit: "m", src: { file: GR, find: "for (g in e.gates) bGlow.add(g.x, groundHeight(g.x, g.z) + #, g.z, #, #, Palette.ember, # *", pick: [1, 2] } },
  { key: "gate.glowA", element: "gates", group: "Kapu energiahártyája", label: "Fényudvar erőssége", src: { file: GR, find: "for (g in e.gates) bGlow.add(g.x, groundHeight(g.x, g.z) + #, g.z, #, #, Palette.ember, # *", pick: [3] } },
  { key: "col.ember", element: "gates", group: "Kapu energiahártyája", label: "Kapu izzásának színe", kind: "color", src: d(PAL, "ember") },
  { key: "col.pursuer", element: "gates", group: "Kapu energiahártyája", label: "Hártya színe", kind: "color", src: d(PAL, "pursuer") },
  // ---- Monolit (álló oszlop)
  { key: "mono.y", element: "gates", group: "Monolit (álló kőoszlop)", label: "Középmagasság", unit: "m", src: { file: GR, after: MONO, find: "prim(box, parent, #, #, #, #, #, #, #, #, #)", pick: [1] } },
  { key: "mono.rot", element: "gates", group: "Monolit (álló kőoszlop)", label: "Elforgatás", unit: "rad", src: { file: GR, after: MONO, find: "prim(box, parent, #, #, #, #, #, #, #, #, #)", pick: [4] } },
  { key: "mono.w", element: "gates", group: "Monolit (álló kőoszlop)", label: "Szélesség", unit: "m", src: { file: GR, after: MONO, find: "prim(box, parent, #, #, #, #, #, #, #, #, #)", pick: [6] } },
  { key: "mono.h", element: "gates", group: "Monolit (álló kőoszlop)", label: "Magasság", unit: "m", src: { file: GR, after: MONO, find: "prim(box, parent, #, #, #, #, #, #, #, #, #)", pick: [7] } },
  { key: "mono.d", element: "gates", group: "Monolit (álló kőoszlop)", label: "Vastagság", unit: "m", src: { file: GR, after: MONO, find: "prim(box, parent, #, #, #, #, #, #, #, #, #)", pick: [8] } },
  { key: "mono.emis", element: "gates", group: "Monolit (álló kőoszlop)", label: "Kő izzása", src: { file: GR, after: MONO, find: "material(litProg, Palette.rock, Palette.secret, #", pick: [0] } },
  { key: "mono.stripY", element: "gates", group: "Monolit (álló kőoszlop)", label: "Fénycsík középmagassága", unit: "m", src: { file: GR, after: MONO, nth: 2, find: "prim(box, parent, #, #, #, #, #, #, #, #, #)", pick: [1] } },
  { key: "mono.stripW", element: "gates", group: "Monolit (álló kőoszlop)", label: "Fénycsík szélessége", unit: "m", src: { file: GR, after: MONO, nth: 2, find: "prim(box, parent, #, #, #, #, #, #, #, #, #)", pick: [6] } },
  { key: "mono.stripH", element: "gates", group: "Monolit (álló kőoszlop)", label: "Fénycsík hossza", unit: "m", src: { file: GR, after: MONO, nth: 2, find: "prim(box, parent, #, #, #, #, #, #, #, #, #)", pick: [7] } },
  { key: "mono.glowSize", element: "gates", group: "Monolit (álló kőoszlop)", label: "Fényköd szélessége", unit: "m", src: { file: GR, find: "SecretType.MONOLITH -> bGlowFog.add(sec.x, gyS + #, sec.z, #, #, Palette.secret, min(#, # * pulse)", pick: [1] } },
  { key: "mono.glowH", element: "gates", group: "Monolit (álló kőoszlop)", label: "Fényköd magassága", unit: "m", src: { file: GR, find: "SecretType.MONOLITH -> bGlowFog.add(sec.x, gyS + #, sec.z, #, #, Palette.secret, min(#, # * pulse)", pick: [2] } },
  { key: "mono.glowA", element: "gates", group: "Monolit (álló kőoszlop)", label: "Fényköd erőssége", src: { file: GR, find: "SecretType.MONOLITH -> bGlowFog.add(sec.x, gyS + #, sec.z, #, #, Palette.secret, min(#, # * pulse)", pick: [4] } },
  { key: "col.secret", element: "gates", group: "Monolit (álló kőoszlop)", label: "Titkos fény színe", kind: "color", src: d(PAL, "secret") },
  // ---- Fénygyűrű
  { key: "ring.count", element: "gates", group: "Fénygyűrű", label: "Gömbök száma", unit: "db", min: 3, max: 32, step: 1, src: { file: GR, find: "for (m in 0 until #) {\n val a = m / # * PI * 2 + t * #", pick: [0, 1] } },
  { key: "ring.spin", element: "gates", group: "Fénygyűrű", label: "Forgás sebessége", src: { file: GR, find: "for (m in 0 until #) {\n val a = m / # * PI * 2 + t * #", pick: [2] } },
  { key: "ring.r", element: "gates", group: "Fénygyűrű", label: "Kör sugara", unit: "m", src: { file: GR, find: "prim(orb, parent, cos(a) * #, #, sin(a) * #, #, #, #, #, #, #)", pick: [0, 2] } },
  { key: "ring.y", element: "gates", group: "Fénygyűrű", label: "Magasság", unit: "m", src: { file: GR, find: "prim(orb, parent, cos(a) * #, #, sin(a) * #, #, #, #, #, #, #)", pick: [1] } },
  { key: "ring.w", element: "gates", group: "Fénygyűrű", label: "Gömb szélessége", unit: "m", src: { file: GR, find: "prim(orb, parent, cos(a) * #, #, sin(a) * #, #, #, #, #, #, #)", pick: [6, 8] } },
  { key: "ring.h", element: "gates", group: "Fénygyűrű", label: "Gömb magassága", unit: "m", src: { file: GR, find: "prim(orb, parent, cos(a) * #, #, sin(a) * #, #, #, #, #, #, #)", pick: [7] } },
  { key: "col.green", element: "gates", group: "Fénygyűrű", label: "Gyűrű színe", kind: "color", src: d(PAL, "green") },
  // ---- Lámpás
  { key: "lant.tilt", element: "gates", group: "Lámpás", label: "Oszlop dőlése", unit: "rad", src: { file: GR, after: LANT, find: "prim(cyl, parent, #, #, #, #, #, #, #, #, #)", pick: [5] } },
  { key: "lant.y", element: "gates", group: "Lámpás", label: "Oszlop középmagassága", unit: "m", src: { file: GR, after: LANT, find: "prim(cyl, parent, #, #, #, #, #, #, #, #, #)", pick: [1] } },
  { key: "lant.w", element: "gates", group: "Lámpás", label: "Oszlop vastagsága", unit: "m", src: { file: GR, after: LANT, find: "prim(cyl, parent, #, #, #, #, #, #, #, #, #)", pick: [6, 8] } },
  { key: "lant.h", element: "gates", group: "Lámpás", label: "Oszlop magassága", unit: "m", src: { file: GR, after: LANT, find: "prim(cyl, parent, #, #, #, #, #, #, #, #, #)", pick: [7] } },
  { key: "lamp.y", element: "gates", group: "Lámpás", label: "Lámpa magassága", unit: "m", src: { file: GR, after: LANT, find: "prim(box, parent, #, #, #, #, #, #, #, #, #)", pick: [1] } },
  { key: "lamp.w", element: "gates", group: "Lámpás", label: "Lámpa szélessége", unit: "m", src: { file: GR, after: LANT, find: "prim(box, parent, #, #, #, #, #, #, #, #, #)", pick: [6, 8] } },
  { key: "lamp.h", element: "gates", group: "Lámpás", label: "Lámpa magassága (méret)", unit: "m", src: { file: GR, after: LANT, find: "prim(box, parent, #, #, #, #, #, #, #, #, #)", pick: [7] } },
  { key: "col.lamp", element: "gates", group: "Lámpás", label: "Lámpafény színe", kind: "color", src: d(PAL, "lamp") },

  // ---- Fekete lyuk
  { key: "hole.r", element: "hole", group: "Test", label: "Fekete lyuk sugara", unit: "m", src: d(SIM, "HOLE_RADIUS") },
  { key: "hole.h", element: "hole", group: "Test", label: "Lebegési magasság", unit: "m", src: d(SIM, "HOLE_HEIGHT") },
  { key: "hole.bobS", element: "hole", group: "Test", label: "Lebegés sebessége", src: { file: GR, find: "val y = groundHeight(h.x, h.z) + HOLE_HEIGHT + sin(t * # + i) * #", pick: [0] } },
  { key: "hole.bobA", element: "hole", group: "Test", label: "Lebegés mértéke", unit: "m", src: { file: GR, find: "val y = groundHeight(h.x, h.z) + HOLE_HEIGHT + sin(t * # + i) * #", pick: [1] } },
  { key: "hole.tiltX", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Dőlés előre", unit: "rad", src: { file: GR, after: HOLES, find: "Mat.compose(parent, #, h.x, y, h.z, # + sin(t * # + i) * #, #, # + sin(t * # + i * #) * #", pick: [1] } },
  { key: "hole.tiltAmt", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Billegés mértéke", unit: "rad", src: { file: GR, after: HOLES, find: "Mat.compose(parent, #, h.x, y, h.z, # + sin(t * # + i) * #, #, # + sin(t * # + i * #) * #", pick: [3] } },
  { key: "hole.tiltZ", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Dőlés oldalra", unit: "rad", src: { file: GR, after: HOLES, find: "Mat.compose(parent, #, h.x, y, h.z, # + sin(t * # + i) * #, #, # + sin(t * # + i * #) * #", pick: [5] } },
  { key: "hole.r1", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Belső gyűrű mérete", unit: "m", src: { file: GR, find: "Triple(#, Palette.lavender, #), Triple(#, Palette.purple, #), Triple(#, Palette.secret, #)", pick: [0] } },
  { key: "hole.a1", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Belső gyűrű fénye", src: { file: GR, find: "Triple(#, Palette.lavender, #), Triple(#, Palette.purple, #), Triple(#, Palette.secret, #)", pick: [1] } },
  { key: "hole.r2", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Középső gyűrű mérete", unit: "m", src: { file: GR, find: "Triple(#, Palette.lavender, #), Triple(#, Palette.purple, #), Triple(#, Palette.secret, #)", pick: [2] } },
  { key: "hole.a2", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Középső gyűrű fénye", src: { file: GR, find: "Triple(#, Palette.lavender, #), Triple(#, Palette.purple, #), Triple(#, Palette.secret, #)", pick: [3] } },
  { key: "hole.r3", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Külső gyűrű mérete", unit: "m", src: { file: GR, find: "Triple(#, Palette.lavender, #), Triple(#, Palette.purple, #), Triple(#, Palette.secret, #)", pick: [4] } },
  { key: "hole.a3", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Külső gyűrű fénye", src: { file: GR, find: "Triple(#, Palette.lavender, #), Triple(#, Palette.purple, #), Triple(#, Palette.secret, #)", pick: [5] } },
  { key: "hole.spin", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Forgás sebessége", src: { file: GR, find: "val spin = t * (# - r * #)", pick: [0] } },
  { key: "hole.spinFall", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Lassulás kifelé", src: { file: GR, find: "val spin = t * (# - r * #)", pick: [1] } },
  { key: "col.lavender", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Belső gyűrű színe", kind: "color", src: d(PAL, "lavender") },
  { key: "col.purple", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Középső gyűrű színe", kind: "color", src: d(PAL, "purple") },
  { key: "col.secretHole", element: "hole", group: "Fénygyűrűk (akkréciós fátyol)", label: "Külső gyűrű színe", kind: "color", src: d(PAL, "secret") },

  // ---- Power-up gömbök
  { key: "orb.alpha", element: "orbs", group: "Üveggömb", label: "Gömb átlátszatlansága", hint: "1 = teljesen átlátszatlan", src: d(GR, "ORB_ALPHA") },
  { key: "orb.base", element: "orbs", group: "Üveggömb", label: "Lebegési magasság", unit: "m", src: { file: GR, after: LAND, find: "val base = groundHeight(o.p.x, o.p.z) + #", pick: [0] } },
  { key: "orb.size", element: "orbs", group: "Üveggömb", label: "Gömb mérete", unit: "m", src: { file: GR, find: "val size = (if (taken != null) max(#, # * (# - k)) else # + sin(t * # + i) * #) * (# + # * orbIn(o, t))", pick: [1, 3] } },
  { key: "orb.pulseS", element: "orbs", group: "Üveggömb", label: "Pulzálás sebessége", src: { file: GR, find: "val size = (if (taken != null) max(#, # * (# - k)) else # + sin(t * # + i) * #) * (# + # * orbIn(o, t))", pick: [4] } },
  { key: "orb.pulseA", element: "orbs", group: "Üveggömb", label: "Pulzálás mértéke", unit: "m", src: { file: GR, find: "val size = (if (taken != null) max(#, # * (# - k)) else # + sin(t * # + i) * #) * (# + # * orbIn(o, t))", pick: [5] } },
  { key: "orb.bobS", element: "orbs", group: "Üveggömb", label: "Lebegés sebessége", src: { file: GR, find: "else base + sin(t * # + i * #) * #", pick: [0] } },
  { key: "orb.bobA", element: "orbs", group: "Üveggömb", label: "Lebegés mértéke", unit: "m", src: { file: GR, find: "else base + sin(t * # + i * #) * #", pick: [2] } },
  { key: "orb.spin", element: "orbs", group: "Üveggömb", label: "Forgás sebessége", src: { file: GR, find: "place(parent, px, py, pz, #, t * #, #, size)", pick: [1] } },
  { key: "col.freezer", element: "orbs", group: "Üveggömb", label: "Fagyasztó gömb színe", kind: "color", src: d(PAL, "freezer") },
  { key: "col.ghost", element: "orbs", group: "Üveggömb", label: "Szellem gömb színe", kind: "color", src: d(PAL, "ghost") },
  { key: "col.shock", element: "orbs", group: "Üveggömb", label: "Lökéshullám gömb színe", kind: "color", src: d(PAL, "shock") },
  { key: "band1.col", element: "orbs", group: "Plazmasávok a gömbben", label: "1. sáv színe", kind: "color3", src: { file: GR, after: LAND, nth: 1, find: "floatArrayOf(#, #, #), mode = #, alpha = # * vf", pick: [0, 1, 2] } },
  { key: "band1.a", element: "orbs", group: "Plazmasávok a gömbben", label: "1. sáv fénye", src: { file: GR, after: LAND, nth: 1, find: "floatArrayOf(#, #, #), mode = #, alpha = # * vf", pick: [4] } },
  { key: "band1.s", element: "orbs", group: "Plazmasávok a gömbben", label: "1. sáv mérete", src: { file: GR, find: "prim(torusA, parent, #, #, #, # + sin(t * # + i) * #, t * # + i, #, # * pulse * rs, # * pulse * rs, # * pulse * rs)", pick: [8, 9, 10] } },
  { key: "band1.spin", element: "orbs", group: "Plazmasávok a gömbben", label: "1. sáv forgása", src: { file: GR, find: "prim(torusA, parent, #, #, #, # + sin(t * # + i) * #, t * # + i, #, # * pulse * rs, # * pulse * rs, # * pulse * rs)", pick: [6] } },
  { key: "band2.col", element: "orbs", group: "Plazmasávok a gömbben", label: "2. sáv színe", kind: "color3", src: { file: GR, after: LAND, nth: 2, find: "floatArrayOf(#, #, #), mode = #, alpha = # * vf", pick: [0, 1, 2] } },
  { key: "band2.a", element: "orbs", group: "Plazmasávok a gömbben", label: "2. sáv fénye", src: { file: GR, after: LAND, nth: 2, find: "floatArrayOf(#, #, #), mode = #, alpha = # * vf", pick: [4] } },
  { key: "band2.s", element: "orbs", group: "Plazmasávok a gömbben", label: "2. sáv mérete", src: { file: GR, find: "prim(torusB, parent, #, #, #, #, -t * # + i, # + sin(t * # + i) * #, # * pulse * rs, # * pulse * rs, # * pulse * rs)", pick: [8, 9, 10] } },
  { key: "band2.spin", element: "orbs", group: "Plazmasávok a gömbben", label: "2. sáv forgása", src: { file: GR, find: "prim(torusB, parent, #, #, #, #, -t * # + i, # + sin(t * # + i) * #, # * pulse * rs, # * pulse * rs, # * pulse * rs)", pick: [4] } },
  { key: "band3.col", element: "orbs", group: "Plazmasávok a gömbben", label: "3. sáv színe", kind: "color3", src: { file: GR, after: LAND, nth: 3, find: "floatArrayOf(#, #, #), mode = #, alpha = # * vf", pick: [0, 1, 2] } },
  { key: "band3.a", element: "orbs", group: "Plazmasávok a gömbben", label: "3. sáv fénye", src: { file: GR, after: LAND, nth: 3, find: "floatArrayOf(#, #, #), mode = #, alpha = # * vf", pick: [4] } },
  { key: "band3.s", element: "orbs", group: "Plazmasávok a gömbben", label: "3. sáv mérete", src: { file: GR, find: "prim(torusC, parent, #, #, #, #, t * # + i, #, # * pulse * rs, # * pulse * rs, # * pulse * rs)", pick: [6, 7, 8] } },
  { key: "band3.spin", element: "orbs", group: "Plazmasávok a gömbben", label: "3. sáv forgása", src: { file: GR, find: "prim(torusC, parent, #, #, #, #, t * # + i, #, # * pulse * rs, # * pulse * rs, # * pulse * rs)", pick: [4] } },
  { key: "band4.col", element: "orbs", group: "Plazmasávok a gömbben", label: "Finom szálak színe", kind: "color3", src: { file: GR, after: LAND, nth: 4, find: "floatArrayOf(#, #, #), mode = #, alpha = # * vf", pick: [0, 1, 2] } },
  { key: "band4.a", element: "orbs", group: "Plazmasávok a gömbben", label: "Finom szálak fénye", src: { file: GR, after: LAND, nth: 4, find: "floatArrayOf(#, #, #), mode = #, alpha = # * vf", pick: [4] } },
  { key: "band4.s", element: "orbs", group: "Plazmasávok a gömbben", label: "Finom szálak mérete", src: { file: GR, find: "prim(torusB, parent, #, #, #, #, t * # + i * #, #, # * pulse * rs, # * pulse * rs, # * pulse * rs)", pick: [7, 8, 9] } },
  { key: "band4.spin", element: "orbs", group: "Plazmasávok a gömbben", label: "Finom szálak forgása", src: { file: GR, find: "prim(torusB, parent, #, #, #, #, t * # + i * #, #, # * pulse * rs, # * pulse * rs, # * pulse * rs)", pick: [4] } },
  { key: "torA.R", element: "orbs", group: "Sávgyűrűk alakja", label: "Nagy gyűrű sugara", src: { file: GR, all: true, find: "torusA = Mesh(Geo.torus(#, #, #, #), #)", pick: [0] } },
  { key: "torA.r", element: "orbs", group: "Sávgyűrűk alakja", label: "Nagy gyűrű vastagsága", src: { file: GR, all: true, find: "torusA = Mesh(Geo.torus(#, #, #, #), #)", pick: [1] } },
  { key: "torB.R", element: "orbs", group: "Sávgyűrűk alakja", label: "Közepes gyűrű sugara", src: { file: GR, all: true, find: "torusB = Mesh(Geo.torus(#, #, #, #), #)", pick: [0] } },
  { key: "torB.r", element: "orbs", group: "Sávgyűrűk alakja", label: "Közepes gyűrű vastagsága", src: { file: GR, all: true, find: "torusB = Mesh(Geo.torus(#, #, #, #), #)", pick: [1] } },
  { key: "torC.R", element: "orbs", group: "Sávgyűrűk alakja", label: "Kis gyűrű sugara", src: { file: GR, all: true, find: "torusC = Mesh(Geo.torus(#, #, #, #), #)", pick: [0] } },
  { key: "torC.r", element: "orbs", group: "Sávgyűrűk alakja", label: "Kis gyűrű vastagsága", src: { file: GR, all: true, find: "torusC = Mesh(Geo.torus(#, #, #, #), #)", pick: [1] } },
];

const NUM_GROUP = "(-?(?:0[xX][0-9a-fA-F_]+|(?:\\d[\\d_]*)?\\.\\d[\\d_]*(?:[eE][-+]?\\d+)?|\\d[\\d_]*(?:[eE][-+]?\\d+)?)[fFL]?)";

export function patternRegex(find: string): RegExp {
  let re = "";
  for (const part of find.split("#")) {
    if (re) re += NUM_GROUP;
    re += part
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*");
  }
  return new RegExp(re, "gd");
}

export interface FileIndex {
  path: string;
  src: string;
  byStart: Map<number, Literal>;
  byDecl: Map<string, Literal[]>;
}

export function findFile(files: Map<string, FileIndex>, suffix: string): FileIndex | undefined {
  for (const [p, f] of files) if (p === suffix || p.endsWith("/" + suffix)) return f;
  return undefined;
}

/** Literal ids a curated control writes to; empty when this repo has no such code. */
export function resolveCurated(def: CuratedDef, files: Map<string, FileIndex>): string[] {
  const f = findFile(files, def.src.file);
  if (!f) return [];
  const src = def.src;
  if ("decl" in src) return (f.byDecl.get(src.decl) ?? []).map((l) => l.id);
  const re = patternRegex(src.find);
  const from = src.after ? f.src.indexOf(src.after) : 0;
  if (from < 0) return [];
  re.lastIndex = from;
  const ids: string[] = [];
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(f.src))) {
    count++;
    if (src.all || count === (src.nth ?? 1)) {
      for (const p of src.pick) {
        const span = m.indices?.[p + 1];
        const lit = span ? f.byStart.get(span[0]) : undefined;
        if (!lit) return [];
        ids.push(lit.id);
      }
      if (!src.all) break;
    }
  }
  return ids;
}
