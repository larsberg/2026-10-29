import { generatePalette, paletteStatus, paletteSwatches, reviewPalette, MAX_GENERATED_PALETTES } from './palette-library.js';

export function paletteWorkshopMarkup() {
  return `<div class="palette-workshop">
    <p class="control-heading">Palette workshop</p>
    <p class="camera-hint">Preview on the scene, then approve or reject. Use Pause to hold a palette. Save keeps your reviews and generated palettes.</p>
    <p class="palette-library-count" data-palette-count></p>
    <div class="palette-generate-actions"><button type="button" data-palette-generate>Generate 6</button><button type="button" data-palette-variations>Make 6 variations</button></div>
    <p class="palette-review-feedback" data-palette-feedback role="status" aria-live="polite"></p>
    <div class="palette-review-preview">
      <div class="palette-preview-heading"><strong data-palette-name></strong><span class="palette-status" data-palette-status></span></div>
      <div class="palette-swatches palette-swatches-large" data-palette-swatches></div>
      <label class="palette-rename" data-palette-rename-label hidden>Name<input type="text" maxlength="64" data-palette-rename></label>
      <div class="palette-review-actions"><button type="button" data-palette-approve>Approve</button><button type="button" data-palette-reject>Reject</button></div>
    </div>
    <div class="palette-review-navigation"><button type="button" data-palette-review-previous aria-label="Review previous palette">←</button>
      <label>Show<select data-palette-filter><option value="all">All palettes</option><option value="pending">New / unreviewed</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
      <button type="button" data-palette-review-next aria-label="Review next palette">→</button></div>
    <div class="palette-card-list" data-palette-cards></div>
    <p class="camera-hint" data-palette-empty hidden>No palettes in this view.</p>
  </div>`;
}

export function bindPaletteWorkshop(root, { getLibrary, getPalettes, getCurrentId, preview, change }) {
  const find = selector => root.querySelector(selector);
  const cards = find('[data-palette-cards]'), filter = find('[data-palette-filter]'), feedback = find('[data-palette-feedback]');
  let selectedId = getCurrentId();
  const labels = { approved: 'Approved', pending: 'New', rejected: 'Rejected' };
  const filtered = () => getPalettes().filter(p => filter.value === 'all' || paletteStatus(getLibrary(), p.id) === filter.value);
  const selected = () => getPalettes().find(p => p.id === selectedId);
  function swatches(element, preset) {
    element.replaceChildren(...paletteSwatches(preset).map(hex => {
      const swatch = document.createElement('span'); swatch.style.backgroundColor = hex; swatch.title = hex;
      swatch.setAttribute('aria-label', hex); return swatch;
    }));
  }
  function select(id) { selectedId = id; preview(id); render(); }
  function render() {
    const library = getLibrary(), palettes = getPalettes(), visible = filtered();
    const focusedCard = cards.contains(document.activeElement) ? document.activeElement.dataset.paletteId : null;
    if (!selected()) selectedId = palettes.find(p => p.id === getCurrentId())?.id;
    const preset = selected(), status = preset && paletteStatus(library, preset.id);
    find('[data-palette-count]').textContent = `${library.approved.length} approved · ${library.generated.length} generated · ${library.rejected.length} rejected`;
    find('[data-palette-name]').textContent = preset?.label ?? 'Select a palette';
    const badge = find('[data-palette-status]'); badge.textContent = labels[status] ?? ''; badge.dataset.status = status;
    if (preset) swatches(find('[data-palette-swatches]'), preset);
    else find('[data-palette-swatches]').replaceChildren();
    const custom = library.generated.find(p => p.id === selectedId), name = find('[data-palette-rename]');
    find('[data-palette-rename-label]').hidden = !custom;
    if (custom && document.activeElement !== name) name.value = custom.label;
    find('[data-palette-approve]').disabled = !preset || status === 'approved';
    find('[data-palette-reject]').disabled = !preset || status === 'rejected';
    find('[data-palette-variations]').disabled = !preset || library.generated.length >= MAX_GENERATED_PALETTES;
    find('[data-palette-generate]').disabled = library.generated.length >= MAX_GENERATED_PALETTES;
    for (const direction of ['previous', 'next']) find(`[data-palette-review-${direction}]`).disabled = !visible.length;
    find('[data-palette-empty]').hidden = visible.length > 0;
    cards.replaceChildren(...visible.map(p => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'palette-card'; button.dataset.paletteId = p.id;
      button.setAttribute('aria-pressed', String(p.id === selectedId)); button.setAttribute('aria-label', `Preview ${p.label}`);
      const strip = document.createElement('span'); strip.className = 'palette-swatches'; swatches(strip, p);
      const title = document.createElement('span'); title.className = 'palette-card-name'; title.textContent = p.label;
      const status = document.createElement('span'); status.className = 'palette-status'; status.dataset.status = paletteStatus(library, p.id); status.textContent = labels[status.dataset.status];
      button.append(strip, title, status); return button;
    }));
    if (focusedCard) [...cards.children].find(card => card.dataset.paletteId === focusedCard)?.focus({ preventScroll: true });
  }
  function review(status) {
    if (!selected()) return;
    const label = selected().label;
    change(reviewPalette(getLibrary(), selectedId, status));
    feedback.textContent = `${label} ${status}. Save to retain this review.`;
  }
  function generate(variations) {
    const library = getLibrary(), ids = new Set(getPalettes().map(p => p.id)), candidates = [];
    const source = variations ? selected() : undefined;
    for (let i = 0; i < 6 && library.generated.length + candidates.length < MAX_GENERATED_PALETTES; i++) {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0], candidate = generatePalette(seed, source);
      if (!ids.has(candidate.id)) { candidates.push(candidate); ids.add(candidate.id); }
    }
    if (!candidates.length) return;
    filter.value = 'pending'; selectedId = candidates[0].id;
    change({ ...library, generated: [...library.generated, ...candidates] });
    select(selectedId);
    feedback.textContent = `${candidates.length} new candidates. Only approved palettes enter the rotation.`;
  }
  const abort = new AbortController(), listen = (element, event, callback) => element.addEventListener(event, callback, { signal: abort.signal });
  listen(cards, 'click', event => { const card = event.target.closest('[data-palette-id]'); if (card) select(card.dataset.paletteId); });
  listen(filter, 'change', render);
  listen(find('[data-palette-approve]'), 'click', () => review('approved'));
  listen(find('[data-palette-reject]'), 'click', () => review('rejected'));
  listen(find('[data-palette-generate]'), 'click', () => generate(false));
  listen(find('[data-palette-variations]'), 'click', () => generate(true));
  listen(find('[data-palette-rename]'), 'change', event => {
    const label = event.target.value.trim(); if (!label) { event.target.value = selected().label; return; }
    const library = getLibrary(); change({ ...library, generated: library.generated.map(p => p.id === selectedId ? { ...p, label } : p) });
  });
  for (const [name, direction] of [['previous', -1], ['next', 1]]) listen(find(`[data-palette-review-${name}]`), 'click', () => {
    const choices = filtered(); if (!choices.length) return;
    const index = choices.findIndex(p => p.id === selectedId);
    select(choices[index < 0 ? (direction > 0 ? 0 : choices.length - 1) : (index + direction + choices.length) % choices.length].id);
  });
  function syncPreview() { selectedId = getCurrentId(); render(); }
  listen(root, 'control-tab-change', event => { if (event.detail === 'tab-palettes') { feedback.textContent = ''; syncPreview(); } });
  render();
  return { render, syncPreview, dispose() { abort.abort(); } };
}
