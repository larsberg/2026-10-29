import { ShapeUtils, Vector2, Vector3 } from 'three';

const EPSILON = 1e-10;
const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
const point = (mesh, id) => new Vector3(...mesh.vertices[id]);
const copyMesh = mesh => ({ ...mesh, vertices: mesh.vertices.map(v => [...v]), faces: mesh.faces.map(f => [...f]) });

export function selectedFaceIds(mesh, ids) {
  const result = ids === undefined ? mesh.faces.map((_, id) => id) : [...new Set(ids)];
  if (result.some(id => !Number.isInteger(id) || id < 0 || id >= mesh.faces.length)) throw new Error('Face selection contains an invalid face ID.');
  return result;
}

export function faceFrame(mesh, face) {
  const center = new Vector3(), normal = new Vector3();
  for (let i = 0; i < face.length; i++) {
    const a = point(mesh, face[i]), b = point(mesh, face[(i + 1) % face.length]);
    center.add(a);
    normal.x += (a.y - b.y) * (a.z + b.z);
    normal.y += (a.z - b.z) * (a.x + b.x);
    normal.z += (a.x - b.x) * (a.y + b.y);
  }
  center.multiplyScalar(1 / face.length);
  if (normal.lengthSq() < EPSILON * EPSILON) throw new Error('Cannot operate on a face with zero area.');
  normal.normalize();
  const x = point(mesh, face[1]).sub(point(mesh, face[0])).normalize();
  const y = new Vector3().crossVectors(normal, x).normalize();
  x.crossVectors(y, normal).normalize();
  return { center, x, y, normal };
}

// Ear clipping in a face-local plane handles concave polygons without adding
// vertices. Preserve the source loop's orientation, including reversed faces.
export function triangulateFace(mesh, face) {
  if (face.length === 3) return [[...face]];
  const { center, x, y, normal } = faceFrame(mesh, face);
  const points = face.map(id => point(mesh, id).sub(center));
  const project = (u, v) => points.map(p => new Vector2(p.dot(u), p.dot(v)));
  let contour = project(x, y), triangles = ShapeUtils.triangulateShape(contour, []);
  // A nonplanar polygon can fold out of its Newell plane. Its
  // projection may overlap vertical edges; try another projection
  // only for nonplanar faces, preserving the original cyclic winding.
  const size = Math.max(...points.map(p => p.length()));
  if (triangles.length !== face.length - 2 && points.some(p => Math.abs(p.dot(normal)) > size * 1e-6)) {
    const directions = Array.from({ length: 60 }, (_, i) => {
      const z = (i + 0.5) / 30 - 1, radius = Math.sqrt(1 - z * z);
      const direction = new Vector3(Math.cos(i * 2.4) * radius, Math.sin(i * 2.4) * radius, z);
      return direction.dot(normal) < 0 ? direction.negate() : direction;
    }).sort((a, b) => b.dot(normal) - a.dot(normal));
    for (const direction of directions) {
      const u = x.clone().addScaledVector(direction, -x.dot(direction)).normalize();
      if (u.lengthSq() < 0.5) continue;
      contour = project(u, direction.clone().cross(u));
      triangles = ShapeUtils.triangulateShape(contour, []);
      if (triangles.length === face.length - 2) break;
    }
  }
  if (triangles.length !== face.length - 2) throw new Error('Face cannot be triangulated: check for crossing edges or duplicate points.');
  return triangles.map(triangle => {
    const [a, b, c] = triangle.map(id => contour[id]);
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) triangle.reverse();
    return triangle.map(id => face[id]);
  });
}

export function validatePolygonMesh(mesh) {
  if (!Array.isArray(mesh?.vertices) || !Array.isArray(mesh?.faces)) throw new Error('Expected polygon vertices and faces.');
  for (const v of mesh.vertices) if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new Error('Mesh positions must be finite XYZ coordinates.');
  for (const face of mesh.faces) {
    if (!Array.isArray(face) || face.length < 3 || new Set(face).size !== face.length || face.some(id => !Number.isInteger(id) || !mesh.vertices[id])) throw new Error('Faces need at least three distinct valid vertices.');
    faceFrame(mesh, face);
  }
  return mesh;
}

