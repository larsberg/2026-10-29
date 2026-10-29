import { defaultMaterials, validateMaterials } from './setup.js';
import { defaultLighting, validateLighting } from './lighting-settings.js';
import { validateInfo } from './info-settings.js';
import { browserStorage, requestStaticSetup } from './static-setup.js';
import { DEFAULT_FOLLOW_SMOOTHING, MIN_CAMERA_DISTANCE } from './camera.js';
import { validateInstruments, mergeInstruments } from './instrument-settings.js';
import { meshInfo } from './mesh-info.js';
import { rawAudioSettings } from './raw-audio-settings.js';
import { rigidBodyFields, validateRigidBody } from './rigid-body-settings.js';
import { boxFields } from './box-settings.js';

export const meshFields = {
  boxes: boxFields,
  pipeline: [
    ['enabled', 'Apply operation layers', true],
    ['seed', 'Random seed', 1, 0, 1000000, 1],
    ['triangulateEnabled', '1 · Triangulate (random diagonals)', true],
    ['initialDiamondDualEnabled', '2 · Dialate (diamond dual, keep boundary)', false],
    ['faceCenterDualEnabled', 'Additional face-center dual', false],
    ['averageVerticesEnabled', 'Average vertices (fixed boundary)', false],
    ['insetEnabled', 'Inset faces', false],
    ['insetScale', 'Inset scale', 0.5, 0.01, 0.99, 0.01],
    ['excludeInitialBorderTriangles', 'Exclude initial border triangles from inset', true],
    ['subdivisionEnabled', 'Subdivide & smooth (fixed boundary)', false],
    ['subdivisionIterations', 'Subdivision passes', 1, 1, 3, 1],
    ['diamondDualEnabled', 'Diamond dual after smoothing', false],
    ['hexelateTriangulateEnabled', 'Split faces within Hexelate', true],
    ['hexelateEnabled', '3 · Hexelate (face-center dual)', false],
    ['finalAverageVerticesEnabled', '4 · Smooth mesh (fixed boundary)', false],
    ['smoothingIterations', 'Smoothing passes', 4, 1, 20, 1],
    ['smoothingStrength', 'Smoothing strength', 0.5, 0.01, 1, 0.01],
  ],
  rigidBody: rigidBodyFields,
  audio: [
    ['enabled', 'Enable audio', false],
    ['bpm', 'Tempo (BPM)', 120, 40, 200, 0.1],
    ['volume', 'Master volume', 0.55, 0, 1, 0.01],
    ['drums', 'Drums', 0.8, 0, 1, 0.01],
    ['bass', 'Bass', 0.6, 0, 1, 0.01],
    ['keys', 'Harmony', 0.7, 0, 1, 0.01],
    ['melody', 'Lead / texture', 0.65, 0, 1, 0.01],
  ],
  appearance: [
    ['wireframeColor', 'Wireframe color', '#ffffff'],
  ],
  floor: [
    ['roughness', 'Tile roughness', 0.52, 0.02, 1, 0.01],
    ['depth', 'Tile depth', 0, 0, 0.12, 0.001],
    ['tileSize', 'Tile size', 2, 0.5, 5, 0.1],
    ['color', 'Tile color', '#3c6c85'],
  ],
  fog: [
    ['enabled', 'Enable fog', true],
    ['color', 'Background / fog', '#000000'],
    ['near', 'Start distance', 10, 0, 399.9, 0.1],
    ['far', 'End distance', 30, 0.1, 400, 0.1],
  ],
  infoLayout: [
    ['size', 'Size (tiles)', 3, 1, 40, 1],
    ['column', 'Tile column (X)', -1, -1000, 1000, 1],
    ['row', 'Tile row (Z)', -1, -1000, 1000, 1],
  ],
  camera: [
    ['follow', 'Follow the surface', true],
    ['optimizedTextures', 'Use smaller textures', false],
    ['followSmoothing', 'Follow smoothing (s)', DEFAULT_FOLLOW_SMOOTHING, 0, 2, 0.05],
    ['yaw', 'Yaw °', 0, -180, 180, 0.01],
    ['elevation', 'Elevation °', 0, -89.9, 89.9, 0.01],
    ['distance', 'Distance', 34, MIN_CAMERA_DISTANCE, 400, 0.01],
    // Keep the expanded bounds compatible with earlier world-space saves.
    ['offsetX', 'Offset X', 0, -1000000, 1000000, 0.01],
    ['offsetY', 'Offset Y', 0, -1000000, 1000000, 0.01],
    ['offsetZ', 'Offset Z', 0, -1000000, 1000000, 0.01],
    ['fov', 'Field of view °', 42, 20, 80, 0.1],
  ],
  visibility: [
    ['surface', 'Mesh surface', true],
    ['wireframe', 'Mesh wireframe', true],
    ['colliders', 'Show colliders', false],
    ['fps', 'Show frame-rate meter', false],
    ['text', 'Info panel', true],
  ],
};

