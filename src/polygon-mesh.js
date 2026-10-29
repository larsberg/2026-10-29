// Editable topology: shared positions and ordered vertex loops of any length.
// Faces remain polygons; drawing their boundaries never introduces diagonals.
export function createViewportMesh(width, height, shortSideSubdivisions = 4) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0))
    throw new Error('Mesh dimensions must be positive finite numbers.');
  if (!Number.isInteger(shortSideSubdivisions) || shortSideSubdivisions < 1 || shortSideSubdivisions > 64)
    throw new Error('Short side subdivisions must be an integer from 1 to 64.');
  const shortSide = Math.min(width, height);
  const columns = Math.max(1, Math.round(width / shortSide * shortSideSubdivisions));
  const rows = Math.max(1, Math.round(height / shortSide * shortSideSubdivisions));
  const vertices = [], faces = [];
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++)
    vertices.push([-width / 2 + width * column / columns, -height / 2 + height * row / rows, 0]);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * (columns + 1) + column;
    faces.push([a, a + 1, a + columns + 2, a + columns + 1]);
  }
  return { vertices, faces, columns, rows, width, height };
}

export function polygonEdges(faces) {
  const edges = new Map();
  for (const face of faces) {
    if (face.length < 3) throw new Error('A face needs at least three vertices.');
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!edges.has(key)) edges.set(key, [a, b]);
    }
  }
  return [...edges.values()];
}

export function viewportDimensions(camera, distance) {
  const height = 2 * distance * Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
  return { width: height * camera.aspect, height };
}
