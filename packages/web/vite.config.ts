import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { officeManifest, siteManifest } from './src/entry/manifest.js'

/**
 * Writes the two web app manifests into the build.
 *
 * `vite-plugin-pwa` can generate one, and one is exactly what does not fit
 * here: the two entry points start in two different places. So the plugin is
 * told to leave the manifest alone and both are emitted from the one module
 * that holds their content.
 */
function manifests(): Plugin {
  return {
    name: 'opengewerk-manifests',
    generateBundle() {
      for (const [name, content] of [
        ['manifest.webmanifest', officeManifest],
        ['m/manifest.webmanifest', siteManifest],
      ] as const) {
        this.emitFile({ type: 'asset', fileName: name, source: JSON.stringify(content, null, 2) })
      }
    },
  }
}

export default defineConfig({
  // `assets` rather than a folder of this package. The brand files are copied
  // into this repository once, from the organisation repository, and a second
  // copy under `packages/web` would be a third place to forget.
  publicDir: '../../assets',

  build: {
    // Two entry points, two bundles. This is what makes the budget per entry
    // mean anything: the site app does not carry the office's table code, and
    // a check on one number for both would hide exactly that.
    rollupOptions: {
      input: {
        office: 'index.html',
        site: 'm/index.html',
      },
    },
    // The budget is checked against the gzipped size in `scripts/budget.js`,
    // so vite's own warning about raw bytes would only be noise next to it.
    chunkSizeWarningLimit: 2000,
  },

  server: {
    // In development vite serves the two entry points and the API is somewhere
    // else, so every path the server owns is forwarded to it. The list is the
    // same one `serveInterface` keeps on the other side, and it has to be:
    // a path missing here reaches vite, which answers with a shell, and the
    // failure reads like the server returning HTML for JSON.
    proxy: Object.fromEntries(
      [
        '/api',
        '/auth',
        '/customers',
        '/contacts',
        '/sites',
        '/installations',
        '/jobs',
        '/tasks',
        '/files',
        '/attachments',
        '/form-records',
        '/time',
        '/documents',
        '/sync',
        '/settings',
        '/setup',
        '/staff',
        '/invitation',
        '/health',
      ].map((path) => [path, { target: 'http://127.0.0.1:23700', changeOrigin: false }]),
    ),
  },

  plugins: [
    react(),
    tailwind(),
    manifests(),
    VitePWA({
      // Hand written, because the fallback for a navigation has to be told
      // apart by prefix: `/m/...` belongs to the site shell and everything
      // else to the office shell. A generated worker knows one fallback.
      strategies: 'injectManifest',
      srcDir: 'src/entry',
      filename: 'service-worker.ts',
      // Nothing is swapped under somebody who is filling in a form in a
      // basement. The new version waits and the app offers it.
      registerType: 'prompt',
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,webmanifest}'],
      },
      devOptions: {
        // Off in development on purpose: a service worker that keeps serving
        // the previous build is the single most confusing thing that can
        // happen while working on the interface.
        enabled: false,
      },
    }),
  ],
})
