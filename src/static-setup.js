// Pages has no writable settings API. Browser saves are isolated by sketch URL.
export async function requestStaticSetup({method='GET',value,signal,url,validate,
  storage,fetcher=globalThis.fetch,
  bundledSetup=typeof __BUNDLED_SETUP__ === 'undefined' ? undefined : __BUNDLED_SETUP__}) {
  const key = `sketch-setup:v1:${url}`;
  // Apply this published preference update once to existing device saves.
  // Subsequent user edits continue to save normally.
  const preferenceKey = `${key}:volume-textures:2026-09-27`;
  if (method === 'PUT') {
    const settings = validate(value);
    if (!storage) throw new Error('Saving is unavailable in this browser.');
    storage.setItem(key,JSON.stringify(settings));
    try { storage.setItem(preferenceKey,"1"); } catch {}
    return settings;
  }
  if (method !== 'GET') throw new Error('Unsupported settings request.');
  try {
    const saved = storage?.getItem(key);
    if (saved !== null && saved !== undefined) {
      const settings = validate(JSON.parse(saved));
      if (storage.getItem(preferenceKey) !== '1') {
        if (settings.audio && Object.hasOwn(settings.audio, 'volume')) settings.audio.volume = .95;
        if (settings.camera && Object.hasOwn(settings.camera, 'optimizedTextures')) settings.camera.optimizedTextures = false;
        const updated = validate(settings);
        try {
          storage.setItem(key,JSON.stringify(updated));
          storage.setItem(preferenceKey,'1');
        } catch {} // Use the updated preferences even if storage becomes read-only.
        return updated;
      }
      return settings;
    }
  } catch {
    // Old/invalid browser saves must not stop the published setup loading.
    try { storage?.removeItem(key); } catch {}
  }
  // Production builds carry the published settings in the JavaScript bundle.
  // Clone before validation/application so later edits cannot change this baseline.
  if (bundledSetup !== undefined) return validate(structuredClone(bundledSetup));
  const response = await fetcher(url,{signal,cache:'no-store'});
  if (!response.ok) throw new Error(`Settings request failed (${response.status}).`);
  return validate(await response.json());
}

export function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}
