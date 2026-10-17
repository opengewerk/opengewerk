import { createHash } from 'node:crypto'

import { attributeOf, tagsOf } from './budget.js'

/**
 * What a shell does when the script of its entry does not start
 * (opengewerk-haustechnik#279).
 *
 * A module script that cannot be loaded, itself or one of the parts it
 * imports, never runs, and the document remembers the failure: the page stays
 * the empty shell it was served as, in its ground colour and without a word.
 * `noscript` says nothing, because scripts are on. It happens when a
 * connection breaks while a part is on its way, when a page from a cache
 * names parts an update has removed, and it was seen where the browser itself
 * dropped the request for a script (opengewerk-haustechnik#275).
 *
 * Nothing of the application can help, since nothing of it runs. So the build
 * puts a small script of its own before the entry and a sentence into the
 * shell. The script hears the failure, which the browser reports at the
 * element of the entry script, and loads the page anew, once: nothing is lost
 * by that, no form is open in an application that has not started. Does the
 * entry fail again, the sentence appears, with a button that loads the page
 * anew, and the page leaves it at that: a part that is missing for good must
 * not load a page anew without end.
 *
 * A file of its own and no script in the page, because the policy of the
 * server allows no other (`script-src 'self'`), and the sentence gets its
 * look from the stylesheet of the entry (`.entry-notice` in
 * `styles/index.css`), because the same policy allows no style in the page.
 *
 * JavaScript for Node and not TypeScript, like the other tools here: a vite
 * configuration loads what it imports from a package with Node, as it is.
 */

/** Under this key a tab keeps that its page has loaded itself anew. */
export const reloadedKey = 'opengewerk.entry.reloaded'

/** The id of the sentence in a shell, which is also the class it is styled by. */
export const noticeId = 'entry-notice'

/** Under this key a browser keeps the entry somebody chose, as `entryChoiceKey` in `src/shell/entry.ts`. */
export const choiceKey = 'opengewerk.entry'

/** Under this key a browser keeps the view it was in last: `phone` or `desk`. */
export const viewKey = 'opengewerk.entry.view'

/** Where the office lives, as `entryPath.office` in `src/shell/entry.ts`. */
export const officePath = '/'

/** Where the site lives, as `entryPath.site` in `src/shell/entry.ts`. */
export const sitePath = '/m/'

/**
 * Takes a page to the entry that suits the view of the browser, before the
 * entry script of the page loads, so that a phone never loads the bundles of
 * both entries (ADR 0004, addendum of 17.10.2026).
 *
 * The view is what the browser says of itself: a phone in its mobile view
 * says so (`navigator.userAgentData.mobile`, otherwise "Mobile" or "iPhone"
 * in its user agent), and one switched to the desktop view does not. That is
 * the switch a person has in hand on a phone, and the entry follows it:
 *
 * - The view changed since the last page of this browser: the entry of the
 *   new view, the site for the mobile one and the office for the desktop one,
 *   from wherever the page is. A choice made in the other view no longer
 *   holds and is forgotten.
 * - Otherwise only the address of the instance itself, `/`, moves: to the
 *   site when that was chosen, or when nothing was chosen and the browser is
 *   in its mobile view. A link into the office stays the office, and a desk
 *   that opens the site stays there; a choice of the office stays as well.
 *
 * @param {Window} window
 * @param {object} entry
 * @param {string} entry.choiceKey Under what the browser keeps the choice.
 * @param {string} entry.viewKey Under what the browser keeps its last view.
 * @param {string} entry.office The address of the office.
 * @param {string} entry.site The address of the site.
 * @returns {boolean} Whether the page leaves for the other entry.
 */
export function followEntry(window, entry) {
  try {
    const path = window.location.pathname
    const here = path === '/m' || path.startsWith('/m/') ? 'site' : 'office'
    const browser = window.navigator
    const said = browser && browser.userAgentData && browser.userAgentData.mobile
    const phone =
      typeof said === 'boolean'
        ? said
        : /\bMobile\b|\biPhone\b/.test((browser && browser.userAgent) || '')
    const view = phone ? 'phone' : 'desk'
    const storage = window.localStorage
    const before = storage.getItem(entry.viewKey)

    storage.setItem(entry.viewKey, view)

    let wanted = null

    if (before !== null && before !== view) {
      storage.removeItem(entry.choiceKey)
      wanted = phone ? 'site' : 'office'
    } else if (path === '/') {
      const chosen = storage.getItem(entry.choiceKey)

      wanted = chosen === 'site' || (chosen === null && phone) ? 'site' : null
    }

    if (wanted === null || wanted === here) {
      return false
    }

    window.location.replace(wanted === 'site' ? entry.site : entry.office)

    return true
  } catch {
    // A browser that may keep nothing stays where it is, as before.
    return false
  }
}

/**
 * Watches the entry of a page. Runs in the page as the whole of the file the
 * build writes, handed over as its own text: nothing in it comes from outside
 * of it.
 *
 * Only the script the shell names counts. A page holds other scripts, of an
 * extension of the browser for one, and their failure is none of the entry.
 *
 * @param {Window} window
 * @param {object} shell
 * @param {string | null} shell.entry The address of the entry script, as the shell names it.
 * @param {string} shell.key Under what the tab keeps that it loaded the page anew.
 * @param {string} shell.notice The id of the sentence.
 */
