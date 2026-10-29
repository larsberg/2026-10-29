import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const maxBytes = 3 * 1024 * 1024;

export function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) {
    throw new Error('Send a JPEG image.');
  }
  for (let offset = 2; offset + 4 < bytes.length;) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
      if (!width || !height || width > 1600 || height > 1600) throw new Error('Thumbnails must be at most 1600 pixels on each side.');
      return { width, height };
    }
    offset += length;
  }
  throw new Error('The JPEG image has no readable dimensions.');
}

async function saveThumbnail(publicDir, bytes, dimensions) {
  const imageFile = join(publicDir, 'thumbnail.jpg');
  const manifestFile = join(publicDir, 'sketch.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const previousImage = await readFile(imageFile).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  manifest.thumbnail = { ...manifest.thumbnail, src: './thumbnail.jpg', ...dimensions };
  const temporary = join(publicDir, `.thumbnail-${randomUUID()}`);
  const imageTemp = `${temporary}.jpg.tmp`, manifestTemp = `${temporary}.json.tmp`;
  try {
    // Stage both files before replacing either existing save.
    await writeFile(imageTemp, bytes, { flag: 'wx' });
    await writeFile(manifestTemp, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await rename(imageTemp, imageFile);
    try { await rename(manifestTemp, manifestFile); }
    catch (error) {
      if (previousImage) {
        await writeFile(imageTemp, previousImage);
        await rename(imageTemp, imageFile);
      } else await rm(imageFile, { force: true });
      throw error;
    }
    return { thumbnail: manifest.thumbnail, path: 'public/thumbnail.jpg' };
  } finally {
    await Promise.all([imageTemp, manifestTemp].map(file => rm(file, { force: true })));
  }
}

export function createThumbnailHandler(publicDir) {
  // Keep image and metadata from concurrent captures in the same order.
  let pending = Promise.resolve();
  return async (request, response, next) => {
    if (request.url?.split('?')[0] !== '/api/thumbnail') return next();
    const send = (status, body) => {
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify(body));
    };
    if (request.method !== 'PUT') {
      response.setHeader('Allow', 'PUT');
      return send(405, { error: 'Use PUT to save a thumbnail.' });
    }
    let sameOrigin = false;
    try { sameOrigin = new URL(request.headers.origin).host === request.headers.host; } catch {}
    if (!sameOrigin) return send(403, { error: 'Capture from the sketch’s own local page.' });
    if (request.headers['content-type'] !== 'image/jpeg') return send(415, { error: 'Send a JPEG image.' });
    let bytes, dimensions;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > maxBytes) {
          request.resume();
          return send(413, { error: 'The thumbnail exceeds 3 MB.' });
        }
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks);
      dimensions = jpegDimensions(bytes);
    } catch (error) { return send(400, { error: error.message }); }
    const saving = pending.then(() => saveThumbnail(publicDir, bytes, dimensions));
    pending = saving.catch(() => {});
    try { send(200, await saving); }
    catch { send(500, { error: 'Could not save the thumbnail and sketch metadata to disk.' }); }
  };
}

export function thumbnailApiPlugin() {
  let publicDir;
  return {
    name: 'sketch-thumbnail-api',
    apply: 'serve',
    configResolved(config) { publicDir = config.publicDir; },
    configureServer(server) { server.middlewares.use(createThumbnailHandler(publicDir)); },
    // Saving must not restart the sketch while choosing a frame.
    hotUpdate({ file }) {
      if (dirname(file) === publicDir && (file.endsWith('/sketch.json') || file.endsWith('/thumbnail.jpg') || file.includes('/.thumbnail-'))) return [];
    },
  };
}