export function defaultMeshSetup() {
  const lighting = defaultLighting();
  lighting.environment.backgroundColor = '#000000';
  Object.assign(lighting.directional, { enabled: false, color: '#ffd5bc', intensity: 2.6, height: 7, offsetZ: 4, softness: 3, shadowBias: -0.0003 });
  lighting.spotlight.color = '#ffd5bc';
  Object.assign(lighting.hemisphere, { skyColor: '#8bc7ff', groundColor: '#51303b', intensity: 0.7 });
  // Keep occlusion optional; surface lighting and studio reflections are active.
  lighting.occlusion.enabled = false;
  const result = { version: 1, sketch: '2026-10-29', materials: defaultMaterials(), lighting,
    info: structuredClone(meshInfo),
    ...Object.fromEntries(Object.entries(meshFields).map(([group, fields]) => [group, Object.fromEntries(fields.map(([key, , value]) => [key, value]))])) };
  Object.assign(result.audio, rawAudioSettings());
  return result;
}

export function validateMeshSetup(value) {
  if (value?.version !== 1 || value?.sketch !== '2026-10-29') throw new Error('Expected a 2026-10-29 setup (version 1).');
  const result = defaultMeshSetup();
  // Retain the shared editing controls when loading a partial older setup.
  value = { ...value,
    boxes: value.boxes === undefined ? result.boxes : value.boxes,
    pipeline: value.pipeline === undefined ? result.pipeline : value.pipeline,
    rigidBody:validateRigidBody(value.rigidBody) };
  if (value.visibility && value.visibility.surface === undefined) value.visibility = { ...value.visibility, surface: result.visibility.surface };
  if (value.visibility && value.visibility.colliders === undefined) value.visibility = { ...value.visibility, colliders: result.visibility.colliders };
  if (value.pipeline && typeof value.pipeline === 'object') value.pipeline = {
    ...value.pipeline,
    subdivisionEnabled: value.pipeline.subdivisionEnabled === undefined ? result.pipeline.subdivisionEnabled : value.pipeline.subdivisionEnabled,
    subdivisionIterations: value.pipeline.subdivisionIterations === undefined ? result.pipeline.subdivisionIterations : value.pipeline.subdivisionIterations,
    diamondDualEnabled: value.pipeline.diamondDualEnabled === undefined ? result.pipeline.diamondDualEnabled : value.pipeline.diamondDualEnabled,
    hexelateEnabled: value.pipeline.hexelateEnabled === undefined ? result.pipeline.hexelateEnabled : value.pipeline.hexelateEnabled,
    hexelateTriangulateEnabled: value.pipeline.hexelateTriangulateEnabled === undefined ? result.pipeline.hexelateTriangulateEnabled : value.pipeline.hexelateTriangulateEnabled,
    finalAverageVerticesEnabled: value.pipeline.finalAverageVerticesEnabled === undefined ? result.pipeline.finalAverageVerticesEnabled : value.pipeline.finalAverageVerticesEnabled,
    smoothingIterations: value.pipeline.smoothingIterations === undefined ? result.pipeline.smoothingIterations : value.pipeline.smoothingIterations,
    smoothingStrength: value.pipeline.smoothingStrength === undefined ? result.pipeline.smoothingStrength : value.pipeline.smoothingStrength,
    initialDiamondDualEnabled: value.pipeline.initialDiamondDualEnabled === undefined ? result.pipeline.initialDiamondDualEnabled : value.pipeline.initialDiamondDualEnabled,
    triangulateEnabled: value.pipeline.triangulateEnabled === undefined ? result.pipeline.triangulateEnabled : value.pipeline.triangulateEnabled,
    faceCenterDualEnabled: value.pipeline.faceCenterDualEnabled === undefined ? result.pipeline.faceCenterDualEnabled : value.pipeline.faceCenterDualEnabled,
    averageVerticesEnabled: value.pipeline.averageVerticesEnabled === undefined ? result.pipeline.averageVerticesEnabled : value.pipeline.averageVerticesEnabled,
    insetEnabled: value.pipeline.insetEnabled === undefined ? result.pipeline.insetEnabled : value.pipeline.insetEnabled,
    excludeInitialBorderTriangles: value.pipeline.excludeInitialBorderTriangles === undefined ? result.pipeline.excludeInitialBorderTriangles : value.pipeline.excludeInitialBorderTriangles,
  };
  for (const [group, fields] of Object.entries(meshFields)) for (const [key, label, initial, min, max, step] of fields) {
    const field = value[group]?.[key];
    const valid = typeof initial === 'boolean' ? typeof field === 'boolean'
      : typeof initial === 'string' ? typeof field === 'string' && /^#[0-9a-f]{6}$/i.test(field)
      : Number.isFinite(field) && field >= min && field <= max && (step !== 1 || Number.isInteger(field));
    if (!valid) throw new Error(`Invalid ${label}.`);
    result[group][key] = typeof field === 'string' ? field.toLowerCase() : field;
  }
  if (result.fog.far <= result.fog.near) throw new Error('Fog end distance must be greater than its start distance.');
  result.materials = validateMaterials(value.materials);
  result.lighting = validateLighting(value.lighting);
  result.info = validateInfo(value.info);
  result.audio.instruments = validateInstruments(value.audio?.instruments);
  return result;
}

