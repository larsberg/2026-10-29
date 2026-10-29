export function validateManifest(value) {
  const fail = message => { throw new Error(`${value?.id ?? 'sketch'}: ${message}`); };
  if (value?.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)) fail('id must be a lowercase slug');
  if (typeof value.title !== 'string' || !value.title.trim()) fail('title is required');
  if (!['year', 'day'].includes(value.datePrecision)) fail('datePrecision must be year or day');
  if (value.datePrecision === 'year' ? !/^\d{4}$/.test(value.date) : !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || new Date(value.date).toISOString().slice(0,10) !== value.date) fail('invalid date');
  for (const [name, path] of Object.entries({entry: value.entry, thumbnail: value.thumbnail?.src, embed: value.embed?.src})) {
    if (typeof path !== 'string' || !path.startsWith('./') || path.includes('..') || path.includes('\\')) fail(`${name} must be a relative ./ URL`);
  }
  if (!Number.isInteger(value.thumbnail.width) || value.thumbnail.width < 1 || !Number.isInteger(value.thumbnail.height) || value.thumbnail.height < 1) fail('thumbnail dimensions are required');
  if (!['none', 'gesture-required', 'unknown'].includes(value.audio)) fail('invalid audio capability');
  if (!Array.isArray(value.embed.allow) || value.embed.allow.some(p => !['autoplay', 'fullscreen', 'camera', 'microphone'].includes(p))) fail('invalid iframe permissions');
  if (!Array.isArray(value.embed.controls)) fail('embed.controls must be an array');
  return value;
}

export function catalogueEntry(manifest) {
  const prefix = `./${manifest.id}/`;
  return {
    ...manifest,
    manifest: `${prefix}sketch.json`,
    entry: prefix + manifest.entry.slice(2),
    thumbnail: { ...manifest.thumbnail, src: prefix + manifest.thumbnail.src.slice(2) },
    embed: { ...manifest.embed, src: prefix + manifest.embed.src.slice(2) },
  };
}

// The gallery now edits content/sketches.json, independently of sketch.json.
// Generate its ready-to-add entry from the same metadata used by the player.
export function siteEntry(manifest) {
  const base = new URL(manifest.url);
  return {
    id: manifest.id,
    title: manifest.title,
    slug: manifest.id,
    aliases: [],
    hidden: false,
    date: manifest.date,
    datePrecision: manifest.datePrecision,
    thumbnail: { ...manifest.thumbnail, src: new URL(manifest.thumbnail.src, base).href },
    runtimeUrl: new URL(manifest.embed.src, base).href,
    standaloneUrl: new URL(manifest.entry, base).href,
    iframeAllow: manifest.embed.allow.join('; '),
    madeWith: manifest.madeWith,
    sidebarPattern: 'waves',
    sidebarTone: 'dark',
    sidebar: { textColor: '#ffffff', backgroundColor: '#000000af' },
  };
}

export function resolveEntry(entry, documentUrl) {
  validateManifest(entry);
  const resolve = relative => {
    const url = new URL(relative, documentUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL protocol');
    return url.href;
  };
  return {
    ...entry,
    manifest: entry.manifest ? resolve(entry.manifest) : documentUrl,
    entry: resolve(entry.entry),
    thumbnail: { ...entry.thumbnail, src: resolve(entry.thumbnail.src) },
    embed: { ...entry.embed, src: resolve(entry.embed.src) },
  };
}

export async function loadCatalogue(url, options = {}) {
  const response = await fetch(url, { signal: options.signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`Catalogue request failed (${response.status})`);
  const data = await response.json();
  if (data.schemaVersion !== 1 || !Array.isArray(data.sketches)) throw new Error('Unsupported catalogue format');
  const ids = new Set();
  return data.sketches.map(entry => {
    if (ids.has(entry.id)) throw new Error(`Duplicate sketch: ${entry.id}`);
    ids.add(entry.id);
    return resolveEntry(entry, response.url || url);
  });
}
