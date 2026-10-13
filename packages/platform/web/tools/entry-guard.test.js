// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as tool from './entry-guard.js'
import {
  entryGuard,
  guardScript,
  guarded,
  noticeId,
  noticeOf,
  reloadedKey,
  watchEntry,
} from './entry-guard.js'

/**
 * What a shell does when the script of its entry does not start
 * (opengewerk-haustechnik#279): the watch in a page, with the events of a
 * document, and what the build makes of a shell. That a browser reports the
 * failure of a module script at its element is its own to keep; an
 * application asks a real one (`tools/entry-check.js`).
 */

const entry = '/assets/office-abc123.js'

/** A shell as a build leaves it, of an application that belongs to nobody. */
const built = `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <title>Probewerk</title>
    <script type="module" crossorigin src="${entry}"></script>
    <link rel="modulepreload" crossorigin href="/assets/part-def456.js">
    <link rel="stylesheet" crossorigin href="/assets/styles-ghi789.css">
  </head>
  <body>
    <div id="app"></div>
    <noscript>Probewerk ist eine Anwendung und braucht JavaScript.</noscript>
  </body>
</html>
`

/** What a tab keeps, as long as the tab lives: through every load of its page. */
function tabStorage(kept = {}) {
  return {
    getItem: (key) => kept[key] ?? null,
    setItem: (key, value) => {
      kept[key] = String(value)
    },
    removeItem: (key) => {
      delete kept[key]
    },
    kept,
  }
}

/** A tab that may keep nothing, as a browser set to refuse it answers. */
const refusing = {
  getItem: () => {
    throw new Error('The operation is insecure.')
  },
  setItem: () => {
    throw new Error('The operation is insecure.')
  },
  removeItem: () => {
    throw new Error('The operation is insecure.')
  },
}

