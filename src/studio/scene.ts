/**
 * Universal 3D scene interpreter: reads any loaded Kotlin/OpenGL repo's declarations, geometry constructors,
 * palette colours, and live slider/toggle edits, and builds a procedural Three.js scene graph with no hardcoded game assets.
 */
import { valueOf, type ElementDef, type Model } from "./catalog";

export type PrimShape = "torus" | "sphere" | "box" | "cylinder" | "cone" | "plane" | "ring_spheres" | "spiral" | "particles" | "glow" | "mist";

export interface DynamicPrim {
  id: string;
  shape: PrimShape;
  pos: [number, number, number];
  rot: [number, number, number];
  scale: [number, number, number];
  args: number[];
  color: string;
  colors?: string[] | undefined;
  emissive?: string | undefined;
  emissiveIntensity?: number | undefined;
  opacity: number;
  roughness?: number | undefined;
  additive?: boolean | undefined;
  anim?: {
    spinY?: number | undefined;
    spinZ?: number | undefined;
    bobAmp?: number | undefined;
    bobSpeed?: number | undefined;
    pulseAmp?: number | undefined;
  } | undefined;
  visible: boolean;
}

export interface DynamicObject {
  id: string;
  section: string;
  label: string;
  prims: DynamicPrim[];
  /** Suggested camera distance for framing this object alone. */
  radius: number;
  centerY: number;
}

export interface DynamicScene {
  objects: DynamicObject[];
  bg: string;
  groundColor: string;
  ambientColor: string;
  keyLightColor: string;
  isDynamic: boolean;
}

const toHex = (n: number) => `#${Math.max(0, Math.min(0xffffff, Math.round(n))).toString(16).padStart(6, "0")}`;

/** Collects every hex colour declared anywhere in the repo (live with current edits). */
function collectPalette(model: Model, edits: Record<string, number>): { single: Map<string, string>; arrays: Map<string, string[]> } {
  const single = new Map<string, string>();
  const arrays = new Map<string, string[]>();
  for (const l of model.lits.values()) {
    if (l.kind !== "hex" || !l.declBase) continue;
    const hex = toHex(valueOf(model, edits, l.id));
    if (l.decl && l.decl.includes("[")) {
      const list = arrays.get(l.declBase) ?? [];
      list.push(hex);
      arrays.set(l.declBase, list);
    } else if (!single.has(l.declBase)) {
      single.set(l.declBase, hex);
    }
  }
  return { single, arrays };
}

/** Collects live numeric/boolean values per section + flat global constants. */
function collectValues(model: Model, edits: Record<string, number>): { bySection: Map<string, Map<string, number>>; global: Map<string, number> } {
  const bySection = new Map<string, Map<string, number>>();
  const global = new Map<string, number>();
  for (const l of model.lits.values()) {
    if (!l.declBase || l.inFunction) continue;
    const v = valueOf(model, edits, l.id);
    let m = bySection.get(l.section);
    if (!m) bySection.set(l.section, (m = new Map()));
    if (!m.has(l.declBase)) m.set(l.declBase, v);
    if (l.decl && l.decl !== l.declBase) m.set(l.decl, v);
    if (!global.has(l.declBase)) global.set(l.declBase, v);
  }
  return { bySection, global };
}

