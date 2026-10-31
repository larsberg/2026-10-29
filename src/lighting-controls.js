import { defaultLighting, lightingGroups } from "./lighting-settings.js";
import { applyStudioPalette, matchingStudioPalette, studioPalettes } from './studio-palettes.js';

export function lightingControlsMarkup() {
  return `<div class="field-select"><label for="studio-palette">Studio palette</label>
    <span class="studio-palette-controls">
      <button type="button" class="palette-previous" aria-label="Previous palette" title="Previous palette">←</button>
      <select id="studio-palette"><option value="custom" disabled>Custom</option>${studioPalettes.map(p => `<option value="${p.id}">${p.label}</option>`).join('')}</select>
      <button type="button" class="palette-next" aria-label="Next palette" title="Next palette">→</button>
    </span></div>
    <p class="camera-hint">Palettes color the projected lines, reflection studio, scene background, and lights. Automatic palette changes are off; manual lighting changes retain 0.3-second fades. Studio background also sets the fog color. Edit colors below to make a custom palette; Save retains it.</p>
    ` + lightingGroups.map(({ key, label, fields }, index) => `
    <details class="material-group" ${index === 0 ? "open" : ""}>
      <summary>${label}</summary>
      ${key === "directional" ? '<p class="camera-hint">Light offsets follow the center of the boxes.</p>' : ""}
      ${key === "spotlight" ? '<p class="camera-hint">Position and aim follow the body. Offsets stay in world space, so the light remains overhead as the mesh rolls.</p>' : ""}
      ${key === "hemisphere" ? '<p class="camera-hint">Tilt: 0° overhead · 90° sideways · 180° below. Yaw turns the tilted direction around the scene.</p>' : ""}
      ${key === "environment" ? '<p class="camera-hint">Seven colored studio planes make the reflected bands. Colors, rotation and environment intensity retain their own controls.</p>' : ""}
      ${key === "occlusion" ? '<p class="camera-hint">Adds contact shading between the boxes and their folds. AO only shows the shading on white. Disable for faster rendering.</p>' : ""}
      ${fields.map(([name, title, initial, min, max, step]) => {
        const id = `lighting-${key}-${name}`;
        if (typeof initial === "boolean") return `<label class="lighting-toggle"><input id="${id}" type="checkbox" ${initial ? "checked" : ""}>${title}</label>`;
        if (typeof initial === "string") return `<label class="color-label" for="${id}">${title}<output>${initial}</output><input id="${id}" type="color" value="${initial}"></label>`;
        return `<label class="slider-label" for="${id}">${title}<output>${initial}</output></label>
          <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${initial}">`;
      }).join("")}
    </details>`).join("");
}

export function bindLightingControls(root, directional, hemisphere, materials, getMaterials, onChange, applyOcclusion, applySceneLighting = () => {}, initialLighting = defaultLighting(), spotlight) {
  const inputs = Object.fromEntries(lightingGroups.map(({ key, fields }) => [key,
    Object.fromEntries(fields.map(([name]) => [name, root.querySelector(`#lighting-${key}-${name}`)])),
  ]));
  let settings = defaultLighting();
  const paletteSelect = root.querySelector('#studio-palette');
  let paletteIndex = -1;
  const center = { x: 0, y: 0, z: 0 };
  function updatePosition(point) {
    center.x = point.x; center.y = point.y; center.z = point.z;
    for (const [key, light] of [['directional', directional], ['spotlight', spotlight]]) if (light) {
      const { offsetX, height, offsetZ } = settings[key];
      light.position.set(center.x + offsetX, center.y + height, center.z + offsetZ);
      light.target.position.set(center.x, center.y, center.z);
    }
  }
  function refreshEnvironment() {
    const values = getMaterials();
    const { enabled, intensity, rotation } = settings.environment;
    for (const [key, material] of Object.entries(materials)) {
      material.envMapIntensity = values[key].envMapIntensity * (enabled ? intensity : 0);
      material.envMapRotation.y = rotation * Math.PI / 180;
    }
    applySceneLighting(settings);
  }
  function apply() {
    for (const { key } of lightingGroups) {
      for (const [name, input] of Object.entries(inputs[key])) {
        settings[key][name] = input.type === "checkbox" ? input.checked : input.type === "color" ? input.value : Number(input.value);
        const output = root.querySelector(`label[for="${input.id}"] output`);
        if (output) output.value = String(settings[key][name]);
      }
    }
    const main = settings.directional, fill = settings.hemisphere;
    directional.visible = main.enabled;
    directional.color.set(main.color);
    directional.intensity = main.intensity;
    directional.castShadow = main.castShadow;
    directional.shadow.radius = main.softness;
    directional.shadow.bias = main.shadowBias;
    directional.shadow.normalBias = main.normalBias;
    if (spotlight) {
      const spot = settings.spotlight;
      spotlight.visible = spot.enabled; spotlight.color.set(spot.color); spotlight.intensity = spot.intensity;
      spotlight.angle = spot.angle * Math.PI / 180; spotlight.penumbra = spot.penumbra;
      spotlight.castShadow = spot.castShadow; spotlight.shadow.radius = spot.softness;
      spotlight.shadow.bias = spot.shadowBias; spotlight.shadow.normalBias = spot.normalBias;
    }
    hemisphere.visible = fill.enabled;
    hemisphere.color.set(fill.skyColor);
    hemisphere.groundColor.set(fill.groundColor);
    hemisphere.intensity = fill.intensity;
    hemisphere.position.setFromSphericalCoords(1, fill.tilt * Math.PI / 180, fill.yaw * Math.PI / 180);
    updatePosition(center);
    refreshEnvironment();
    applyOcclusion(settings.occlusion);
    paletteSelect.value = matchingStudioPalette(settings);
    if (paletteSelect.value !== 'custom') paletteIndex = studioPalettes.findIndex(p => p.id === paletteSelect.value);
  }
  for (const group of Object.values(inputs))
    for (const input of Object.values(group))
      input.addEventListener("input", () => { apply(); onChange(); });
  const controls = {
    get: () => structuredClone(settings), updatePosition, refreshEnvironment,
    set(value) {
      for (const { key } of lightingGroups)
        for (const [name, input] of Object.entries(inputs[key])) {
          if (input.type === "checkbox") input.checked = value[key][name];
          else input.value = value[key][name];
        }
      apply();
    },
  };
  function choosePalette(id) { controls.set(applyStudioPalette(settings, id)); onChange(); }
  paletteSelect.addEventListener('change', () => choosePalette(paletteSelect.value));
  for (const [selector, direction] of [['.palette-previous', -1], ['.palette-next', 1]])
    root.querySelector(selector).addEventListener('click', () => {
      paletteIndex = paletteIndex < 0 ? (direction > 0 ? 0 : studioPalettes.length - 1)
        : (paletteIndex + direction + studioPalettes.length) % studioPalettes.length;
      choosePalette(studioPalettes[paletteIndex].id);
    });
  controls.set(initialLighting);
  return controls;
}
