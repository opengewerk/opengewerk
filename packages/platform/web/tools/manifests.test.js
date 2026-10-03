// @vitest-environment node
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import * as tool from './manifests.js'
import { entryManifests, namePlaceholder, webManifest } from './manifests.js'

/**
 * The two manifests of an application with two entries and its name in both
 * shells, written by a plugin of the build, with an application that belongs
 * to nobody.
 */

const icons = { 192: '/brand/probe-192.png', 512: '/brand/probe-512.png' }

const application = {
  name: 'Probewerk',
  icons,
  office: {
    name: 'Probewerk',
    short_name: 'Probewerk',
    description: 'Alles zum Proben an einem Schreibtisch.',
  },
  site: {
    name: 'Probewerk Unterwegs',
    short_name: 'Unterwegs',
    description: 'Die Proben des Tages, auch ohne Netz.',
  },
}

/** What the plugin writes into a build, by the name of each file. */
function emitted(plugin) {
  const files = {}

  plugin.generateBundle.call({
    emitFile(file) {
      files[file.fileName] = file
    },
  })

  return files
}

function shell(plugin, html) {
  return plugin.transformIndexHtml.handler(html)
}

describe('a manifest', () => {
  const office = webManifest({ ...application.office, start_url: '/' }, icons)
  const site = webManifest({ ...application.site, start_url: '/m/' }, icons)

  it('says what its entry is called and starts where the entry starts', () => {
    expect(office).toMatchObject({
      name: 'Probewerk',
      short_name: 'Probewerk',
      description: 'Alles zum Proben an einem Schreibtisch.',
      start_url: '/',
    })
    expect(site).toMatchObject({
      name: 'Probewerk Unterwegs',
      short_name: 'Unterwegs',
      start_url: '/m/',
    })
  })

  it('keeps the installed second entry inside its own part of the origin', () => {
    expect(office.scope).toBe('/')
    expect(site.scope).toBe('/m/')
  })

  it('opens standalone, in German, on the colours of the tokens', () => {
    expect(site).toMatchObject({
      display: 'standalone',
      background_color: '#F4F1EA',
      theme_color: '#1B2430',
      lang: 'de',
      dir: 'ltr',
    })
  })

  it('names the icon at both sizes, and the large one once more for a shape of its own', () => {
    expect(site.icons).toEqual([
      { src: '/brand/probe-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/probe-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/probe-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ])
  })

  it('lists its fields in the order a manifest is read in, whatever order it was handed', () => {
    const shuffled = webManifest(
      { start_url: '/', description: 'd', short_name: 's', name: 'n' },
      icons,
    )

    expect(Object.keys(shuffled)).toEqual([
      'name',
      'short_name',
      'description',
      'start_url',
      'scope',
      'display',
      'background_color',
      'theme_color',
      'lang',
      'dir',
      'icons',
    ])
  })
})

describe('the plugin of the build', () => {
  const plugin = entryManifests(application)

  it('writes one manifest for each entry, the office at the root and the second entry under /m', () => {
    const files = emitted(plugin)

    expect(Object.keys(files)).toEqual(['manifest.webmanifest', 'm/manifest.webmanifest'])
    expect(files['manifest.webmanifest'].type).toBe('asset')
    expect(JSON.parse(files['manifest.webmanifest'].source)).toEqual(
      webManifest({ ...application.office, start_url: '/' }, icons),
    )
    expect(JSON.parse(files['m/manifest.webmanifest'].source)).toEqual(
      webManifest({ ...application.site, start_url: '/m/' }, icons),
    )
  })

  it('writes them readable, two spaces deep', () => {
    expect(emitted(plugin)['m/manifest.webmanifest'].source).toBe(
      JSON.stringify(webManifest({ ...application.site, start_url: '/m/' }, icons), null, 2),
    )
  })

  it('puts the name into a shell wherever it stands, before the page is read', () => {
    const html =
      `<title>${namePlaceholder} Unterwegs</title>` +
      `<noscript>${namePlaceholder} braucht JavaScript.</noscript>`

    expect(shell(plugin, html)).toBe(
      '<title>Probewerk Unterwegs</title><noscript>Probewerk braucht JavaScript.</noscript>',
    )
    expect(plugin.transformIndexHtml.order).toBe('pre')
  })

  it('leaves everything else of a shell as it was', () => {
    expect(shell(plugin, '<p>%MODE% bleibt, 100% auch.</p>')).toBe(
      '<p>%MODE% bleibt, 100% auch.</p>',
    )
  })

  it('writes a name as text, whatever it holds', () => {
    const odd = entryManifests({ ...application, name: 'Proben & "Partner" <Nord>' })

    expect(shell(odd, `<title>${namePlaceholder}</title>`)).toBe(
      '<title>Proben &amp; &quot;Partner&quot; &lt;Nord&gt;</title>',
    )
  })
})

describe('the declaration beside the script', () => {
  it('names what the script exports, no more and no less', () => {
    const declared = [
      ...readFileSync(new URL('./manifests.d.ts', import.meta.url), 'utf8').matchAll(
        /^export declare (?:const|function) (\w+)/gm,
      ),
    ].map((match) => match[1])

    expect(declared.sort()).toEqual(Object.keys(tool).sort())
    expect(declared.length).toBe(3)
  })

  it('declares the placeholder as the script writes it', () => {
    expect(readFileSync(new URL('./manifests.d.ts', import.meta.url), 'utf8')).toContain(
      `export declare const namePlaceholder: '${namePlaceholder}'`,
    )
  })
})
