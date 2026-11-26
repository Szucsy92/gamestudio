/** The values the 3D previews read, resolved from the repo plus the current edits. */
import { CURATED } from "./curated";
import { curatedValue, valueOf, type Model } from "./catalog";
import { findFile } from "./curated";

const COLOR_KEYS = [
  "fog", "moon", "lamp", "green", "purple", "lavender", "trunk", "ground", "crown", "rock", "ember", "pursuer", "freezer", "ghost", "shock", "secret", "sunDusk", "sunDay",
  "band1.col", "band2.col", "band3.col", "band4.col",
] as const;
export type LookColors = Record<(typeof COLOR_KEYS)[number], string>;
export type Look = Record<string, number> & { colors: LookColors };

const toHex = (n: number) => `#${Math.max(0, Math.min(0xffffff, Math.round(n))).toString(16).padStart(6, "0")}`;
const lin2srgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
export const srgb2lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

export function linearTripleToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, lin2srgb(v))) * 255);
  return toHex((c(r) << 16) | (c(g) << 8) | c(b));
}

const FALLBACK: Record<string, number> = {
  "gate.half": 2.4, "gate.postOut": 0.2, "gate.postY": 2.1, "gate.postW": 0.4, "gate.postH": 4.6, "gate.postD": 0.4, "gate.lintelY": 4.5, "gate.lintelOver": 0.8,
  "gate.lintelH": 0.4, "gate.lintelD": 0.4, "gate.emis": 0.9, "gate.rough": 0.4, "gate.metal": 0.2, "gate.veilA": 0.16, "gate.veilSpeed": 1.7, "gate.veilAmt": 0.06,
  "gate.veilH": 4.4, "gate.veilY": 2.2, "gate.glowY": 3, "gate.glowSize": 16, "gate.glowA": 0.32, "mono.y": 2, "mono.rot": 0.4, "mono.w": 1, "mono.h": 4.4, "mono.d": 0.35,
  "mono.emis": 0.08, "mono.stripY": 2.1, "mono.stripW": 0.06, "mono.stripH": 3.2, "mono.glowSize": 5, "mono.glowH": 7, "mono.glowA": 0.35, "ring.count": 11, "ring.spin": 0.25,
  "ring.r": 2.6, "ring.y": 0.2, "ring.w": 0.16, "ring.h": 0.1, "lant.tilt": 0.08, "lant.y": 0.8, "lant.w": 0.12, "lant.h": 1.6, "lamp.y": 1.7, "lamp.w": 0.24, "lamp.h": 0.3,
  "hole.r": 2.2, "hole.h": 2.6, "hole.bobS": 0.6, "hole.bobA": 0.12, "hole.tiltX": 1.2, "hole.tiltAmt": 0.12, "hole.tiltZ": 0.35, "hole.r1": 10, "hole.a1": 0.16, "hole.r2": 13,
  "hole.a2": 0.11, "hole.r3": 17, "hole.a3": 0.07, "hole.spin": 0.9, "hole.spinFall": 0.28, "orb.alpha": 0.5, "orb.base": 1.15, "orb.size": 0.42, "orb.pulseS": 2.1,
  "orb.pulseA": 0.035, "orb.bobS": 1.3, "orb.bobA": 0.08, "orb.spin": 0.8, "band1.a": 0.58, "band1.s": 0.125, "band1.spin": 0.72, "band2.a": 0.44, "band2.s": 0.18,
  "band2.spin": 0.91, "band3.a": 0.36, "band3.s": 0.27, "band3.spin": 0.58, "band4.a": 0.3, "band4.s": 0.14, "band4.spin": 1.18, "torA.R": 2.4, "torA.r": 0.14,
  "torB.R": 1.5, "torB.r": 0.08, "torC.R": 0.8, "torC.r": 0.1,
};

const PALETTE_FALLBACK: Record<string, number> = {
  fog: 0x081030, moon: 0x7a92ff, lamp: 0xffe6b8, green: 0x24d975, purple: 0x883cdb, lavender: 0xc8b8e0, trunk: 0xb8a58c, ground: 0x9aa896, crown: 0x17251c,
  rock: 0x3a4048, ember: 0xff2a1a, pursuer: 0xff1e10, freezer: 0x2b6cff, ghost: 0x2ee88a, shock: 0xb04dff, secret: 0x7fe8d8, sunDusk: 0xff3a78, sunDay: 0xffeeb0,
};

export function lookFrom(model: Model, edits: Record<string, number>): Look {
  const out = { colors: Object.fromEntries(COLOR_KEYS.map((k) => [k, "#888888"])) } as unknown as Look;
  for (const [k, fb] of Object.entries(FALLBACK)) out[k] = curatedValue(model, edits, k, fb);
  for (const c of CURATED) {
    if (c.kind !== "color3") continue;
    const ids = model.curated.get(c.key) ?? [];
    if (ids.length === 3) (out.colors as Record<string, string>)[c.key] = linearTripleToHex(...(ids.map((id) => valueOf(model, edits, id)) as [number, number, number]));
  }
  const bandFallback = { "band1.col": "#4fdcff", "band2.col": "#7ca4ff", "band3.col": "#cf7cff", "band4.col": "#60f0ff" } as const;
  for (const [k, v] of Object.entries(bandFallback)) if (!model.curated.get(k)?.length) out.colors[k as keyof typeof bandFallback] = v;
  const pal = findFile(model.files, "gl/Palette.kt");
  for (const [k, fb] of Object.entries(PALETTE_FALLBACK)) {
    const id = pal?.byDecl.get(k)?.[0]?.id;
    (out.colors as Record<string, string>)[k] = toHex(id ? valueOf(model, edits, id) : fb);
  }
  const sky = findFile(model.files, "gl/SkyLight.kt");
  const sv = (name: string, fb: number) => {
    const id = sky?.byDecl.get(name)?.[0]?.id;
    return id ? valueOf(model, edits, id) : fb;
  };
  out["sun.maxEl"] = sv("SUN.maxElDeg", 23);
  out["sun.high"] = sv("SUN.intensityHigh", 2.75);
  out["moon.maxEl"] = sv("MOON.maxElDeg", 23);
  out["moon.high"] = sv("MOON.intensityHigh", 1.55);
  return out;
}
