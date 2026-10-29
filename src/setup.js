export const materialFields = [
  ["metalness", "Metalness", 0, 1, 0.01, 0.35],
  ["roughness", "Roughness", 0, 1, 0.01, 0.8],
  ["emissiveIntensity", "Emissive strength", 0, 5, 0.01, 0],
  ["envMapIntensity", "Environment intensity", 0, 3, 0.01, 1],
  ["opacity", "Opacity", 0, 1, 0.01, 1],
];
export const materialFieldsFor = group => group === 'mesh' ? [...materialFields, ['normalMix', 'Flat → smooth normals', 0, 1, 0.01, 0.47]] : materialFields;
export const materialGroups = [["mesh", "Mesh · Blobby finish"], ["text", "Text prop"]];
export function defaultMaterials() {
  const standard = { ...Object.fromEntries(materialFields.map(([key, , , , , value]) => [key, value])),
    color: '#ffffff', emissive: '#ffffff', wireframe: false, flatShading: false };
  return { mesh: { ...standard, metalness: 0.88, roughness: 0.37, flatShading: true, normalMix: 0.47 },
    text: { ...standard,
    color: "#000000", emissive: "#ffffff", wireframe: false, flatShading: false,
    roughness: 1, metalness: 0, envMapIntensity: 0 } };
}

export function validateMaterials(value) {
  const result = defaultMaterials();
  if (value?.mesh === undefined) value = { ...value, mesh: result.mesh };
  for (const [group, defaults] of Object.entries(result)) for (const [key, initial] of Object.entries(defaults)) {
    const field = value?.[group]?.[key], range = materialFieldsFor(group).find(([name]) => name === key);
    const valid = range ? Number.isFinite(field) && field >= range[2] && field <= range[3]
      : typeof initial === 'boolean' ? typeof field === 'boolean'
      : typeof initial === 'number' ? field === initial
      : typeof field === 'string' && /^#[0-9a-f]{6}$/i.test(field);
    if (!valid) throw new Error(`Invalid ${group}.${key}.`);
    result[group][key] = typeof field === 'string' ? field.toLowerCase() : field;
  }
  return result;
}