export function triangulateFaces(mesh, ids, { random, shortestDiagonal = false } = {}) {
  validatePolygonMesh(mesh);
  const selected = new Set(selectedFaceIds(mesh, ids)), result = copyMesh(mesh), faceIds = [], faceSources = [];
  result.faces = [];
  mesh.faces.forEach((face, id) => {
    let loop = face;
    if (selected.has(id) && random && face.length > 3) {
      const value = random();
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Random samples must lie in [0, 1).');
      const offset = Math.floor(value * face.length);
      loop = [...face.slice(offset), ...face.slice(0, offset)];
    }
    let triangles;
    if (selected.has(id) && shortestDiagonal && face.length === 4) {
      const [a, b, c, d] = face;
      triangles = point(mesh, a).distanceToSquared(point(mesh, c)) <= point(mesh, b).distanceToSquared(point(mesh, d))
        ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
      // Keep ear clipping for concave quads whose short diagonal lies outside.
      const normal = faceFrame(mesh, face).normal;
      if (triangles.some(([a, b, c]) => point(mesh, b).sub(point(mesh, a)).cross(point(mesh, c).sub(point(mesh, a))).dot(normal) <= 0)) triangles = triangulateFace(mesh, face);
    } else triangles = selected.has(id) ? triangulateFace(mesh, loop) : [];
    if (selected.has(id)) for (const triangle of triangles) {
      faceSources.push([id]);
      faceIds.push(result.faces.length); result.faces.push(triangle);
    } else { faceSources.push([id]); result.faces.push([...face]); }
  });
  return { mesh: result, faceIds, faceSources };
}

function halfEdges(mesh) {
  validatePolygonMesh(mesh);
  const edges = new Map(), outgoing = mesh.vertices.map(() => []);
  mesh.faces.forEach((face, faceId) => {
    const ring = face.map((a, index) => ({ a, b: face[(index + 1) % face.length], face: faceId }));
    ring.forEach((h, i) => {
      h.previous = ring[(i + ring.length - 1) % ring.length];
      const key = edgeKey(h.a, h.b), old = edges.get(key);
      if (old) {
        if (old.twin || old.a !== h.b) throw new Error('Dual operations require a consistently wound manifold mesh.');
        old.twin = h; h.twin = old;
      } else edges.set(key, h);
      outgoing[h.a].push(h);
    });
  });
  return { edges, outgoing };
}

function vertexRing(outgoing) {
  const boundary = outgoing.filter(h => !h.twin);
  if (boundary.length > 1) throw new Error('Dual operation found a disconnected vertex fan.');
  const start = boundary[0] ?? outgoing[0], ring = [], seen = new Set();
  let h = start;
  while (h && !seen.has(h)) { seen.add(h); ring.push(h); h = h.previous.twin; }
  if (ring.length !== outgoing.length || (h && h !== start)) throw new Error('Dual operation found a disconnected vertex fan.');
  return { ring, open: !h };
}

function compact(mesh) {
  const ids = new Map(), vertices = [];
  const faces = mesh.faces.map(face => face.map(id => {
    if (!ids.has(id)) { ids.set(id, vertices.length); vertices.push(mesh.vertices[id]); }
    return ids.get(id);
  }));
  return { ...mesh, vertices, faces };
}

// One diamond across every interior edge. Boundary edges retain a triangle,
// so an open viewport mesh keeps its original outline rather than shrinking.
export function dualDiamond(mesh, { quadsOnly = false } = {}) {
  const { edges, outgoing } = halfEdges(mesh);
  outgoing.filter(ring => ring.length).forEach(vertexRing);
  const result = copyMesh(mesh), centers = mesh.faces.map(face => faceFrame(mesh, face).center.toArray());
  const offset = result.vertices.length;
  result.vertices.push(...centers);
  result.faces = [...edges.values()].filter(h => !quadsOnly || h.twin).map(h => h.twin
    ? [h.a, offset + h.twin.face, h.b, offset + h.face]
    : [h.a, h.b, offset + h.face]);
  const vertexSources = [...new Set(result.faces.flat())].map(id => id < offset ? [id] : [...mesh.faces[id - offset]]);
  return { mesh: compact(result), faceIds: [], vertexSources };
}

// Follow half-edge connectivity instead of sorting angles: rings remain
// topologically ordered on folded 3D surfaces. Clip boundary cells with shared
// edge midpoints and retain original corners to preserve the viewport outline.
export function dualNSided(mesh) {
  const { edges, outgoing } = halfEdges(mesh);
  const vertices = mesh.faces.map(face => faceFrame(mesh, face).center.toArray()), faces = [], faceSources = [], midpoints = new Map();
  const sources = mesh.faces.map(face => [...face]);
  for (const [key, h] of edges) if (!h.twin) {
    midpoints.set(key, vertices.length);
    vertices.push(point(mesh, h.a).add(point(mesh, h.b)).multiplyScalar(0.5).toArray());
    sources.push([h.a, h.b]);
  }
  outgoing.forEach((list, vertex) => {
    if (!list.length) return;
    const { ring, open } = vertexRing(list);
    faceSources.push(ring.map(h => h.face));
    const face = ring.map(h => h.face);
    if (open) {
      const first = ring[0], last = ring.at(-1).previous;
      const a = midpoints.get(edgeKey(first.a, first.b)), b = midpoints.get(edgeKey(last.a, last.b));
      face.unshift(a); face.push(b);
      const origin = point(mesh, vertex), u = new Vector3(...vertices[a]).sub(origin), v = new Vector3(...vertices[b]).sub(origin);
      if (new Vector3().crossVectors(u, v).lengthSq() > EPSILON * EPSILON * u.lengthSq() * v.lengthSq() || u.dot(v) >= 0) {
        face.push(vertices.length); vertices.push(origin.toArray());
        sources.push([vertex]);
      }
    }
    if (face.length < 3) throw new Error('Dual operation requires at least three faces around an interior vertex.');
    faces.push(face);
  });
  const vertexSources = [...new Set(faces.flat())].map(id => sources[id]);
  return { mesh: compact({ ...mesh, vertices, faces }), faceIds: [], faceSources, vertexSources };
}

