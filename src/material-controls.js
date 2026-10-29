import { defaultMaterials, materialFieldsFor, materialGroups } from "./setup.js";

export function materialControlsMarkup() {
  const defaults = defaultMaterials();
  return materialGroups.map(([group, name], index) => {
    const values = defaults[group];
    const colors = [
      ["color", group === "text" ? "Text color" : "Color tint"],
      ["emissive", "Emissive color"],
    ];
    return `<details class="material-group" ${index === 0 ? "open" : ""}>
      <summary>${name}</summary>
      <p class="camera-hint">${group === 'mesh' ? 'Blobby mesh material. With Flat shading on, blend from flat polygon faces (0) to smooth normals (1). Turning Flat shading off uses smooth normals.' : 'Text surface'}</p>
      ${colors.map(([key, label]) => `<label class="color-label" for="material-${group}-${key}">
        ${label}<output>${values[key]}</output><input id="material-${group}-${key}" type="color" value="${values[key]}">
      </label>`).join("")}
      ${materialFieldsFor(group).map(([key, label, min, max, step]) => `
        <label class="slider-label" for="material-${group}-${key}">${label} <output>${values[key]}</output></label>
        <input id="material-${group}-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${values[key]}">`).join("")}
      <div class="visibility-controls material-toggles">
        ${[["wireframe", "Wireframe"], ["flatShading", "Flat shading"]].map(([key, label]) =>
          `<label><input id="material-${group}-${key}" type="checkbox">${label}</label>`).join("")}
      </div>
    </details>`;
  }).join("");
}

// One editor implementation shared by the skin and info surfaces.
export function bindMaterialControls(root, materials, onChange) {
  const defaults = defaultMaterials();
  const inputs = Object.fromEntries(materialGroups.map(([group]) => [group,
    Object.fromEntries(Object.keys(defaults[group]).filter(key => root.querySelector(`#material-${group}-${key}`)).map(key =>
      [key, root.querySelector(`#material-${group}-${key}`)])),
  ]));
  function get() {
    return Object.fromEntries(materialGroups.map(([group]) => [group,
      { ...defaults[group], ...Object.fromEntries(Object.entries(inputs[group]).map(([key, input]) => [key,
        input.type === "checkbox" ? input.checked : input.type === "range" ? Number(input.value) : input.value,
      ])) },
    ]));
  }
  function apply() {
    const settings = get();
    for (const [group] of materialGroups) {
      const material = materials[group], values = settings[group];
      const transparent = group === "text" || values.opacity < 1;
      if (material.flatShading !== values.flatShading || material.transparent !== transparent)
        material.needsUpdate = true;
      material.transparent = transparent;
      material.depthWrite = !transparent;
      material.color.set(values.color);
      material.emissive.set(values.emissive);
      material.wireframe = values.wireframe;
      material.flatShading = values.flatShading;
      for (const [key] of materialFieldsFor(group)) {
        if (key === 'normalMix') material.userData.normalMix = values[key];
        else material[key] = values[key];
      }
      for (const [key, input] of Object.entries(inputs[group])) {
        const output = root.querySelector(`label[for="${input.id}"] output`);
        if (output) output.value = String(values[key]);
      }
    }

  }
  for (const group of Object.values(inputs))
    for (const input of Object.values(group))
      input.addEventListener("input", () => { apply(); onChange(); });
  apply();
  return {
    get,
    set(settings) {
      for (const [group] of materialGroups)
        for (const [key, input] of Object.entries(inputs[group])) {
          if (input.type === "checkbox") input.checked = settings[group][key];
          else input.value = settings[group][key];
        }
      apply();
    },
  };
}
