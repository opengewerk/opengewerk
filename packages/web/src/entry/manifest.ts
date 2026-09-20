/**
 * The two web app manifests, as data rather than as two JSON files.
 *
 * Two, because a manifest names exactly one `start_url` and the two entry
 * points of ADR 0004 are two different places to start. Installed from the
 * office the app opens the office; installed from a phone on a site it opens
 * the site entry, and that is the whole point of installing it there.
 *
 * They are emitted by the build, not kept as files, because almost everything
 * in them is the same and two hand kept copies of almost the same thing drift.
 * The one that matters is `start_url`, and here it is impossible to miss.
 *
 * The icons come from `assets/brand`, which the build serves as `/brand`.
 * There is no second copy of them in this package: the brand files live in the
 * organisation repository and are copied here once, never twice.
 */

/** Slate. The colour behind the icon while the app starts. */
const slate = '#1B2430'

/** Ivory. The ground of the light theme, which is what opens. */
const ivory = '#F4F1EA'

const icons = [
  { src: '/brand/opengewerk-app-icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/brand/opengewerk-app-icon-512.png', sizes: '512x512', type: 'image/png' },
  {
    // `maskable` lets Android put the icon into its own shape instead of
    // dropping a white square onto the home screen.
    src: '/brand/opengewerk-app-icon-512.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'maskable',
  },
]

interface Manifest {
  readonly name: string
  readonly short_name: string
  readonly description: string
  readonly start_url: string
  readonly scope: string
  readonly display: string
  readonly background_color: string
  readonly theme_color: string
  readonly lang: string
  readonly dir: string
  readonly icons: typeof icons
}

function manifest(part: Pick<Manifest, 'name' | 'short_name' | 'description' | 'start_url'>) {
  return {
    ...part,
    // The scope is the start url for the site entry and the whole origin for
    // the office. A scope of `/m/` keeps the installed site app from
    // wandering into the office by accident: a link out of the scope opens in
    // a browser tab instead of inside the app.
    scope: part.start_url,
    display: 'standalone',
    background_color: ivory,
    theme_color: slate,
    lang: 'de',
    dir: 'ltr',
    icons,
  } satisfies Manifest
}

export const officeManifest = manifest({
  name: 'OpenGewerk',
  short_name: 'OpenGewerk',
  description: 'Handwerkersoftware für den Betrieb: Kunden, Objekte, Anlagen und Aufträge.',
  start_url: '/',
})

export const siteManifest = manifest({
  name: 'OpenGewerk Baustelle',
  short_name: 'Baustelle',
  description: 'Die Aufträge des Tages, auch ohne Netz.',
  start_url: '/m/',
})
