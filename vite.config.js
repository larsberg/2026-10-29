import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { setupApiPlugin } from './server/setup-api.js';
import { thumbnailApiPlugin } from './server/thumbnail-api.js';
import { recordingApiPlugin } from './server/recording-api.js';
import { defaultMeshSetup, validateMeshSetup } from './src/mesh-settings.js';
import { pagesPlugin } from './scripts/pages-plugin.js';

export default defineConfig({
  base: './',
  resolve: { alias: [{ find: /^@strudel\/core$/, replacement: fileURLToPath(new URL('./node_modules/@strudel/core/index.mjs', import.meta.url)) }] },
  plugins: [pagesPlugin(), thumbnailApiPlugin(), recordingApiPlugin(), setupApiPlugin(
    fileURLToPath(new URL('./public/setup.json', import.meta.url)), undefined,
    { defaults: defaultMeshSetup, validate: validateMeshSetup },
  )],
  server: { host: '127.0.0.1', port: 1234, strictPort: true, open: false },
});
