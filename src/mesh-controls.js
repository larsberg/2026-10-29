import { materialControlsMarkup } from './material-controls.js';
import { lightingControlsMarkup } from './lighting-controls.js';
import { infoControlsMarkup } from './info-controls.js';
import { meshFields } from './mesh-settings.js';
import { instrumentControlsMarkup, bindInstrumentControls } from './instrument-controls.js';
import { recordingControlsMarkup } from './recording-controls.js';

const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const paths = {
  pause: 'M8 5v14M16 5v14', play: 'm8 5 11 7-11 7Z',
  restart: 'M3 4v6h6M3 10a8 8 0 1 1 2 8',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8',
  reload: 'M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7M20 7v5l-5-5',
};

function fieldMarkup(group, [key, label, initial, min, max, step]) {
  const id = `${group}-${key}`, data = `data-group="${group}" data-key="${key}"`;
  if (typeof initial === 'boolean') return `<label class="lighting-toggle"><input id="${id}" ${data} type="checkbox">${label}</label>`;
  if (typeof initial === 'string') return `<label class="color-label" for="${id}">${label}<output></output><input id="${id}" ${data} type="color"></label>`;
  if (group === 'camera' || group === 'infoLayout' || (['pipeline', 'lines'].includes(group) && key === 'seed')) return `<label for="${id}">${label}<input id="${id}" ${data} type="number" min="${min}" max="${max}" step="${step}"></label>`;
  return `<label class="slider-label" for="${id}">${label}<output></output></label><input id="${id}" ${data} type="range" min="${min}" max="${max}" step="${step}">`;
}