/** Scans renderer/code files to see which Palette colour names and geometry shapes are mentioned near a section name. */
function inspectUsage(model: Model, section: string): { shapes: Set<string>; paletteRefs: string[] } {
  const shapes = new Set<string>();
  const paletteRefs: string[] = [];
  const leaf = section.split(".").pop() ?? section;
  const re = new RegExp(`\\b(?:${section.replace(".", "\\.")}|${leaf})\\b`, "g");
  for (const f of model.files.values()) {
    const src = f.src;
    if (!re.test(src)) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const win = src.slice(Math.max(0, m.index - 250), Math.min(src.length, m.index + 700));
      if (/\btorus\w*|Geo\.torus/i.test(win)) shapes.add("torus");
      if (/\b(?:orb|sphere|icosphere|holeBody)\b|Geo\.icosphere|Geo\.sphere/i.test(win)) shapes.add("sphere");
      if (/\bbox\b|Geo\.box/i.test(win)) shapes.add("box");
      if (/\bcyl(?:inder)?\b|Geo\.cylinder/i.test(win)) shapes.add("cylinder");
      if (/\bcone\b|Geo\.cone/i.test(win)) shapes.add("cone");
      if (/\b(?:quad|plane)\b|Geo\.quad/i.test(win)) shapes.add("plane");
      if (/\bSprites?\b|GlowTex|pollen/i.test(win)) shapes.add("sprites");
      for (const pm of win.matchAll(/Palette\.(\w+)/g)) {
        if (!paletteRefs.includes(pm[1]!)) paletteRefs.push(pm[1]!);
      }
    }
  }
  return { shapes, paletteRefs };
}

function num(m: Map<string, number>, keys: string[], fallback: number): number {
  for (const k of keys) {
    const v = m.get(k);
    if (v !== undefined) return v;
  }
  return fallback;
}

function flag(m: Map<string, number>, key: string, fallback = true): boolean {
  const v = m.get(key);
  return v === undefined ? fallback : v >= 0.5;
}

