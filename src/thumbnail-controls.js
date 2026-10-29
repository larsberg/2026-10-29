export function thumbnailControlsMarkup() {
  return `<div class="thumbnail-controls">
    <button type="button" data-capture-thumbnail>Capture thumbnail</button>
    <p class="camera-hint">Save the current view as this sketch’s thumbnail.</p>
    <p data-thumbnail-status role="status" aria-live="polite"></p>
    <img data-thumbnail-preview alt="Saved thumbnail" hidden>
  </div>`;
}

export async function captureCanvasThumbnail(canvas, render) {
  if (!canvas.width || !canvas.height) throw new Error('Wait for the canvas to appear, then try again.');
  const scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  const image = canvas.ownerDocument.createElement('canvas');
  image.width = Math.max(1, Math.round(canvas.width * scale));
  image.height = Math.max(1, Math.round(canvas.height * scale));
  const context = image.getContext('2d');
  if (!context) throw new Error('Could not create a thumbnail canvas.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, image.width, image.height);
  // Render and copy in the same task, before WebGL can discard its buffer.
  // This redraws the current scene without advancing mesh edits or playback.
  render();
  try {
    context.drawImage(canvas, 0, 0, image.width, image.height);
    return await new Promise((resolve, reject) => image.toBlob(blob => {
      if (blob?.type === 'image/jpeg') resolve(blob);
      else reject(new Error('The browser could not encode the thumbnail.'));
    }, 'image/jpeg', 0.9));
  } catch (error) {
    if (error.name === 'SecurityError') throw new Error('An external image in this canvas blocks capture.');
    throw error;
  }
}

export function bindThumbnailCapture(root, canvas, render) {
  const button = root.querySelector('[data-capture-thumbnail]');
  if (!button) return { dispose() {} };
  const status = root.querySelector('[data-thumbnail-status]');
  const preview = root.querySelector('[data-thumbnail-preview]');
  const abort = new AbortController();
  let busy = false, disposed = false, previewUrl;
  async function capture() {
    if (busy || disposed) return;
    busy = true;
    button.disabled = true;
    button.textContent = 'Saving…';
    status.textContent = '';
    try {
      const blob = await captureCanvasThumbnail(canvas, render);
      if (disposed) return;
      const response = await fetch(`${import.meta.env.BASE_URL}api/thumbnail`, {
        method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save the thumbnail.');
      if (disposed) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      preview.src = previewUrl = URL.createObjectURL(blob);
      preview.hidden = false;
      status.textContent = 'Saved to public/thumbnail.jpg';
    } catch (error) {
      if (!disposed) status.textContent = `Capture failed: ${error.message}`;
    } finally {
      busy = false;
      if (!disposed) { button.disabled = false; button.textContent = 'Capture thumbnail'; }
    }
  }
  button.addEventListener('click', capture);
  return {
    dispose() {
      disposed = true;
      abort.abort();
      button.removeEventListener('click', capture);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
  };
}
