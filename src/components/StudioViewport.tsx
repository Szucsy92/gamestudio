import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { TREE_GROUND, type TreeMesh } from "@/tree/mesh";
import type { SceneId } from "@/studio/catalog";
import type { Look } from "@/studio/look";

export type CameraView = "full" | "base" | "top" | "crown";

interface Props {
  scene: SceneId;
  mesh: TreeMesh;
  look: Look;
  wireframe: boolean;
  showGround: boolean;
  view: CameraView;
  viewNonce: number;
  /** Pixels covered by the bottom workbench: the picture is shifted up so the subject stays in the free area. */
  bottomInset: number;
  /** Preview pieces that were deleted (structure.ts keys: "gate", "gate.veil" …). */
  hidden?: ReadonlySet<string> | undefined;
}

type Hidden = ReadonlySet<string> | undefined;

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

function barkTexture(): THREE.CanvasTexture {
  const w = 256, h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#4a3426";
  g.fillRect(0, 0, w, h);
  const rnd = seeded(7);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * w, y = rnd() * h, l = 10 + rnd() * 60;
    const shade = 40 + rnd() * 50;
    g.strokeStyle = `rgba(${shade + 30},${shade + 12},${shade - 6},${0.18 + rnd() * 0.25})`;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + (rnd() - 0.5) * 6, y + l / 3, x + (rnd() - 0.5) * 6, y + (2 * l) / 3, x + (rnd() - 0.5) * 4, y + l);
    g.stroke();
  }
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w;
    g.strokeStyle = `rgba(18,10,8,${0.35 + rnd() * 0.3})`;
    g.lineWidth = 1.5 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= h; y += 32) g.lineTo(x + Math.sin(y * 0.05 + i) * 4 + (rnd() - 0.5) * 3, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 9);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function soilTexture(): THREE.CanvasTexture {
  const s = 512;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2b1d18";
  g.fillRect(0, 0, s, s);
  const rnd = seeded(11);
  for (let i = 0; i < 9000; i++) {
    const v = 25 + rnd() * 45;
    g.fillStyle = `rgba(${v + 20},${v + 8},${v},${0.25 + rnd() * 0.4})`;
    g.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(70,96,52,${0.2 + rnd() * 0.3})`;
    g.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 2 + rnd() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(50, 50);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft sprite textures like the game's: a radial glow and a thin ring (accretion veil). */
function radialTexture(kind: "glow" | "ring"): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  if (kind === "glow") {
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
  } else {
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.45, "rgba(255,255,255,0)");
    grad.addColorStop(0.72, "rgba(255,255,255,1)");
    grad.addColorStop(0.85, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function TreeBody({ mesh, wireframe, tint, position = [0, 0, 0] }: { mesh: TreeMesh; wireframe: boolean; tint: string; position?: [number, number, number] }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(mesh.nor, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(mesh.uv, 2));
    g.setIndex(new THREE.BufferAttribute(mesh.idx, 1));
    g.computeBoundingSphere();
    return g;
  }, [mesh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const bark = useMemo(() => barkTexture(), []);
  return (
    <group position={[position[0], position[1] - TREE_GROUND, position[2]]}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial map={bark} color={tint} roughness={0.88} metalness={0} bumpMap={bark} bumpScale={1.6} />
      </mesh>
      {wireframe && (
        <mesh geometry={geometry}>
          <meshBasicMaterial color="#ffc27a" wireframe transparent opacity={0.35} />
        </mesh>
      )}
    </group>
  );
}

function Ground({ tint }: { tint: string }) {
  const soil = useMemo(() => soilTexture(), []);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]} receiveShadow>
      <circleGeometry args={[220, 96]} />
      <meshStandardMaterial map={soil} color={tint} roughness={1} />
    </mesh>
  );
}

const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide } as const;

function Glow({ position, size, color, opacity, tex }: { position: [number, number, number]; size: [number, number]; color: string; opacity: number; tex: THREE.Texture }) {
  return (
    <sprite position={position} scale={[size[0], size[1], 1]}>
      <spriteMaterial map={tex} color={color} opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} transparent />
    </sprite>
  );
}

/** Stone gate, monolith, light ring and lantern side by side, as GameRenderer.drawLandmarks draws them. */
function Landmarks({ look, offset = [0, 0, 0], hidden }: { look: Look; offset?: [number, number, number]; hidden?: Hidden }) {
  const c = look.colors;
  const hd = (k: string) => !!hidden?.has(k);
  const veil = useRef<THREE.MeshBasicMaterial>(null);
  const ring = useRef<THREE.Group>(null);
  const glowTex = useMemo(() => radialTexture("glow"), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (veil.current) veil.current.opacity = Math.max(0, look["gate.veilA"]! + Math.sin(t * look["gate.veilSpeed"]!) * look["gate.veilAmt"]!);
    if (ring.current) ring.current.rotation.y = -t * look["ring.spin"]!;
  });
  const half = look["gate.half"]!;
  const count = Math.max(1, Math.round(look["ring.count"]!));
  return (
    <group position={offset}>
      {/* Stone gate */}
      {!hd("gate") && (
      <group>
        {!hd("gate.posts") && [-1, 1].map((side) => (
          <mesh key={side} position={[side * (half + look["gate.postOut"]!), look["gate.postY"]!, 0]} castShadow>
            <boxGeometry args={[look["gate.postW"]!, look["gate.postH"]!, look["gate.postD"]!]} />
            <meshStandardMaterial color={c.rock} emissive={c.ember} emissiveIntensity={look["gate.emis"]! * 0.15} roughness={look["gate.rough"]!} metalness={look["gate.metal"]!} />
          </mesh>
        ))}
        {!hd("gate.lintel") && (
        <mesh position={[0, look["gate.lintelY"]!, 0]} castShadow>
          <boxGeometry args={[half * 2 + look["gate.lintelOver"]!, look["gate.lintelH"]!, look["gate.lintelD"]!]} />
          <meshStandardMaterial color={c.rock} emissive={c.ember} emissiveIntensity={look["gate.emis"]! * 0.15} roughness={look["gate.rough"]!} metalness={look["gate.metal"]!} />
        </mesh>
        )}
        {!hd("gate.veil") && (
        <mesh position={[0, look["gate.veilY"]!, 0]}>
          <planeGeometry args={[half * 2, look["gate.veilH"]!]} />
          <meshBasicMaterial ref={veil} color={c.pursuer} {...additive} opacity={look["gate.veilA"]!} />
        </mesh>
        )}
        {!hd("gate.glow") && <Glow tex={glowTex} position={[0, look["gate.glowY"]!, 0]} size={[look["gate.glowSize"]! * 0.5, look["gate.glowSize"]! * 0.5]} color={c.ember} opacity={look["gate.glowA"]!} />}
      </group>
      )}
      {/* Monolith */}
      {!hd("mono") && (
      <group position={[-7, 0, 0]}>
        {!hd("mono.block") && (
        <mesh position={[0, look["mono.y"]!, 0]} rotation-y={look["mono.rot"]!} castShadow>
          <boxGeometry args={[look["mono.w"]!, look["mono.h"]!, look["mono.d"]!]} />
          <meshStandardMaterial color={c.rock} emissive={c.secret} emissiveIntensity={look["mono.emis"]!} roughness={0.35} metalness={0.2} />
        </mesh>
        )}
        {!hd("mono.strip") && (
        <mesh position={[0.07, look["mono.stripY"]!, 0.2]} rotation-y={look["mono.rot"]!}>
          <boxGeometry args={[look["mono.stripW"]!, look["mono.stripH"]!, 0.02]} />
          <meshBasicMaterial color={c.secret} toneMapped={false} />
        </mesh>
        )}
        {!hd("mono.glow") && <Glow tex={glowTex} position={[0, 2.4, 0]} size={[look["mono.glowSize"]!, look["mono.glowH"]!]} color={c.secret} opacity={Math.min(1, look["mono.glowA"]!)} />}
      </group>
      )}
      {/* Lantern */}
      {!hd("lant") && (
      <group position={[5.8, 0, 1]}>
        {!hd("lant.post") && (
        <mesh position={[0, look["lant.y"]!, 0]} rotation-z={look["lant.tilt"]!} castShadow>
          <cylinderGeometry args={[look["lant.w"]! / 2, look["lant.w"]! / 2, look["lant.h"]!, 12]} />
          <meshStandardMaterial color={c.trunk} roughness={0.9} />
        </mesh>
        )}
        {!hd("lant.lamp") && (
        <>
        <mesh position={[0.06, look["lamp.y"]!, 0]}>
          <boxGeometry args={[look["lamp.w"]!, look["lamp.h"]!, look["lamp.w"]!]} />
          <meshBasicMaterial color={c.lamp} toneMapped={false} />
        </mesh>
        {!hd("lant.glow") && <pointLight position={[0.06, look["lamp.y"]!, 0]} color={c.lamp} intensity={6} distance={8} />}
        </>
        )}
      </group>
      )}
      {/* Light ring */}
      {!hd("ring") && (
      <group position={[11.5, 0, -1]} ref={ring}>
        {!hd("ring.orbs") && Array.from({ length: count }, (_, m) => {
          const a = (m / count) * Math.PI * 2;
          return (
            <mesh key={m} position={[Math.cos(a) * look["ring.r"]!, look["ring.y"]!, Math.sin(a) * look["ring.r"]!]} scale={[look["ring.w"]!, look["ring.h"]!, look["ring.w"]!]}>
              <sphereGeometry args={[1, 16, 12]} />
              <meshBasicMaterial color={c.green} toneMapped={false} />
            </mesh>
          );
        })}
      </group>
      )}
    </group>
  );
}

function BlackHole({ look, offset = [0, 0, 0], hidden }: { look: Look; offset?: [number, number, number]; hidden?: Hidden }) {
  const c = look.colors;
  const hd = (k: string) => !!hidden?.has(k);
  const body = useRef<THREE.Group>(null);
  const veil = useRef<THREE.Group>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const ringTex = useMemo(() => radialTexture("ring"), []);
  const glowTex = useMemo(() => radialTexture("glow"), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const y = look["hole.h"]! + Math.sin(t * look["hole.bobS"]!) * look["hole.bobA"]!;
    if (body.current) body.current.position.y = y;
    if (veil.current) veil.current.rotation.set(look["hole.tiltX"]! + Math.sin(t * 0.2) * look["hole.tiltAmt"]!, 0, look["hole.tiltZ"]! + Math.sin(t * 0.15) * 0.1, "XYZ");
    rings.current.forEach((m, r) => {
      if (m) m.rotation.z = t * (look["hole.spin"]! - r * look["hole.spinFall"]!) * (r % 2 === 1 ? -1 : 1);
    });
  });
  const list: [number, string, number][] = [
    [look["hole.r1"]!, c.lavender, look["hole.a1"]!],
    [look["hole.r2"]!, c.purple, look["hole.a2"]!],
    [look["hole.r3"]!, c.secret, look["hole.a3"]!],
  ];
  return (
    <group position={offset}>
      {!hd("hole") && (
      <group ref={body} position={[0, look["hole.h"]!, 0]}>
        {!hd("hole.body") && (
        <mesh>
          <sphereGeometry args={[look["hole.r"]!, 48, 32]} />
          <meshBasicMaterial color="#000000" fog={false} />
        </mesh>
        )}
        {!hd("hole.veil") && (
        <group ref={veil}>
          {list.map(([size, color, a], r) => (
            <mesh key={r} ref={(m) => void (rings.current[r] = m)}>
              <planeGeometry args={[size, size]} />
              <meshBasicMaterial map={ringTex} color={color} opacity={Math.min(1, a * 3)} {...additive} fog={false} />
            </mesh>
          ))}
        </group>
        )}
        {!hd("hole.halo") && <Glow tex={glowTex} position={[0, 0, 0]} size={[look["hole.r3"]! * 1.2, look["hole.r3"]! * 1.2]} color={c.purple} opacity={0.25} />}
      </group>
      )}
    </group>
  );
}

function Orb({ look, color, i, position, hidden }: { look: Look; color: string; i: number; position: [number, number, number]; hidden?: Hidden }) {
  const c = look.colors;
  const hd = (k: string) => !!hidden?.has(k);
  const g = useRef<THREE.Group>(null);
  const shell = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Group>(null);
  const tor = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const size = look["orb.size"]! + Math.sin(t * look["orb.pulseS"]! + i) * look["orb.pulseA"]!;
    if (g.current) g.current.position.y = position[1] + look["orb.base"]! + Math.sin(t * look["orb.bobS"]! + i * 2) * look["orb.bobA"]!;
    if (shell.current) {
      shell.current.scale.setScalar(size);
      shell.current.rotation.y = t * look["orb.spin"]!;
    }
    if (inner.current) inner.current.rotation.set(0, t * 0.22 + i, t * 0.11);
    const pulse = 1 + Math.sin(t * 3.1 + i * 1.7) * 0.055;
    const spec: [number, number, number, number][] = [
      [0.52 + Math.sin(t * 1.35 + i) * 0.16, t * look["band1.spin"]! + i, 0.22, look["band1.s"]!],
      [1.08, -t * look["band2.spin"]! + i, 0.82 + Math.sin(t * 1.1 + i) * 0.18, look["band2.s"]!],
      [1.72, t * look["band3.spin"]! + i, -0.58, look["band3.s"]!],
      [0.34, t * look["band4.spin"]! + i * 2, 1.35, look["band4.s"]!],
    ];
    tor.current.forEach((m, k) => {
      if (!m) return;
      const [rx, ry, rz, s] = spec[k]!;
      m.rotation.set(rx, ry, rz, "XYZ");
      m.scale.setScalar(s * pulse);
    });
  });
  const bands: [number, number, string, number][] = [
    [look["torA.R"]!, look["torA.r"]!, c["band1.col"], look["band1.a"]!],
    [look["torB.R"]!, look["torB.r"]!, c["band2.col"], look["band2.a"]!],
    [look["torC.R"]!, look["torC.r"]!, c["band3.col"], look["band3.a"]!],
    [look["torB.R"]!, look["torB.r"]!, c["band4.col"], look["band4.a"]!],
  ];
  return (
    <group ref={g} position={position}>
      {!hd("orb.shell") && (
      <mesh ref={shell}>
        <sphereGeometry args={[1, 48, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} transparent opacity={look["orb.alpha"]!} roughness={0.2} depthWrite={false} />
      </mesh>
      )}
      <group ref={inner}>
        {bands.map(([R, r, col, a], k) => hd(`orb.band${k + 1}`) ? null : (
          <mesh key={k} ref={(m) => void (tor.current[k] = m)}>
            <torusGeometry args={[R, Math.max(0.005, r), 12, 64]} />
            <meshBasicMaterial color={col} opacity={a} {...additive} toneMapped={false} />
          </mesh>
        ))}
      </group>
      {!hd("orb.aura") && <pointLight color={color} intensity={3} distance={5} />}
    </group>
  );
}

function Orbs({ look, offset = [0, 0, 0], spread = 2.4, hidden }: { look: Look; offset?: [number, number, number]; spread?: number; hidden?: Hidden }) {
  const c = look.colors;
  if (hidden?.has("orb")) return null;
  return (
    <group position={offset}>
      {!hidden?.has("orb.freezer") && <Orb look={look} color={c.freezer} i={0} position={[-spread, 0, 0]} hidden={hidden} />}
      {!hidden?.has("orb.ghost") && <Orb look={look} color={c.ghost} i={1} position={[0, 0, 0]} hidden={hidden} />}
      {!hidden?.has("orb.shock") && <Orb look={look} color={c.shock} i={2} position={[spread, 0, 0]} hidden={hidden} />}
    </group>
  );
}

function ViewInset({ inset }: { inset: number }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const shift = Math.min(size.height * 0.4, inset / 2);
    if (shift > 1) cam.setViewOffset(size.width, size.height, 0, shift, size.width, size.height);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height, inset]);
  return null;
}

function viewFor(scene: SceneId, view: CameraView, h: number): { pos: [number, number, number]; target: [number, number, number] } {
  if (scene === "gates") return { pos: [2.5, 4.5, 15], target: [2.2, 2.2, 0] };
  if (scene === "hole") return { pos: [0, 5, 30], target: [0, 3, 0] };
  if (scene === "orbs") return { pos: [0, 1.7, 6], target: [0, 1.2, 0] };
  if (scene === "world") return { pos: [6, 8, 34], target: [0, 4.5, 0] };
  switch (view) {
    case "base":
      return { pos: [7.5, 3.2, 10], target: [0, 1.2, 0] };
    case "top":
      return { pos: [0.01, h * 1.5 + 10, 0.01], target: [0, 0, 0] };
    case "crown":
      return { pos: [h * 0.55, h * 0.75, h * 0.8], target: [0, h * 0.62, 0] };
    default:
      return { pos: [h * 0.95, h * 0.42, h * 1.35], target: [0, h * 0.46, 0] };
  }
}

function CameraRig({ scene, view, nonce, topY }: { scene: SceneId; view: CameraView; nonce: number; topY: number }) {
  const { camera, size } = useThree();
  const controls = useRef<OrbitControlsImpl | null>(null);
  useEffect(() => {
    const v = viewFor(scene, view, Math.max(6, topY - TREE_GROUND));
    // Wide object rows need more distance on a narrow (portrait phone) screen.
    const k = scene === "tree" ? 1 : Math.max(1, 1.25 / (size.width / Math.max(1, size.height)));
    camera.position.set(v.target[0] + (v.pos[0] - v.target[0]) * k, v.target[1] + (v.pos[1] - v.target[1]) * k, v.target[2] + (v.pos[2] - v.target[2]) * k);
    controls.current?.target.set(...v.target);
    controls.current?.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, view, nonce]);
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} minDistance={1.5} maxDistance={160} target={[0, 10, 0]} />;
}

export function StudioViewport({ scene, mesh, look, wireframe, showGround, view, viewNonce, bottomInset, hidden }: Props) {
  const [ready, setReady] = useState(false);
  const c = look.colors;
  const isTree = scene === "tree";
  // The tree workbench keeps its warm dusk light; the game objects are shown in the game's own palette.
  const bg = isTree ? "#33202f" : c.fog;
  const sunEl = (look["sun.maxEl"]! * Math.PI) / 180;
  return (
    <div className="absolute inset-0" data-scene-ready={ready ? "true" : undefined}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [22, 10, 31], fov: 40, near: 0.1, far: 500 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.25 }}
        onCreated={() => requestAnimationFrame(() => setReady(true))}
      >
        <color attach="background" args={[bg]} />
        <fog attach="fog" args={[bg, isTree ? 35 : 45, isTree ? 150 : 170]} />
        {isTree ? (
          <>
            <hemisphereLight args={["#c7a6e6", "#4a3020", 1.1]} />
            <directionalLight position={[-14, 10, -18]} intensity={2.6} color="#ffb46a" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={30} shadow-camera-bottom={-6} shadow-camera-far={80} shadow-bias={-0.0004} />
            <directionalLight position={[16, 14, 12]} intensity={2.0} color="#ffe2c4" />
            <pointLight position={[-6, 1.5, -8]} intensity={40} distance={30} color="#ff9b4a" />
          </>
        ) : (
          <>
            <hemisphereLight args={[c.moon, c.ground, 0.9]} />
            <directionalLight
              position={[-30 * Math.cos(sunEl), 30 * Math.sin(sunEl) + 4, -18]}
              intensity={look["sun.high"]! * 0.8}
              color={c.sunDusk}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-30}
              shadow-camera-right={30}
              shadow-camera-top={30}
              shadow-camera-bottom={-10}
              shadow-camera-far={120}
              shadow-bias={-0.0004}
            />
            <directionalLight position={[12, 14, 16]} intensity={look["moon.high"]! * 0.9} color={c.moon} />
          </>
        )}
        <Environment resolution={128}>
          <Lightformer intensity={1.4} color="#ffb070" position={[-8, 4, -10]} scale={[16, 8, 1]} />
          <Lightformer intensity={0.8} color="#b48cff" position={[0, 12, 6]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
          <Lightformer intensity={0.5} color="#7fb38a" position={[10, 3, 4]} rotation-y={-Math.PI / 2} scale={[10, 6, 1]} />
        </Environment>

        {isTree && <TreeBody mesh={mesh} wireframe={wireframe} tint="#e0bea0" />}
        {scene === "gates" && <Landmarks look={look} hidden={hidden} />}
        {scene === "hole" && <BlackHole look={look} hidden={hidden} />}
        {scene === "orbs" && <Orbs look={look} hidden={hidden} />}
        {scene === "world" && (
          <>
            <TreeBody mesh={mesh} wireframe={wireframe} tint={c.trunk} position={[-9, 0, -4]} />
            <Landmarks look={look} offset={[3, 0, 2]} hidden={hidden} />
            <Orbs look={look} offset={[2, 0, 9]} spread={1.6} hidden={hidden} />
            <BlackHole look={look} offset={[-4, 6, -40]} hidden={hidden} />
          </>
        )}

        {showGround && <Ground tint={isTree ? "#8a6a5c" : c.ground} />}
        {showGround && <ContactShadows position={[0, 0.01, 0]} opacity={0.55} scale={40} blur={2.4} far={6} />}
        <ViewInset inset={bottomInset} />
        <CameraRig scene={scene} view={view} nonce={viewNonce} topY={mesh.topY} />
      </Canvas>
    </div>
  );
}