export function watchEntry(window, shell) {
  let heard = false

  const reloaded = () => {
    try {
      return window.sessionStorage.getItem(shell.key) !== null
    } catch {
      // A tab that may keep nothing cannot know that it loaded the page anew,
      // and counts as one that has: better the sentence than a page loading
      // itself without end.
      return true
    }
  }

  const remember = () => {
    try {
      window.sessionStorage.setItem(shell.key, '1')

      return true
    } catch {
      return false
    }
  }

  const forget = () => {
    try {
      window.sessionStorage.removeItem(shell.key)
    } catch {
      // Nothing was kept, then.
    }
  }

  const say = () => {
    const notice = window.document.getElementById(shell.notice)

    if (!notice) {
      return
    }

    notice.querySelector('button')?.addEventListener('click', () => {
      window.location.reload()
    })
    notice.hidden = false
  }

  // On the way down to the element: that a script could not be loaded is
  // reported at the script and does not rise from there.
  window.addEventListener(
    'error',
    (event) => {
      const script = event.target

      if (
        heard ||
        shell.entry === null ||
        script?.tagName !== 'SCRIPT' ||
        script.getAttribute('src') !== shell.entry
      ) {
        return
      }

      heard = true

      if (!reloaded() && remember()) {
        window.location.reload()
      } else {
        say()
      }
    },
    true,
  )

  // A module script runs or fails before the page counts as loaded. A page
  // that got here unheard has started, and the next failure in this tab is a
  // first one again.
  window.addEventListener('load', () => {
    if (!heard) {
      forget()
    }
  })
}

/**
 * The file the build writes: the entry that suits the view of the browser
 * first, and where the page stays, the watch above with what it is told,
 * read from the element that loads it, where a shell says which script is
 * its entry.
 */
export function guardScript() {
  return `(${followEntry.toString()})(window, {
  choiceKey: ${JSON.stringify(choiceKey)},
  viewKey: ${JSON.stringify(viewKey)},
  office: ${JSON.stringify(officePath)},
  site: ${JSON.stringify(sitePath)},
}) || (${watchEntry.toString()})(window, {
  entry: document.currentScript && document.currentScript.getAttribute('data-entry'),
  key: ${JSON.stringify(reloadedKey)},
  notice: ${JSON.stringify(noticeId)},
})
`
}

/** Text of a page: a character that means something in HTML stays a character. */
function asText(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * The sentence of a shell whose entry did not start, hidden until the watch
 * shows it.
 *
 * @param {string} name What the application is called.
 */
export function noticeOf(name) {
  return [
    `<div id="${noticeId}" class="${noticeId}" role="alert" hidden>`,
    `  <p>${asText(name)} ist nicht gestartet, ein Teil der Anwendung ist nicht angekommen.</p>`,
    '  <p>Laden Sie die Seite neu. Hilft das nicht, fehlt vermutlich die Verbindung.</p>',
    '  <button type="button">Neu laden</button>',
    '</div>',
  ].join('\n')
}

/** The module script of a shell, its tag and its address, or null where it has none. */
function entryOf(html) {
  for (const tag of tagsOf(html, 'script')) {
    const source = attributeOf(tag, 'src')

    if (attributeOf(tag, 'type') === 'module' && source) {
      return { tag, source }
    }
  }

  return null
}

/**
 * A built shell with the watch before its entry script and the sentence at
 * the end of its body.
 *
 * @param {string} html The shell as the build made it.
 * @param {object} guard
 * @param {string} guard.file The address of the file with the watch.
 * @param {string} guard.name What the application is called.
 */
export function guarded(html, { file, name }) {
  const entry = entryOf(html)
  const end = html.lastIndexOf('</body>')

  // A shell this cannot guard fails the build: left as it is, it would be a
  // page that stays empty again, and nothing would say so.
  if (entry === null || end === -1) {
    throw new Error(
      entry === null
        ? 'Die Seite eines Einstiegs nennt kein Skript mit type="module", vor das die Wache gehört.'
        : 'Die Seite eines Einstiegs hat kein </body>, vor das der Satz gehört.',
    )
  }

  const at = html.indexOf(entry.tag)
  const watch = `<script src="${asText(file)}" data-entry="${asText(entry.source)}"></script>`

  return [
    html.slice(0, at),
    `${watch}\n    `,
    html.slice(at, end),
    `  ${noticeOf(name).replaceAll('\n', '\n    ')}\n  `,
    html.slice(end),
  ].join('')
}

/**
 * The plugin of the build that guards both shells of an application.
 *
 * Only in a build. In development the entry is served as it is written, part
 * by part, and a part that fails there is somebody's work in progress.
 *
 * @param {object} application
 * @param {string} application.name What the application is called, in the sentence.
 */
export function entryGuard({ name }) {
  const source = guardScript()
  // Named after what is in it, like every other script of a build: the
  // server lets a browser keep what lies under `assets` for good.
  const fileName = `assets/entry-guard-${createHash('sha256').update(source).digest('hex').slice(0, 8)}.js`

  return {
    name: 'entry-guard',
    apply: 'build',
    transformIndexHtml: {
      // After the build has put its own tags in: the entry script is known
      // by the address the build gave it.
      order: 'post',
      handler(html) {
        return guarded(html, { file: `/${fileName}`, name })
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source })
    },
  }
}