function buildObjectPrims(
  el: ElementDef,
  m: Map<string, number>,
  global: Map<string, number>,
  pal: { single: Map<string, string>; arrays: Map<string, string[]> },
  usage: { shapes: Set<string>; paletteRefs: string[] },
): { prims: DynamicPrim[]; radius: number; centerY: number } {
  const prims: DynamicPrim[] = [];
  const sec = el.section ?? el.label;
  const on = flag(m, "ON", true);
  const pickColor = (preferred: string[], fallback: string) => {
    for (const k of [...preferred, ...usage.paletteRefs]) {
      const c = pal.single.get(k);
      if (c) return c;
    }
    return fallback;
  };
  // If the object itself declares a hex colour, prefer it.
  const ownColor = (() => {
    for (const k of ["COLOR", "COLOUR", "TINT", "HEX", "color"]) {
      const v = m.get(k);
      if (v !== undefined && v > 255) return toHex(v);
    }
    return undefined;
  })();

  // 1. Torus ring object (e.g. GateRing or any torus-based portal/ring)
  if (m.has("TORUS_R") || m.has("TORUS_TUBE") || (usage.shapes.has("torus") && !/orb|sphere|hole|mist|pollen|light|halo|relic/i.test(sec))) {
    const ringR = num(m, ["RADIUS"], global.get("GATE_HALF") ?? num(m, ["TORUS_R", "SIZE"], 2.4));
    const torusR = num(m, ["TORUS_R", "RADIUS"], 2.4);
    const tube = num(m, ["TORUS_TUBE", "TUBE"], 0.14);
    const k = torusR > 0.01 ? ringR / torusR : 1;
    const gap = num(m, ["GAP", "HEIGHT"], 0);
    const cy = ringR + tube * k + gap;
    const col = ownColor ?? pickColor(["ember", "pursuer", "secret", "lamp"], "#ff4526");
    prims.push({
      id: `${sec}:torus`,
      shape: "torus",
      pos: [0, cy, 0],
      rot: [0, 0, 0],
      scale: [k, k, k],
      args: [torusR, Math.max(0.02, tube)],
      color: col,
      emissive: col,
      emissiveIntensity: num(m, ["EMISSIVE"], 0.9),
      opacity: num(m, ["ALPHA"], 1),
      roughness: num(m, ["ROUGH"], 0.35),
      visible: on,
    });
    if (m.has("GLOW") || m.has("GLOW_COUNT")) {
      const glowOn = on && flag(m, "GLOW", true);
      const count = Math.max(4, Math.min(48, Math.round(num(m, ["GLOW_COUNT"], 20))));
      const glowSize = num(m, ["GLOW_SIZE"], 2.8);
      const glowAlpha = num(m, ["GLOW_ALPHA"], 0.5);
      prims.push({
        id: `${sec}:glow_ring`,
        shape: "ring_spheres",
        pos: [0, cy, 0],
        rot: [Math.PI / 2, 0, 0],
        scale: [1, 1, 1],
        args: [count, ringR, glowSize * 0.18],
        color: col,
        opacity: glowAlpha,
        additive: true,
        anim: { pulseAmp: num(m, ["GLOW_PULSE"], 0.15) },
        visible: glowOn,
      });
    }
    return { prims, radius: Math.max(3.5, ringR * 2.2), centerY: cy };
  }

  // 2. Spore spiral + fairy ring / relic-style composite object
  if (m.has("SPIRAL_COUNT") || m.has("FAIRY_COUNT")) {
    const fairyColors = pal.arrays.get("fairy") ?? ["#2b6cff", "#2ee88a", "#b04dff", "#ff7a3d", "#f6ff4f", "#ff6bd6"];
    const trioColors = pal.arrays.get("spiralTrio") ?? ["#ff6bd6", "#6bffe1", "#ffd36b"];
    const secCol = ownColor ?? pickColor(["secret", "green", "lavender"], "#7fe8d8");
    if (m.has("SPIRAL_COUNT")) {
      prims.push({
        id: `${sec}:spiral`,
        shape: "spiral",
        pos: [-3.4, 1.4, 0],
        rot: [0, 0, 0],
        scale: [1, 1, 1],
        args: [
          Math.max(4, Math.min(120, Math.round(num(m, ["SPIRAL_COUNT"], 36)))),
          num(m, ["SPIRAL_RADIUS"], 3.2),
          num(m, ["SPIRAL_TURNS"], 1.25),
          num(m, ["SPIRAL_SIZE"], 0.46),
        ],
        color: secCol,
        colors: trioColors,
        opacity: num(m, ["SPIRAL_ALPHA"], 0.8),
        additive: true,
        anim: { spinY: num(m, ["SPIRAL_SPIN"], 0.35), pulseAmp: num(m, ["GLOW_PULSE"], 0.18) },
        visible: on,
      });
    }
    if (m.has("FAIRY_COUNT")) {
      prims.push({
        id: `${sec}:fairy`,
        shape: "ring_spheres",
        pos: [3.4, num(m, ["FAIRY_HEIGHT"], 1.0), 0],
        rot: [0, 0, 0],
        scale: [1, 1, 1],
        args: [
          Math.max(3, Math.min(24, Math.round(num(m, ["FAIRY_COUNT"], 6)))),
          num(m, ["FAIRY_RADIUS"], 2.3),
          num(m, ["FAIRY_SPHERE"], 0.3),
        ],
        color: secCol,
        colors: fairyColors,
        emissive: secCol,
        emissiveIntensity: 1.2,
        opacity: 0.72,
        roughness: 0.2,
        anim: { spinY: num(m, ["FAIRY_SPIN"], 0.28) },
        visible: on,
      });
    }
    return { prims, radius: 7.5, centerY: 1.4 };
  }

  // 3. Black hole / celestial body with veils & halo
  if (m.has("BODY") || m.has("VEILS") || /blackhole|hole/i.test(sec)) {
    const r = global.get("HOLE_RADIUS") ?? num(m, ["RADIUS", "SIZE"], 2.2);
    const h = global.get("HOLE_HEIGHT") ?? num(m, ["HEIGHT"], 2.6);
    const bob = num(m, ["BOB"], 0.12);
    const bodyOn = on && flag(m, "BODY", true);
    const veilsOn = on && flag(m, "VEILS", true);
    const glowOn = on && flag(m, "GLOW", true);
    const c1 = pickColor(["lavender"], "#c8b8e0");
    const c2 = pickColor(["purple"], "#883cdb");
    const c3 = pickColor(["secret"], "#7fe8d8");
    prims.push({
      id: `${sec}:body`,
      shape: "sphere",
      pos: [0, h, 0],
      rot: [0, 0, 0],
      scale: [1, 1, 1],
      args: [r],
      color: "#050508",
      opacity: 1,
      roughness: 0.1,
      anim: { bobAmp: bob, bobSpeed: 0.6 },
      visible: bodyOn,
    });
    [
      [r * 2.1, c1, 0.16, 0.9],
      [r * 2.7, c2, 0.11, -0.62],
      [r * 3.4, c3, 0.07, 0.34],
    ].forEach(([defRad, col, defOp, sp], idx) => {
      const ringSize = m.get(`RING_SIZE[${idx}]`);
      const ringAlpha = m.get(`RING_ALPHA[${idx}]`);
      const rad = ringSize !== undefined ? Math.max(0.5, ringSize * 0.5) : (defRad as number);
      const op = ringAlpha !== undefined ? Math.max(0.02, Math.min(1, ringAlpha * 2.2)) : (defOp as number) * 2.2;
      prims.push({
        id: `${sec}:veil${idx}`,
        shape: "torus",
        pos: [0, h, 0],
        rot: [1.15 + idx * 0.08, 0, 0.32 - idx * 0.06],
        scale: [1, 1, 1],
        args: [rad, 0.08 + idx * 0.03],
        color: col as string,
        emissive: col as string,
        emissiveIntensity: 1.4,
        opacity: op,
        additive: true,
        anim: { spinZ: sp as number, bobAmp: bob, bobSpeed: 0.6 },
        visible: veilsOn,
      });
    });
    prims.push({
      id: `${sec}:glow`,
      shape: "glow",
      pos: [0, h, 0],
      rot: [0, 0, 0],
      scale: [1, 1, 1],
      args: [r * 5.2, r * 5.2],
      color: c2,
      opacity: 0.32,
      additive: true,
      anim: { bobAmp: bob, bobSpeed: 0.6 },
      visible: glowOn,
    });
    return { prims, radius: Math.max(6, r * 4), centerY: h };
  }

  // 4. Mist / drifting fog layers
  if (m.has("WIDTH_BASE") || /mist|fog/i.test(sec)) {
    const count = Math.max(1, Math.min(10, Math.round(num(m, ["COUNT"], 4))));
    const w0 = num(m, ["WIDTH_BASE", "WIDTH"], 12);
    const wStep = num(m, ["WIDTH_STEP"], 2.5);
    const h = num(m, ["HEIGHT"], 3.2);
    const alpha = Math.min(0.65, Math.max(0.08, num(m, ["ALPHA"], 0.12) * 3));
    const lift = num(m, ["LIFT"], 0.7);
    const liftStep = num(m, ["LIFT_STEP"], 0.15);
    const col = ownColor ?? pickColor(["fog", "moon", "dayFog"], "#8ca8c8");
    for (let i = 0; i < count; i++) {
      prims.push({
        id: `${sec}:mist${i}`,
        shape: "mist",
        pos: [0, lift + i * liftStep + h * 0.5, -i * 2.6 + (count - 1) * 1.3],
        rot: [0, 0, 0],
        scale: [1, 1, 1],
        args: [w0 + i * wStep, h],
        color: col,
        opacity: alpha,
        additive: false,
        anim: { bobAmp: 0.12, bobSpeed: 0.35 + i * 0.08 },
        visible: on,
      });
    }
    return { prims, radius: Math.max(8, w0 * 0.8), centerY: h * 0.6 };
  }

  // 5. Particles / Pollen / Swarm / Motes
  if (m.has("FLUTTER_SPEED") || m.has("GLOW_SIZE_BASE") || /pollen|mote|spark|particle|swarm/i.test(sec)) {
    const size = num(m, ["GLOW_SIZE_BASE", "SIZE"], 0.34);
    const range = Math.min(14, Math.max(3, num(m, ["RANGE", "RADIUS"], 8) * 0.25));
    const c1 = ownColor ?? pickColor(["pollen", "pollenWarm", "lamp"], "#d3d5a0");
    const c2 = pickColor(["pollenWarm", "pollenDay"], "#e8a21c");
    prims.push({
      id: `${sec}:particles`,
      shape: "particles",
      pos: [0, 2.2, 0],
      rot: [0, 0, 0],
      scale: [1, 1, 1],
      args: [48, range, Math.max(0.08, size)],
      color: c1,
      colors: [c1, c2],
      opacity: num(m, ["GLOW_ALPHA", "ALPHA"], 0.75),
      additive: true,
      anim: { bobAmp: num(m, ["BOB"], 0.16), bobSpeed: num(m, ["FLUTTER_SPEED"], 0.4), pulseAmp: num(m, ["PULSE"], 0.06) },
      visible: on,
    });
    return { prims, radius: range * 1.3, centerY: 2.2 };
  }

  // 6. Distant glow lights / halos (ForestLights, OrbHalo)
  if (m.has("SIZE_FIRST") || /halo|light/i.test(sec)) {
    const h = num(m, ["HEIGHT"], 2.4);
    const size = Math.min(12, num(m, ["SIZE", "SIZE_FIRST"], 3.2) * (m.has("SIZE_FIRST") ? 0.35 : 1));
    const alpha = num(m, ["ALPHA", "ALPHA_LOW"], 0.6);
    const cols = m.has("SIZE_FIRST")
      ? [pickColor(["green"], "#24d975"), pickColor(["purple"], "#883cdb"), pickColor(["lavender"], "#c8b8e0")]
      : [pickColor(["freezer"], "#2b6cff"), pickColor(["ghost"], "#2ee88a"), pickColor(["shock"], "#b04dff")];
    cols.forEach((col, i) => {
      prims.push({
        id: `${sec}:glow${i}`,
        shape: "glow",
        pos: [(i - 1) * Math.max(2.4, size * 0.75), h, 0],
        rot: [0, 0, 0],
        scale: [1, 1, 1],
        args: [size, size],
        color: col,
        opacity: alpha,
        additive: true,
        anim: { pulseAmp: 0.12 },
        visible: on,
      });
    });
    return { prims, radius: Math.max(4, size * 1.8), centerY: h };
  }

  // 7. Translucent glass spheres / orbs (OrbSphere or any sphere-based object)
  if (usage.shapes.has("sphere") || /orb|sphere|ball|planet|asteroid/i.test(sec)) {
    const r = Math.max(0.12, num(m, ["SIZE", "RADIUS"], 0.42));
    const h = num(m, ["HEIGHT"], 1.15);
    const alpha = num(m, ["ALPHA"], 0.55);
    const emis = num(m, ["EMISSIVE"], 1.2);
    const rough = num(m, ["ROUGH"], 0.2);
    const flow = flag(m, "FLOW", false);
    const multi = /orb/i.test(sec) && (pal.single.has("freezer") || pal.single.has("ghost"));
    const cols = multi
      ? [pickColor(["freezer"], "#2b6cff"), pickColor(["ghost"], "#2ee88a"), pickColor(["shock"], "#b04dff")]
      : [ownColor ?? pickColor(["secret", "freezer", "lamp"], "#6bb8ff")];
    cols.forEach((col, i) => {
      const x = cols.length > 1 ? (i - (cols.length - 1) / 2) * Math.max(1.8, r * 4) : 0;
      prims.push({
        id: `${sec}:sphere${i}`,
        shape: "sphere",
        pos: [x, h, 0],
        rot: [0, 0, 0],
        scale: [1, 1, 1],
        args: [r],
        color: col,
        emissive: col,
        emissiveIntensity: emis * 0.45,
        opacity: alpha,
        roughness: rough,
        anim: { bobAmp: num(m, ["BOB"], 0.05), bobSpeed: num(m, ["SPEED", "SPIN"], 1.0) },
        visible: on,
      });
      if (flow) {
        prims.push({
          id: `${sec}:flow${i}`,
          shape: "torus",
          pos: [x, h, 0],
          rot: [0.9 + i * 0.35, 0.4, 0.25],
          scale: [1, 1, 1],
          args: [r * 0.62, Math.max(0.02, r * 0.14)],
          color: col,
          emissive: col,
          emissiveIntensity: emis,
          opacity: Math.min(1, alpha * 1.1),
          additive: true,
          anim: { spinY: 1.1 + i * 0.2, spinZ: 0.7, bobAmp: num(m, ["BOB"], 0.05), bobSpeed: num(m, ["SPEED", "SPIN"], 1.0) },
          visible: on,
        });
      }
    });
    return { prims, radius: Math.max(3, r * 6), centerY: h };
  }

  // 8. Generic fallback for ANY third-party repo object (cylinder, cone, box, or sphere from its dimensions)
  const shape: PrimShape = usage.shapes.has("cylinder")
    ? "cylinder"
    : usage.shapes.has("cone")
      ? "cone"
      : usage.shapes.has("plane")
        ? "plane"
        : usage.shapes.has("box") || m.has("WIDTH") || m.has("DEPTH")
          ? "box"
          : "sphere";
  const w = Math.max(0.2, num(m, ["WIDTH", "SIZE", "RADIUS"], 1.2));
  const h = Math.max(0.2, num(m, ["HEIGHT", "SIZE", "RADIUS"], 1.2));
  const d = Math.max(0.2, num(m, ["DEPTH", "WIDTH", "SIZE"], 1.2));
  const col = ownColor ?? pickColor(["secret", "lamp", "green", "freezer"], "#7fe8d8");
  const args = shape === "box" ? [w, h, d] : shape === "cylinder" ? [w * 0.5, w * 0.5, h] : shape === "cone" ? [w * 0.6, h] : [Math.max(w, h) * 0.5];
  prims.push({
    id: `${sec}:main`,
    shape,
    pos: [0, h * 0.5 + num(m, ["GAP", "Y"], 0), 0],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    args,
    color: col,
    emissive: col,
    emissiveIntensity: num(m, ["EMISSIVE"], 0.35),
    opacity: num(m, ["ALPHA"], 0.92),
    roughness: num(m, ["ROUGH"], 0.4),
    anim: { spinY: num(m, ["SPIN", "SPEED"], 0.25), bobAmp: num(m, ["BOB"], 0) },
    visible: on,
  });
  return { prims, radius: Math.max(3.5, Math.max(w, h, d) * 2.5), centerY: h * 0.5 };
}