// Concave boundary cells can have a vertex average outside their visibility
// kernel. Use an interior center there so a scaled inset does not fold outward.
function interiorFaceCenter(mesh, face) {
  const frame = faceFrame(mesh, face);
  const contour = face.map(id => {
    const p = point(mesh, id).sub(frame.center);
    return new Vector2(p.dot(frame.x), p.dot(frame.y));
  });
  const side = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (contour.every((a, i) => side(a, contour[(i + 1) % contour.length], new Vector2()) > EPSILON)) return frame.center;
  const xs = contour.map(p => p.x), ys = contour.map(p => p.y);
  let kernel = [new Vector2(Math.min(...xs), Math.min(...ys)), new Vector2(Math.max(...xs), Math.min(...ys)),
    new Vector2(Math.max(...xs), Math.max(...ys)), new Vector2(Math.min(...xs), Math.max(...ys))];
  contour.forEach((a, i) => {
    const b = contour[(i + 1) % contour.length], next = [];
    kernel.forEach((p, j) => {
      const q = kernel[(j + 1) % kernel.length], d = side(a, b, p), e = side(a, b, q);
      if (d >= 0) next.push(p);
      if ((d >= 0) !== (e >= 0)) next.push(p.clone().lerp(q, d / (d - e)));
    });
    kernel = next;
  });
  if (!kernel.length) throw new Error('Face has no interior center suitable for inset or subdivision.');
  const center = kernel.reduce((sum, p) => sum.add(p), new Vector2()).divideScalar(kernel.length);
  return frame.center.clone().addScaledVector(frame.x, center.x).addScaledVector(frame.y, center.y);
}

export function insetFaces(mesh, ids, scale = 0.5) {
  if (!Number.isFinite(scale) || scale <= 0 || scale >= 1) throw new Error('Inset scale must be between 0 and 1.');
  validatePolygonMesh(mesh);
  const selected = new Set(selectedFaceIds(mesh, ids));
  const result = copyMesh(mesh), faceIds = [];
  result.faces = [];
  mesh.faces.forEach((face, id) => {
    if (!selected.has(id)) { result.faces.push([...face]); return; }
    const center = interiorFaceCenter(mesh, face), { normal } = faceFrame(mesh, face);
    const inner = face.map(vertex => {
      const offset = point(mesh, vertex).sub(center);
      // Contract within the face plane, retaining any normal displacement.
      const moved = center.clone().addScaledVector(offset, scale).addScaledVector(normal, offset.dot(normal) * (1 - scale));
      result.vertices.push(moved.toArray()); return result.vertices.length - 1;
    });
    faceIds.push(result.faces.length); result.faces.push(inner);
    face.forEach((vertex, i) => {
      const next = (i + 1) % face.length;
      result.faces.push([vertex, face[next], inner[next], inner[i]]);
    });
  });
  validatePolygonMesh(result);
  return { mesh: compact(result), faceIds };
}

// One simultaneous neighbor-average update. Only actual polygon edges define
// neighbors; boundary vertices keep their original XYZ positions exactly.
export function averageVertices(mesh, ids, { iterations = 1, strength = 1 } = {}) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) throw new Error('Smoothing passes must be an integer from 1 to 20.');
  if (!Number.isFinite(strength) || strength <= 0 || strength > 1) throw new Error('Smoothing strength must be greater than zero and at most one.');
  const { edges, outgoing } = halfEdges(mesh);
  outgoing.filter(list => list.length).forEach(vertexRing);
  const faceIds = selectedFaceIds(mesh, ids), neighbors = mesh.vertices.map(() => new Set()), boundary = new Set();
  for (const h of edges.values()) {
    neighbors[h.a].add(h.b); neighbors[h.b].add(h.a);
    if (!h.twin) { boundary.add(h.a); boundary.add(h.b); }
  }
  const result = copyMesh(mesh);
  for (let pass = 0; pass < iterations; pass++) {
    const previous = result.vertices;
    result.vertices = previous.map((position, id) => {
      if (boundary.has(id) || !neighbors[id].size) return [...position];
      const average = [...neighbors[id]].reduce((sum, neighbor) => sum.add(new Vector3(...previous[neighbor])), new Vector3()).divideScalar(neighbors[id].size);
      return strength === 1 ? average.toArray() : new Vector3(...position).lerp(average, strength).toArray();
    });
  }
  validatePolygonMesh(result);
  return { mesh: result, faceIds };
}

