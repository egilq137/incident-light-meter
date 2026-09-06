import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Emits a service worker whose precache list is the real set of built files.
 * Hand-rolled instead of vite-plugin-pwa: the app is small, and this keeps the
 * dependency tree to vite + typescript + vitest.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'inline-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    writeBundle(_options, bundle) {
      const assets = Object.keys(bundle).map((f) => '/' + f);
      const precache = ['/', ...assets, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
      // Cache name changes whenever the file list does, so old caches are dropped.
      const version = Buffer.from(precache.join('|')).toString('base64url').slice(0, 16);
      const template = readFileSync(resolve(import.meta.dirname, 'src/sw-template.js'), 'utf8');
      const sw = template
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2))
        .replace('__VERSION__', JSON.stringify(version));
      writeFileSync(resolve(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
