import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { DynamicObject, DynamicPrim, DynamicScene } from "@/studio/scene";

const additiveMat = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide } as const;

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

function glowTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.4)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function PrimView({ prim, wireframe, tex }: { prim: DynamicPrim; wireframe: boolean; tex: THREE.Texture }) {
  const ref = useRef<THREE.Group>(null);
  const baseY = prim.pos[1];

  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g || !prim.anim) return;
    const t = clock.elapsedTime;
    if (prim.anim.bobAmp) g.position.y = baseY + Math.sin(t * (prim.anim.bobSpeed ?? 1)) * prim.anim.bobAmp;
    if (prim.anim.spinY) g.rotation.y = prim.rot[1] + t * prim.anim.spinY;
    if (prim.anim.spinZ) g.rotation.z = prim.rot[2] + t * prim.anim.spinZ;
    if (prim.anim.pulseAmp) {
      const s = 1 + Math.sin(t * 2.1) * prim.anim.pulseAmp;
      g.scale.set(prim.scale[0] * s, prim.scale[1] * s, prim.scale[2] * s);
    }
  });

  const particlePts = useMemo(() => {
    if (prim.shape !== "particles") return [];
    const count = Math.max(8, Math.round(prim.args[0] ?? 40));
    const range = prim.args[1] ?? 5;
    const rnd = seeded(19);
    return Array.from({ length: count }, (_, i) => ({
      pos: [(rnd() - 0.5) * range * 2, (rnd() - 0.5) * range * 0.9, (rnd() - 0.5) * range * 2] as [number, number, number],
      color: prim.colors?.[i % prim.colors.length] ?? prim.color,
      s: (prim.args[2] ?? 0.25) * (0.7 + rnd() * 0.8),
    }));
  }, [prim.shape, prim.args, prim.colors, prim.color]);

  if (!prim.visible) return null;

  const matProps = prim.additive
    ? { color: prim.color, opacity: Math.min(1, prim.opacity), ...additiveMat, toneMapped: false, wireframe }
    : {
        color: prim.color,
        emissive: prim.emissive ?? "#000000",
        emissiveIntensity: prim.emissiveIntensity ?? 0,
        roughness: prim.roughness ?? 0.45,
        transparent: prim.opacity < 0.99,
        opacity: Math.max(0.02, Math.min(1, prim.opacity)),
        depthWrite: prim.opacity >= 0.95,
        wireframe,
      };

  return (
    <group ref={ref} position={prim.pos} rotation={prim.rot} scale={prim.scale}>
      {prim.shape === "torus" && (
        <mesh castShadow>
          <torusGeometry args={[Math.max(0.05, prim.args[0] ?? 1.5), Math.max(0.01, prim.args[1] ?? 0.14), 16, 64]} />
          {prim.additive ? <meshBasicMaterial {...matProps} /> : <meshStandardMaterial {...matProps} />}
        </mesh>
      )}
      {prim.shape === "sphere" && (
        <mesh castShadow>
          <sphereGeometry args={[Math.max(0.05, prim.args[0] ?? 0.5), 32, 24]} />
          {prim.additive ? <meshBasicMaterial {...matProps} /> : <meshStandardMaterial {...matProps} />}
        </mesh>
      )}
      {prim.shape === "box" && (
        <mesh castShadow>
          <boxGeometry args={[prim.args[0] ?? 1, prim.args[1] ?? 1, prim.args[2] ?? 1]} />
          {prim.additive ? <meshBasicMaterial {...matProps} /> : <meshStandardMaterial {...matProps} />}
        </mesh>
      )}
      {prim.shape === "cylinder" && (
        <mesh castShadow>
          <cylinderGeometry args={[prim.args[0] ?? 0.5, prim.args[1] ?? 0.5, prim.args[2] ?? 1, 20]} />
          {prim.additive ? <meshBasicMaterial {...matProps} /> : <meshStandardMaterial {...matProps} />}
        </mesh>
      )}
      {prim.shape === "cone" && (
        <mesh castShadow>
          <coneGeometry args={[prim.args[0] ?? 0.6, prim.args[1] ?? 1.2, 20]} />
          {prim.additive ? <meshBasicMaterial {...matProps} /> : <meshStandardMaterial {...matProps} />}
        </mesh>
      )}
      {(prim.shape === "plane" || prim.shape === "mist") && (
        <mesh>
          <planeGeometry args={[prim.args[0] ?? 4, prim.args[1] ?? 2]} />
          <meshBasicMaterial color={prim.color} transparent opacity={Math.min(0.85, prim.opacity)} depthWrite={false} side={THREE.DoubleSide} wireframe={wireframe} />
        </mesh>
      )}
      {prim.shape === "glow" && (
        <sprite scale={[prim.args[0] ?? 3, prim.args[1] ?? 3, 1]}>
          <spriteMaterial map={tex} color={prim.color} opacity={Math.min(1, prim.opacity)} blending={THREE.AdditiveBlending} depthWrite={false} transparent />
        </sprite>
      )}
      {prim.shape === "ring_spheres" &&
        (() => {
          const count = Math.max(1, Math.round(prim.args[0] ?? 8));
          return Array.from({ length: count }, (_, i) => {
          const a = (i / count) * Math.PI * 2;
          const R = prim.args[1] ?? 2;
          const r = Math.max(0.05, prim.args[2] ?? 0.25);
          const col = prim.colors?.[i % prim.colors.length] ?? prim.color;
          return prim.additive ? (
            <sprite key={i} position={[Math.cos(a) * R, 0, Math.sin(a) * R]} scale={[r * 3.5, r * 3.5, 1]}>
              <spriteMaterial map={tex} color={col} opacity={Math.min(1, prim.opacity)} blending={THREE.AdditiveBlending} depthWrite={false} transparent />
            </sprite>
          ) : (
            <mesh key={i} position={[Math.cos(a) * R, 0, Math.sin(a) * R]}>
              <sphereGeometry args={[r, 20, 16]} />
              <meshStandardMaterial color={col} emissive={col} emissiveIntensity={prim.emissiveIntensity ?? 1} roughness={prim.roughness ?? 0.2} transparent opacity={prim.opacity} wireframe={wireframe} />
            </mesh>
          );
          });
        })()}
      {prim.shape === "spiral" &&
        (() => {
          const count = Math.max(4, Math.round(prim.args[0] ?? 32));
          return Array.from({ length: count }, (_, i) => {
          const arm = i % 2;
          const u = i / count;
          const R = (prim.args[1] ?? 3.2) * (0.18 + 0.82 * u);
          const turns = prim.args[2] ?? 1.25;
          const size = Math.max(0.1, prim.args[3] ?? 0.4);
          const a = u * Math.PI * 2 * turns + arm * Math.PI;
          const isOdd = i % 11 === 0 && prim.colors && prim.colors.length > 0;
          const col = isOdd ? prim.colors![(i / 11) % prim.colors!.length]! : prim.color;
          return (
            <sprite key={i} position={[Math.cos(a) * R, (u - 0.3) * 1.4, Math.sin(a) * R]} scale={[size * (isOdd ? 1.8 : 1.2), size * (isOdd ? 1.8 : 1.2), 1]}>
              <spriteMaterial map={tex} color={col} opacity={Math.min(1, prim.opacity)} blending={THREE.AdditiveBlending} depthWrite={false} transparent />
            </sprite>
          );
          });
        })()}
      {prim.shape === "particles" &&
        particlePts.map((pt, i) => (
          <sprite key={i} position={pt.pos} scale={[pt.s * 2.2, pt.s * 2.2, 1]}>
            <spriteMaterial map={tex} color={pt.color} opacity={Math.min(1, prim.opacity)} blending={THREE.AdditiveBlending} depthWrite={false} transparent />
          </sprite>
        ))}
    </group>
  );
}

