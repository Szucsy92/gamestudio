import type { TreeMesh } from "./mesh";

/** Wavefront OBJ of one tree body (positions, UVs, normals), for checking the mesh in Blender or any 3D viewer. */
export function toObj(mesh: TreeMesh, name: string, header: string[] = []): string {
  const out: string[] = header.map((h) => `# ${h}`);
  out.push(`# vertices: ${mesh.vertexCount}, triangles: ${mesh.triangleCount}`, `o ${name}`);
  const f = (v: number) => (Math.abs(v) < 5e-7 ? "0" : v.toFixed(5));
  for (let i = 0; i < mesh.vertexCount; i++) out.push(`v ${f(mesh.pos[i * 3]!)} ${f(mesh.pos[i * 3 + 1]!)} ${f(mesh.pos[i * 3 + 2]!)}`);
  for (let i = 0; i < mesh.vertexCount; i++) out.push(`vt ${f(mesh.uv[i * 2]!)} ${f(mesh.uv[i * 2 + 1]!)}`);
  for (let i = 0; i < mesh.vertexCount; i++) out.push(`vn ${f(mesh.nor[i * 3]!)} ${f(mesh.nor[i * 3 + 1]!)} ${f(mesh.nor[i * 3 + 2]!)}`);
  for (let t = 0; t < mesh.triangleCount; t++) {
    const a = mesh.idx[t * 3]! + 1, b = mesh.idx[t * 3 + 1]! + 1, c = mesh.idx[t * 3 + 2]! + 1;
    out.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
  }
  return out.join("\n") + "\n";
}