describe('the watch at the entry of a page', () => {
  let script

  beforeEach(() => {
    document.body.innerHTML = `<div id="app"></div>${noticeOf('Probewerk')}`
    // Never put into the document: this is about what the watch does with a
    // failure, and a script in a document would be one the test loads.
    script = document.createElement('script')
    script.setAttribute('type', 'module')
    script.setAttribute('src', entry)
    document.body.append(document.createElement('span'))
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  /**
   * One load of the page: the events of the document of this test, the
   * storage of the tab, and a page that counts how often it was loaded anew.
   * What the browser reports is handed to whoever listens the way a browser
   * hands it: on the way down to the element, and not back up.
   */
  function load(storage, { told = entry } = {}) {
    const listeners = []
    const reload = vi.fn()

    watchEntry(
      {
        document,
        location: { reload },
        addEventListener: (type, listener, capture) => {
          listeners.push({ type, listener, capture })
        },
        get sessionStorage() {
          return storage
        },
      },
      { entry: told, key: reloadedKey, notice: noticeId },
    )

    return {
      reload,
      /** The browser could not load this element. */
      fails(element = script) {
        for (const { type, listener, capture } of listeners) {
          // Without bubbling, as the failure to load is reported: only who
          // listens on the way down hears it at the window.
          if (type === 'error' && capture === true) {
            listener({ target: element })
          }
        }
      },
      /** The page counts as loaded. */
      loaded() {
        for (const { type, listener } of listeners) {
          if (type === 'load') {
            listener({ target: document })
          }
        }
      },
    }
  }

  const notice = () => document.getElementById(noticeId)

  it('loads the page anew when the entry script could not be loaded, and says nothing yet', () => {
    const storage = tabStorage()
    const page = load(storage)

    page.fails()

    expect(page.reload).toHaveBeenCalledTimes(1)
    expect(storage.kept).toEqual({ [reloadedKey]: '1' })
    expect(notice().hidden).toBe(true)
  })

  it('says so instead when the page has loaded itself anew before, with a button that loads it anew', () => {
    const page = load(tabStorage({ [reloadedKey]: '1' }))

    page.fails()

    expect(page.reload).not.toHaveBeenCalled()
    expect(notice().hidden).toBe(false)
    expect(notice().textContent).toContain('Probewerk ist nicht gestartet')

    notice().querySelector('button').click()
    expect(page.reload).toHaveBeenCalledTimes(1)
  })

  it('never loads a page anew by itself a second time, however often its entry fails', () => {
    const storage = tabStorage()
    const first = load(storage)

    first.fails()
    // The page a failing one leaves still counts as loaded on its way out.
    first.loaded()

    const second = load(storage)

    second.fails()
    second.fails()
    second.loaded()

    // Loaded anew by the button, and the entry is still missing.
    const third = load(storage)

    third.fails()
    third.loaded()

    expect([first, second, third].map((page) => page.reload.mock.calls.length)).toEqual([1, 0, 0])
    expect(notice().hidden).toBe(false)
  })

  it('takes a page that loaded unheard as started: the next failure in the tab is a first one again', () => {
    const storage = tabStorage()

    load(storage).fails()

    // The page that was loaded anew starts.
    load(storage).loaded()
    expect(storage.kept).toEqual({})

    const later = load(storage)

    later.fails()
    expect(later.reload).toHaveBeenCalledTimes(1)
    expect(notice().hidden).toBe(true)
  })

  it('hears only the script the shell names as its entry', () => {
    const page = load(tabStorage())
    const other = document.createElement('script')
    const image = document.createElement('img')

    other.setAttribute('type', 'module')
    other.setAttribute('src', 'chrome-extension://abc/page.js')
    image.setAttribute('src', entry)

    page.fails(other)
    page.fails(image)
    // What a script throws while it runs is reported at the window itself.
    page.fails(window)

    expect(page.reload).not.toHaveBeenCalled()
    expect(notice().hidden).toBe(true)
  })

  it('says the sentence at once where the tab may keep nothing, rather than load without end', () => {
    const page = load(refusing)

    page.fails()
    page.loaded()

    expect(page.reload).not.toHaveBeenCalled()
    expect(notice().hidden).toBe(false)
  })

  it('listens for the failure on the way down to the element, where alone it is reported', () => {
    const asked = []

    watchEntry(
      {
        document,
        location: { reload: vi.fn() },
        sessionStorage: tabStorage(),
        addEventListener: (type, _listener, capture) => {
          asked.push([type, capture])
        },
      },
      { entry, key: reloadedKey, notice: noticeId },
    )

    expect(asked).toContainEqual(['error', true])
  })
})

describe('the file the build writes', () => {
  it('is the watch as a script of its own, told its entry by the element that loads it', () => {
    const listeners = {}
    const reload = vi.fn()
    const page = {
      document: {
        currentScript: { getAttribute: (name) => (name === 'data-entry' ? entry : null) },
        getElementById: () => null,
      },
      location: { reload },
      sessionStorage: tabStorage(),
      addEventListener: (type, listener) => {
        listeners[type] = listener
      },
    }

    // Run as a browser runs a script: with nothing but the page around it.
    new Function('window', 'document', guardScript())(page, page.document)

    listeners.error({ target: { tagName: 'SCRIPT', getAttribute: () => '/assets/other.js' } })
    expect(reload).not.toHaveBeenCalled()

    listeners.error({ target: { tagName: 'SCRIPT', getAttribute: () => entry } })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(page.sessionStorage.kept).toEqual({ [reloadedKey]: '1' })
  })

  it('imports nothing and names no module, since the policy of a page lets it run as it is only', () => {
    expect(guardScript()).not.toMatch(/\bimport\b|\brequire\(/)
  })
})

describe('a guarded shell', () => {
  const shell = guarded(built, { file: '/assets/entry-guard-1a2b3c4d.js', name: 'Probewerk' })

  it('has the watch before its entry script, told which script that is', () => {
    const watch = `<script src="/assets/entry-guard-1a2b3c4d.js" data-entry="${entry}"></script>`

    expect(shell).toContain(watch)
    expect(shell.indexOf(watch)).toBeLessThan(shell.indexOf('<script type="module"'))
    // A script the page waits for, and no module: it has to stand before the entry does.
    expect(watch).not.toMatch(/type="module"|async|defer/)
  })

  it('has the sentence at the end of its body, hidden, and everything it had before', () => {
    // The body alone: a head in a document would have its stylesheet fetched.
    document.body.innerHTML = shell.slice(
      shell.indexOf('<body>') + '<body>'.length,
      shell.indexOf('</body>'),
    )

    const notice = document.getElementById(noticeId)

    expect(notice.hidden).toBe(true)
    expect(notice.getAttribute('role')).toBe('alert')
    expect(notice.parentElement).toBe(document.body)
    expect(notice.querySelector('button').textContent).toBe('Neu laden')
    expect(notice.querySelector('button').getAttribute('type')).toBe('button')
    expect(document.getElementById('app')).not.toBeNull()
    expect(shell.replace(/<script src="[^"]*" data-entry="[^"]*"><\/script>\s*/, '')).toContain(
      built.slice(0, built.indexOf('</body>')).trimEnd(),
    )
  })

  it('names the application as text, whatever its name holds', () => {
    expect(noticeOf('Probe & <Werk>')).toContain(
      '<p>Probe &amp; &lt;Werk&gt; ist nicht gestartet, ein Teil der Anwendung ist nicht angekommen.</p>',
    )
  })

  it('is styled by a class the stylesheet of an entry holds', () => {
    expect(
      readFileSync(join(import.meta.dirname, '..', 'src', 'styles', 'index.css'), 'utf8'),
    ).toContain(`.${noticeId} {`)
    expect(noticeOf('Probewerk')).toContain(`class="${noticeId}"`)
  })

  it('fails the build at a shell it cannot guard, rather than leave it as it was', () => {
    expect(() =>
      guarded(built.replace(' type="module"', ''), { file: '/assets/g.js', name: 'Probewerk' }),
    ).toThrow('nennt kein Skript mit type="module"')
    expect(() =>
      guarded(built.replace('</body>', ''), { file: '/assets/g.js', name: 'Probewerk' }),
    ).toThrow('hat kein </body>')
  })
})

describe('the plugin that guards the shells of a build', () => {
  const plugin = entryGuard({ name: 'Probewerk' })

  /** What the plugin writes into a build, by the name of each file. */
  function emitted() {
    const files = {}

    plugin.generateBundle.call({
      emitFile(file) {
        files[file.fileName] = file
      },
    })

    return files
  }

  it('writes the watch under the assets, named after what is in it', () => {
    const files = emitted()
    const [name] = Object.keys(files)

    expect(Object.keys(files)).toHaveLength(1)
    expect(name).toMatch(/^assets\/entry-guard-[0-9a-f]{8}\.js$/)
    expect(files[name]).toEqual({ type: 'asset', fileName: name, source: guardScript() })
  })

  it('guards every shell of the build with that file, after the build has named the entry', () => {
    const [name] = Object.keys(emitted())
    const site = built.replace(entry, '/assets/site-777fff.js')

    expect(plugin.transformIndexHtml.order).toBe('post')
    expect(plugin.transformIndexHtml.handler(built)).toBe(
      guarded(built, { file: `/${name}`, name: 'Probewerk' }),
    )
    expect(plugin.transformIndexHtml.handler(site)).toContain(
      `<script src="/${name}" data-entry="/assets/site-777fff.js"></script>`,
    )
  })

  it('stays out of development, where an entry is served part by part as it is written', () => {
    expect(plugin.apply).toBe('build')
  })
})

describe('the declaration beside the script', () => {
  const declaration = readFileSync(join(import.meta.dirname, 'entry-guard.d.ts'), 'utf8')

  it('names what the script exports, no more and no less', () => {
    const declared = [...declaration.matchAll(/^export declare (?:const|function) (\w+)/gm)].map(
      (match) => match[1],
    )

    expect(declared.sort()).toEqual(Object.keys(tool).sort())
    expect(declared.length).toBe(7)
  })

  it('declares the key and the id as the script writes them', () => {
    expect(declaration).toContain(`export declare const reloadedKey: '${reloadedKey}'`)
    expect(declaration).toContain(`export declare const noticeId: '${noticeId}'`)
  })
})
