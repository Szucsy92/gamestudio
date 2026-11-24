/**
 * Exact port of `hash(x, z, salt)` from Simulation.kt (32-bit Int overflow semantics),
 * so the preview draws the same random tree the Kotlin game builds.
 */
export function hash(x: number, z: number, salt = 0): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(salt, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295.0;
}