export function mergeMeshSetup(current, patch) {
  if (patch?.version !== undefined || patch?.sketch !== undefined) return validateMeshSetup(patch);
  if(patch?.rigidBody!==undefined)validateRigidBody(patch.rigidBody);
  const next = structuredClone(current);
  for (const group of [...Object.keys(meshFields), 'info']) Object.assign(next[group], patch?.[group]);
  if (patch?.audio?.instruments !== undefined) next.audio.instruments = mergeInstruments(current.audio.instruments, patch.audio.instruments);
  for (const group of ['materials', 'lighting']) for (const [key, value] of Object.entries(patch?.[group] ?? {})) Object.assign(next[group][key], value);
  return validateMeshSetup(next);
}

export async function requestMeshSetup(method = 'GET', value, signal) {
  if (import.meta.env.PROD) return requestStaticSetup({ method, value, signal,
    validate: validateMeshSetup, storage: browserStorage(),
    url: new URL(`${import.meta.env.BASE_URL}setup.json`, location.href).href });
  const response = await fetch(`${import.meta.env.BASE_URL}api/setup`, {
    method, signal, cache: 'no-store', ...(method === 'PUT' ? {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validateMeshSetup(value)),
    } : {}),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Settings request failed (${response.status}).`);
  }
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('Settings API unavailable. Restart the local dev server.');
  return validateMeshSetup(await response.json());
}