// Catmull–Clark over the whole surface. IDs track selected source faces rather
// than restricting subdivision, so adjacent faces always share refined edges.
// Boundary vertices stay fixed; boundary edge points are exact midpoints.
export function subdivideSmooth(mesh, ids, { iterations = 1 } = {}) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 3) throw new Error('Subdivision passes must be an integer from 1 to 3.');
  let result = mesh, selected = selectedFaceIds(mesh, ids), sourceFaces = mesh.faces.map((_, id) => id);
  const vertexStages = [];
  for (let pass = 0; pass < iterations; pass++) {
    const { edges, outgoing } = halfEdges(result);
    outgoing.filter(list => list.length).forEach(vertexRing);
    if (result.faces.reduce((sum, face) => sum + face.length, 0) > 50000) throw new Error('Subdivision exceeds the 50,000-face editing limit. Reduce grid subdivisions or subdivision passes.');
    const centers = result.faces.map(face => interiorFaceCenter(result, face));
    const boundary = new Set(), incident = result.vertices.map(() => []), edgeIds = new Map();
    for (const h of edges.values()) {
      incident[h.a].push(h); incident[h.b].push(h);
      if (!h.twin) { boundary.add(h.a); boundary.add(h.b); }
    }
    const vertices = result.vertices.map((position, id) => {
      if (boundary.has(id) || !outgoing[id].length) return [...position];
      const n = outgoing[id].length;
      const averageFace = outgoing[id].reduce((sum, h) => sum.add(centers[h.face]), new Vector3()).divideScalar(n);
      const averageEdge = incident[id].reduce((sum, h) => sum.add(point(result, h.a).add(point(result, h.b)).multiplyScalar(0.5)), new Vector3()).divideScalar(incident[id].length);
      return averageFace.addScaledVector(averageEdge, 2).addScaledVector(point(result, id), n - 3).divideScalar(n).toArray();
    });
    for (const [key, h] of edges) {
      const value = point(result, h.a).add(point(result, h.b));
      if (h.twin) value.add(centers[h.face]).add(centers[h.twin.face]).multiplyScalar(0.25);
      else value.multiplyScalar(0.5);
      edgeIds.set(key, vertices.length); vertices.push(value.toArray());
    }
    const centerOffset = vertices.length;
    vertexStages.push([...result.vertices.map((_, id) => [id]), ...[...edges.values()].map(h => [h.a, h.b]), ...result.faces.map(face => [...face])]);
    vertices.push(...centers.map(center => center.toArray()));
    const faces = [], faceIds = [], sources = [], parents = [], selectedSet = new Set(selected);
    result.faces.forEach((face, id) => face.forEach((vertex, corner) => {
      if (selectedSet.has(id)) faceIds.push(faces.length);
      sources.push(sourceFaces[id]);
      parents.push(id);
      faces.push([vertex, edgeIds.get(edgeKey(vertex, face[(corner + 1) % face.length])), centerOffset + id,
        edgeIds.get(edgeKey(face[(corner + face.length - 1) % face.length], vertex))]);
    }));
    const linear = [...result.vertices.map(v => [...v]), ...[...edges.values()].map(h => point(result, h.a).add(point(result, h.b)).multiplyScalar(0.5).toArray()), ...centers.map(center => center.toArray())];
    const sourceNormals = result.faces.map(face => faceFrame(result, face).normal);
    const candidate = { ...result, vertices, faces };
    const unfolded = () => faces.every((face, id) => {
      try {
        return faceFrame(candidate, face).normal.dot(sourceNormals[parents[id]]) > EPSILON && triangulateFace(candidate, face).length === 2;
      } catch { return false; }
    });
    // Pinning a concave boundary can make the unrestricted smooth update cross
    // an edge. Back off toward linear subdivision until every quad is valid.
    const smooth = vertices.map(v => [...v]);
    let strength = 1;
    while (!unfolded()) {
      strength *= 0.5;
      if (strength < 1 / 4096) throw new Error('Subdivision would fold a face along the fixed boundary.');
      candidate.vertices = smooth.map((v, id) => v.map((value, axis) => linear[id][axis] + strength * (value - linear[id][axis])));
    }
    result = candidate; selected = faceIds; sourceFaces = sources;
    validatePolygonMesh(result);
  }
  return { mesh: result, faceIds: selected, sourceFaces, vertexStages };
}
