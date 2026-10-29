import { averageVertices, dualDiamond, dualNSided, insetFaces, subdivideSmooth, triangulateFace, triangulateFaces, validatePolygonMesh } from './mesh-operations.js';

export function createSeededRandom(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Random seed must be an unsigned 32-bit integer.');
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function createMeshLayers(base, { enabled = true, seed = 1, insetScale = 0.5,
  initialDiamondDualEnabled = true, triangulateEnabled = true, faceCenterDualEnabled = true, averageVerticesEnabled = true, insetEnabled = true,
  subdivisionEnabled = true, subdivisionIterations = 1, diamondDualEnabled = true, hexelateTriangulateEnabled = true, hexelateEnabled = true, finalAverageVerticesEnabled = true, smoothingIterations = 1, smoothingStrength = 1, excludeInitialBorderTriangles = true } = {}) {
  if (!enabled) return { mesh: base, faceIds: [], stages: [] };
  if (!Number.isFinite(insetScale) || insetScale <= 0 || insetScale >= 1) throw new Error('Inset scale must be between 0 and 1.');
  const stages = [], record = (name, result) => {
    if (result.mesh.faces.length > 50000) throw new Error('The layered mesh exceeds the 50,000-face editing limit. Reduce grid subdivisions or subdivision passes.');
    if (name === 'Diamond dual' || name === 'Hexelate · face-center dual') {
      try { validatePolygonMesh(result.mesh); for (const face of result.mesh.faces) triangulateFace(result.mesh, face); }
      catch { throw new Error(`${name === 'Diamond dual' ? name : 'Hexelate'} produced a folded polygon. Enable Inset faces or Subdivide & smooth.`); }
    }
    stages.push({ name, vertices: result.mesh.vertices.length, faces: result.mesh.faces.length, selected: result.faceIds.length });
    return result;
  };
  // Triangulate the base quads before building a diamond across every edge.
  const triangles = triangulateEnabled ? record('Random triangulate',
    triangulateFaces(base, undefined, { random: createSeededRandom(seed) })) : { mesh: base };
  let initial = triangles.mesh;
  if (initialDiamondDualEnabled) {
    initial = record('Dialate · diamond dual · keep boundary', dualDiamond(initial)).mesh;
  }
  const borderTriangles = new Set(initialDiamondDualEnabled && excludeInitialBorderTriangles
    ? initial.faces.flatMap((face, id) => face.length === 3 ? [id] : []) : []);
  const dual = faceCenterDualEnabled ? record('Face-center dual', dualNSided(initial)) : { mesh: initial };
  // A dual face mixes its incident source faces. Skip the whole cell if any
  // source belongs to an original border triangle, preserving a connected rim.
  const protectedFaces = faceCenterDualEnabled ? new Set(dual.faceSources.flatMap((sources, id) => sources.some(source => borderTriangles.has(source)) ? [id] : [])) : borderTriangles;
  const targets = dual.mesh.faces.flatMap((_, id) => protectedFaces.has(id) ? [] : [id]);
  const averaged = averageVerticesEnabled ? record('Average vertices · fixed boundary', averageVertices(dual.mesh, targets)) : { mesh: dual.mesh, faceIds: targets };
  const inset = insetEnabled ? record('Inset caps', insetFaces(averaged.mesh, averaged.faceIds, insetScale)) : averaged;
  const smoothed = subdivisionEnabled ? record('Subdivide & smooth · fixed boundary', subdivideSmooth(inset.mesh, inset.faceIds, { iterations: subdivisionIterations })) : inset;
  const diamond = diamondDualEnabled ? record('Diamond dual', dualDiamond(smoothed.mesh)) : smoothed;
  // Split a diamond along its short diagonal, joining adjacent triangle centers.
  // Their valence becomes six before the dual creates the hexagonal cells.
  // Keep preparation inside this operation so disabling it reveals Dialate.
  const prepared = hexelateEnabled && hexelateTriangulateEnabled ? triangulateFaces(diamond.mesh, undefined,
    { shortestDiagonal: true }) : diamond;
  const hexelated = hexelateEnabled ? record('Hexelate · face-center dual', dualNSided(prepared.mesh)) : prepared;
  const final = finalAverageVerticesEnabled ? record('Smooth mesh · fixed boundary',
    { ...hexelated, ...averageVertices(hexelated.mesh, hexelated.faceIds, { iterations: smoothingIterations, strength: smoothingStrength }) }) : hexelated;
  if (hexelateTriangulateEnabled && hexelateEnabled) {
    try { validatePolygonMesh(final.mesh); for (const face of final.mesh.faces) triangulateFace(final.mesh, face); }
    catch { throw new Error('Hexelate produced a folded polygon. Enable Inset faces or Subdivide & smooth, or disable Split faces within Hexelate.'); }
  }
  if (final.mesh.faces.length > 50000) throw new Error('The layered mesh exceeds the 50,000-face editing limit. Reduce grid subdivisions or subdivision passes.');
  return { mesh: final.mesh, faceIds: final.faceIds, stages };
}
