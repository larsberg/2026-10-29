import fs from 'node:fs';
import path from 'node:path';
import { siteEntry, validateManifest } from './manifest.js';
import { withSocialMetadata } from './social-metadata.js';

// Keep the app's existing bundled assets; add the same player metadata and
// Pages marker used by the other sketches, without introducing a CDN dependency.
export function pagesPlugin() {
  let manifest;
  return {
    name: 'standalone-sketch-pages',
    apply: 'build',
    config: {
      // Read after the setup API plugin has prepared/validated the saved file.
      order: 'post',
      handler(config) {
        const root = path.resolve(config.root ?? process.cwd());
        const setup = JSON.parse(fs.readFileSync(path.join(root, 'public/setup.json'), 'utf8'));
        return { define: { __BUNDLED_SETUP__: JSON.stringify(setup) } };
      },
    },
    configResolved(config) {
      manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(config.root, 'public/sketch.json'))));
      if (!fs.existsSync(path.join(config.root, 'public', manifest.thumbnail.src))) throw new Error('Missing thumbnail.');
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        html = withSocialMetadata(html, manifest);
        return html.replace(/<head([^>]*)>/i, '<head$1><link rel="describedby" type="application/json" href="./sketch.json">');
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'catalogue.json', source: JSON.stringify({
        schemaVersion: 1, title: manifest.title, sketches: [{ ...manifest, manifest: './sketch.json' }],
      }, null, 2) + '\n' });
      this.emitFile({ type: 'asset', fileName: 'site-entry.json', source: JSON.stringify(siteEntry(manifest), null, 2) + '\n' });
      this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' });
    },
  };
}