function DynamicObjectView({ obj, offset, wireframe, tex }: { obj: DynamicObject; offset: [number, number, number]; wireframe: boolean; tex: THREE.Texture }) {
  return (
    <group position={offset}>
      {obj.prims.map((p) => (
        <PrimView key={p.id} prim={p} wireframe={wireframe} tex={tex} />
      ))}
    </group>
  );
}

export function DynamicSceneView({ scene, focusId, wireframe }: { scene: DynamicScene; focusId?: string | undefined; wireframe: boolean }) {
  const tex = useMemo(() => glowTexture(), []);
  const focused = focusId ? scene.objects.find((o) => o.id === focusId) : undefined;
  if (focused) {
    return <DynamicObjectView obj={focused} offset={[0, 0, 0]} wireframe={wireframe} tex={tex} />;
  }
  // World gallery: arrange all discovered visual objects in a clean semicircle so nothing overlaps.
  const count = scene.objects.length;
  return (
    <group>
      {scene.objects.map((obj, i) => {
        const spread = Math.min(Math.PI * 0.85, Math.max(0.6, count * 0.36));
        const a = count <= 1 ? 0 : -spread / 2 + (i / (count - 1)) * spread;
        const dist = count <= 1 ? 0 : 12 + count * 1.4;
        const x = Math.sin(a) * dist;
        const z = -Math.cos(a) * dist + dist * 0.55;
        return <DynamicObjectView key={obj.id} obj={obj} offset={[x, 0, z]} wireframe={wireframe} tex={tex} />;
      })}
    </group>
  );
}