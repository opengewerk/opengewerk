/**
 * The two web app manifests of an application with two entry points, and its
 * name in both shells (ADR 0004, ADR 0010).
 *
 * Two manifests, because a manifest names exactly one `start_url` and the two
 * entry points are two different places to start. Installed from a desk the
 * application opens the office; installed from a phone away from it, it opens
 * the second entry, and that is the whole point of installing it there.
 *
 * Emitted by the build and not kept as files, because almost everything in
 * them is the same and two hand kept copies of almost the same thing drift.
 * What an application says, what its entries are called and which icons it
 * has, comes in as an argument; where an entry starts is the foundation's,
 * the same place its service worker and its server tell the two shells apart
 * by.
 *
 * JavaScript for Node and not TypeScript, like the other tools here: a vite
 * configuration loads what it imports from a package with Node, as it is.
 */

/** Slate, `--color-ink` of the tokens. The colour behind the icon while the application starts. */
const slate = '#1B2430'

/** Ivory, `--color-ground` of the tokens. The ground of the light theme, which is what opens. */
const ivory = '#F4F1EA'

/**
 * What stands in both shells where the name of the application goes, in the
 * title and in the sentence for a browser without JavaScript.
 */
export const namePlaceholder = '%APPLICATION_NAME%'

/** Where the office starts, and where the second entry does, as the service worker knows them. */
const starts = { office: '/', site: '/m/' }

/**
 * One manifest: what an entry is called and where it starts, with what both
 * entries share.
 *
 * @param {{ name: string, short_name: string, description: string, start_url: string }} entry
 * @param {{ 192: string, 512: string }} icons
 */
export function webManifest(entry, icons) {
  return {
    name: entry.name,
    short_name: entry.short_name,
    description: entry.description,
    start_url: entry.start_url,
    // The scope is the start for the second entry and the whole origin for the
    // office. A scope of `/m/` keeps the installed second entry from wandering
    // into the office by accident: a link out of the scope opens in a browser
    // tab instead of inside the application.
    scope: entry.start_url,
    display: 'standalone',
    background_color: ivory,
    theme_color: slate,
    lang: 'de',
    dir: 'ltr',
    icons: [
      { src: icons[192], sizes: '192x192', type: 'image/png' },
      { src: icons[512], sizes: '512x512', type: 'image/png' },
      {
        // `maskable` lets Android put the icon into its own shape instead of
        // dropping a white square onto the home screen.
        src: icons[512],
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}

/** The name as text of a page: a character that means something in HTML stays a character. */
function asText(name) {
  return name
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * The plugin of the build that writes both manifests and puts the name of the
 * application into both shells.
 *
 * `vite-plugin-pwa` can generate one manifest, and one is exactly what does
 * not fit: the two entries start in two different places. So that plugin is
 * told to leave the manifest alone, and this one writes both.
 *
 * @param {object} application
 * @param {string} application.name What the application is called, in both shells.
 * @param {{ 192: string, 512: string }} application.icons Its icon, at 192 and at 512 pixels square.
 * @param {{ name: string, short_name: string, description: string }} application.office
 * @param {{ name: string, short_name: string, description: string }} application.site
 */
export function entryManifests({ name, icons, office, site }) {
  return {
    name: 'entry-manifests',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replaceAll(namePlaceholder, asText(name))
      },
    },
    generateBundle() {
      for (const [fileName, entry, start] of [
        ['manifest.webmanifest', office, starts.office],
        ['m/manifest.webmanifest', site, starts.site],
      ]) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: JSON.stringify(webManifest({ ...entry, start_url: start }, icons), null, 2),
        })
      }
    },
  }
}