export function meshControlsMarkup() {
  const fields = group => meshFields[group].map(field => fieldMarkup(group, field)).join('');
  const saveLabel = import.meta.env?.PROD ? 'Save on this device' : 'Save settings';
  const tabs = ['Mesh', 'Audio', 'Materials', 'Lighting', 'Camera', 'Info'];
  return `
    <button class="icon-button drawer-toggle" aria-label="Open controls" title="Open controls" aria-expanded="false" aria-controls="controls-drawer">
      ${icon('m6 6 12 12M18 6 6 18')}
    </button>
    <aside id="controls-drawer" class="control-panel" aria-label="Sketch controls" hidden>
      <div class="drawer-header"><div class="panel-toolbar">
        <button class="icon-button run" aria-label="Pause" title="Pause">${icon(paths.pause)}</button>
        <button class="icon-button restart" aria-label="Reset sketch" title="Reset sketch">${icon(paths.restart)}</button>
        <button class="icon-button save-setup" aria-label="${saveLabel}" title="${saveLabel}">${icon(paths.save)}</button>
        <button class="icon-button reload-setup" aria-label="Reload saved settings" title="Reload saved settings">${icon(paths.reload)}</button>
      </div></div>
      <label class="fps-toggle"><input id="visibility-fps" data-group="visibility" data-key="fps" type="checkbox">Show frame-rate meter</label>
      <div class="control-tabs" role="tablist" aria-label="Control sections">
        ${tabs.map((name, i) => `<button id="tab-${name.toLowerCase()}" role="tab" aria-controls="panel-${name.toLowerCase()}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${name}</button>`).join('')}
      </div>
      <div class="drawer-content">
        <p class="setup-status" role="status" aria-live="polite">Loading settings…</p>
        <fieldset class="panel-body">
          <section id="panel-mesh" role="tabpanel" aria-labelledby="tab-mesh">
            <p class="control-heading">Herd movement</p>
            ${fields('herd')}
            <p class="camera-hint">0 stops new jumps; 1 is the original full force. The herd keeps shuffling between jumps.</p>
            <p class="control-heading">Box union</p>
            <p class="camera-hint">Each blob is made from five random boxes with its own seed. The saved herd seed reproduces every shape. New variation generates a new herd.</p>
            <div class="camera-controls">${fieldMarkup('pipeline', meshFields.pipeline.find(([key]) => key === 'seed'))}</div>
            ${fields('boxes')}
            <button type="button" data-mesh-action="randomize">New variation</button>
            <p class="surface-status camera-hint">No surface loaded.</p>
            <details class="material-group" open><summary>Operation layers</summary>
              <p class="camera-hint">Layers act on the combined mesh. The CSG result already has triangle faces. Enable Dialate, Hexelate, or smoothing to apply the existing operations.</p>
              ${meshFields.pipeline.filter(([key]) => ['enabled','triangulateEnabled','initialDiamondDualEnabled'].includes(key)).map(field => fieldMarkup('pipeline', field)).join('')}
              <details class="material-group"><summary>Additional passes before Hexelate</summary>
                <p class="camera-hint">These optional passes run after Dialate, in the order shown. Boundary triangles and their dual cells can be excluded from inset to preserve the outline.</p>
                ${meshFields.pipeline.filter(([key]) => !['enabled','seed','triangulateEnabled','initialDiamondDualEnabled','hexelateEnabled','hexelateTriangulateEnabled','finalAverageVerticesEnabled','smoothingIterations','smoothingStrength'].includes(key)).map(field => fieldMarkup('pipeline', field)).join('')}
              </details>
              ${meshFields.pipeline.filter(([key]) => ['hexelateEnabled','hexelateTriangulateEnabled','finalAverageVerticesEnabled','smoothingIterations','smoothingStrength'].includes(key)).map(field => fieldMarkup('pipeline', field)).join('')}
              <p class="camera-hint">Hexelate splits diamonds along their short diagonals, then joins face centers into polygon cells. Turn off Split faces within Hexelate to take the direct dual. Smoothing relaxes vertices while preserving any open boundary.</p>
              <p class="layer-stats camera-hint"></p>
              <p class="face-sides camera-hint"></p>
            </details>
            <p class="control-heading">Physics</p>
            <p class="camera-hint">Every kick cues a rear blob to clench and jump. Other grounded blobs hop toward the herd center with Small jump force, as a percentage of Jump force; set it to 0 to stop the small hops. Harmony chords flex the free body joints. Change the tempo in Audio; the rhythm continues when muted. Grab a blob to interrupt its turn. Pause stops the herd; Reset restores its seeded formation.</p>
            ${fieldMarkup('visibility', meshFields.visibility.find(([key]) => key === 'colliders'))}
            ${fields('rigidBody')}
            <p class="control-heading">Mesh operations</p>
            <p class="camera-hint">Operations affect all sculptures. Drag a sculpture to grab it; drag empty space to orbit.</p>
            <div class="field-actions"><button type="button" data-mesh-action="triangulate">Triangulate faces</button><button type="button" data-mesh-action="smooth">Smooth mesh</button><button type="button" data-mesh-action="undo" disabled>Undo</button></div>
            <p class="control-heading">Dual mesh</p>
            <div class="field-actions"><button type="button" data-mesh-action="dualDiamond">Dialate / Diamond</button><button type="button" data-mesh-action="hexelate">Hexelate</button></div>
            <p class="camera-hint">Dual operations replace the whole mesh. Dialate creates a diamond across each shared edge and keeps triangles at open boundaries. Hexelate splits faces and joins their centers around each vertex, preserving the original outline.</p>
            <p class="camera-hint">Resize, Reload, and Reset rebuild the operation layers and clear manual edits. Save retains layer and transform controls.</p>
            <p class="control-heading">Show</p><div class="visibility-controls">
              ${meshFields.visibility.filter(([key]) => !['fps','colliders'].includes(key)).map(field => fieldMarkup('visibility', field)).join('')}
            </div><p class="mesh-stats"></p>
          </section>
          <section id="panel-audio" role="tabpanel" aria-labelledby="tab-audio" hidden>
            <p class="control-heading">Strudel</p>${meshFields.audio.map(field => fieldMarkup('audio', field)).join('')}
            <p class="camera-hint march-audio-status" role="status">Herd · Night romp · touch the scene to start audio.</p>

            <p class="control-heading">Instruments</p>
            <p class="camera-hint">Bass, Harmony and Lead / texture each have their own sound, decay, filter, distortion, reverb and delay controls below. Save retains the sound settings.</p>
            ${instrumentControlsMarkup()}
          </section>
          <section id="panel-materials" role="tabpanel" aria-labelledby="tab-materials" hidden>
            <details class="material-group" open><summary>Distance lines</summary>
              <p class="camera-hint">Body bands use each vertex's original distance from its body center. Hi-hat hits shift them over 50 ms; Offset speed sets the amount per hit. Ground rings follow the live body centers and ignore the offset. Line spacing sets band width. Choose the palette in Lighting.</p>
              ${meshFields.lines.filter(([key]) => !['angle', 'tilt'].includes(key)).map(field => fieldMarkup('lines', field)).join('')}
              <button type="button" class="shuffle-lines">Shuffle line colors</button>
            </details>
            <details class="material-group"><summary>Ground finish</summary>
              ${meshFields.floor.filter(([key]) => ['roughness', 'color'].includes(key)).map(field => fieldMarkup('floor', field)).join('')}
            </details>
            <p class="control-heading">Wireframe overlay</p>
            <label class="lighting-toggle"><input id="materials-wireframe-visible" data-group="visibility" data-key="wireframe" type="checkbox">Show wireframe overlay</label>
            ${fields('appearance')}
            ${materialControlsMarkup()}
          </section>
          <section id="panel-lighting" role="tabpanel" aria-labelledby="tab-lighting" hidden>
            ${lightingControlsMarkup().replaceAll('boxes', 'mesh')}
            <details class="material-group" open><summary>Fog</summary>${fields('fog')}<p class="camera-hint">Fades distant surfaces into the fog color, even with the lights off. Start and end distances are measured from the camera.</p></details>
          </section>
          <section id="panel-camera" role="tabpanel" aria-labelledby="tab-camera" hidden>
            <p class="control-heading">Camera</p><p class="camera-hint">Drag empty space to orbit; scroll or pinch to zoom. Follow uses the surface center, or the origin while the scene is empty. Offsets are relative to that center with Follow on, or world coordinates with Follow off. Your view and Follow setting are saved.</p>
            ${meshFields.camera.filter(([, , value]) => typeof value === 'boolean').map(field => fieldMarkup('camera', field)).join('')}<div class="camera-controls">${meshFields.camera.filter(([, , value]) => typeof value !== 'boolean').map(field => fieldMarkup('camera', field)).join('')}</div><button class="reset-camera">Reset camera</button>
          </section>
          <section id="panel-info" role="tabpanel" aria-labelledby="tab-info" hidden>
            ${recordingControlsMarkup()}
            <p class="control-heading">Tile placement</p><div class="camera-controls">${fields('infoLayout')}</div>
            <p class="camera-hint">The square frame spans whole tiles. Column and row place its upper-left corner on the floor grid. Placement follows the tile size and is included when you save settings.</p>
            ${infoControlsMarkup()}
          </section>
        </fieldset>
      </div>
    </aside>`;
}

export function bindMeshControls(shell, { ui, change, playPause, reset, resetCamera, save, load, meshAction }) {
  const query = selector => shell.querySelector(selector);
  const drawer = query('.control-panel'), toggle = query('.drawer-toggle');
  toggle.hidden = !ui; toggle.disabled = !ui; drawer.inert = !ui;
  shell.classList.toggle('controls-visible', ui);
  function toggleDrawer(open) {
    if (!ui) return;
    drawer.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.title = open ? 'Close controls' : 'Open controls';
    toggle.setAttribute('aria-label', toggle.title);
    (open ? drawer.querySelector('button') : toggle).focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => toggleDrawer(drawer.hidden));
  const keydown = event => {
    if (event.code === 'KeyH' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target.closest?.('input,textarea,select,[contenteditable="true"]')) {
      ui = !ui; toggle.hidden = !ui; toggle.disabled = !ui; drawer.inert = !ui;
      shell.classList.toggle('controls-visible', ui);
      if (ui) toggleDrawer(true);
      else { drawer.hidden = true; toggle.setAttribute('aria-expanded', 'false'); shell.querySelector('.scene-canvas').focus({ preventScroll: true }); }
      event.preventDefault(); return;
    }
    if (event.key === 'Escape' && !drawer.hidden) { toggleDrawer(false); event.preventDefault(); }
  };
  document.addEventListener('keydown', keydown);
  const tabs = [...shell.querySelectorAll('[role="tab"]')];
  function selectTab(tab) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
      query(`#${item.getAttribute('aria-controls')}`).hidden = !active;
    }
    query('.drawer-content').scrollTop = 0;
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
        : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length]
          : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined;
      if (next) { event.preventDefault(); selectTab(next); next.focus({ preventScroll: true }); }
    });
  });
  for (const button of shell.querySelectorAll('[data-mesh-action]')) button.addEventListener('click', () => meshAction(button.dataset.meshAction));
  query('.shuffle-lines').addEventListener('click', () => {
    const seed = (Number(query('#lines-seed').value) + 1 + Math.floor(Math.random() * 1000000)) % 1000001;
    change({ lines: { seed } });
  });
  const inputs = [...shell.querySelectorAll('input[data-group]')];
  const instruments = bindInstrumentControls(shell, change);
  for (const input of inputs) input.addEventListener('input', () => {
    if (!input.checkValidity() || input.value === '') return;
    const value = input.type === 'checkbox' ? input.checked : input.type === 'color' ? input.value : Number(input.value);
    change({ [input.dataset.group]: { [input.dataset.key]: value } });
  });
  for (const [selector, action] of [['.run', playPause], ['.restart', reset], ['.reset-camera', resetCamera]])
    query(selector).addEventListener('click', action);
  query('.save-setup').addEventListener('click', () => save().catch(() => {}));
  query('.reload-setup').addEventListener('click', () => load().catch(() => {}));
  return {
    set(settings, onlyGroup) {
      if (!onlyGroup || onlyGroup === 'visibility') query('#appearance-wireframeColor').disabled = !settings.visibility.wireframe;
      if (!onlyGroup || onlyGroup === 'audio') instruments.set(settings.audio.instruments);
      if (!onlyGroup || onlyGroup === 'fog') {
        query('#fog-near').max = (settings.fog.far - 0.1).toFixed(1);
        query('#fog-far').min = (settings.fog.near + 0.1).toFixed(1);
      }
      for (const input of inputs) {
        const { group, key } = input.dataset;
        if (onlyGroup && group !== onlyGroup) continue;
        const value = settings[group][key];
        if (input.type === 'checkbox') input.checked = value;
        else if (document.activeElement !== input) input.value = typeof value === 'number' ? Number(value.toFixed(input.type === 'number' ? 2 : 4)) : value;
        const output = query(`label[for="${input.id}"] output`);
        if (output) output.value = typeof value === 'number' ? String(Number(value.toFixed(3))) : value;
      }
    },
    meshState({ faces, canUndo, layers = [], faceSides = {} }) {
      query('.surface-status').textContent = faces ? `${faces} faces across the herd.` : 'No surface loaded.';
      query('.layer-stats').textContent = layers.map(stage => `${stage.name}: ${stage.faces} faces`).join(' · ');
      query('.face-sides').textContent = !faces ? '' : `Final polygons · ${Object.entries(faceSides).sort(([a], [b]) => Number(a) - Number(b)).map(([sides, count]) => `${count} with ${sides} sides`).join(' · ')}`;
      for (const button of shell.querySelectorAll('[data-mesh-action]')) {
        button.disabled = button.dataset.meshAction === 'undo' ? !canUndo : !faces && button.dataset.meshAction !== 'randomize';
      }
    },
    status(message, error = false) { const el = query('.setup-status'); el.textContent = message; el.dataset.error = String(error); },
    busy(value) {
      query('.panel-body').disabled = value; query('#visibility-fps').disabled = value;
      query('.save-setup').disabled = value; query('.reload-setup').disabled = value;
    },
    running(value) { const button = query('.run'), label = value ? 'Pause' : 'Play'; button.title = label; button.setAttribute('aria-label', label); button.innerHTML = icon(paths[value ? 'pause' : 'play']); },
    stats(message) { query('.mesh-stats').textContent = message; },
    dispose() { document.removeEventListener('keydown', keydown); },
  };
}