/** Builds the full live 3D scene for any loaded repo. */
export function extractDynamicScene(model: Model, edits: Record<string, number>, hidden?: ReadonlySet<string>): DynamicScene {
  const pal = collectPalette(model, edits);
  const { bySection, global } = collectValues(model, edits);
  const bg = pal.single.get("fog") ?? pal.single.get("sky") ?? pal.single.get("bg") ?? "#101828";
  const groundColor = pal.single.get("ground") ?? pal.single.get("floor") ?? "#3c4a42";
  const ambientColor = pal.single.get("moon") ?? pal.single.get("ambient") ?? "#829ff0";
  const keyLightColor = pal.single.get("sunDay") ?? pal.single.get("lamp") ?? "#ffe6b8";

  const objects: DynamicObject[] = [];
  for (const el of model.elements) {
    if (!el.section) continue;
    if (hidden?.has(el.id) || hidden?.has(el.section)) continue;
    const m = bySection.get(el.section) ?? new Map<string, number>();
    const usage = inspectUsage(model, el.section);
    const { prims, radius, centerY } = buildObjectPrims(el, m, global, pal, usage);
    objects.push({ id: el.id, section: el.section, label: el.label, prims, radius, centerY });
  }

  return {
    objects,
    bg,
    groundColor,
    ambientColor,
    keyLightColor,
    isDynamic: model.dynamic && objects.length > 0,
  };
}