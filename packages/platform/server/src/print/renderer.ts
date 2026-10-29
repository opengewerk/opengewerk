/**
 * Turns HTML into a PDF, by asking the renderer service to do it.
 *
 * The service runs in its own container and not in this process, which is the
 * decision from ADR 0007: Chromium next to the application would have cost
 * more memory than the whole instance is allowed to use. What is left here is
 * the seam that decision asks for, `renderPdf(html) → PDF`, so that a lighter
 * renderer can take over later without a single template call changing.
 *
 * The service is optional. An instance that never produces a document does
 * not start it, and the error somebody gets when they try anyway has to say
 * which knob is missing. An unreachable renderer is an operating mistake, not
 * a crash.
 */

import { refusePlaceholder } from '../configuration.js'

/** What a caller gets instead of a PDF, phrased for whoever reads the log. */
export class RendererUnavailableError extends Error {}

/** The renderer is there and busy with the prints of others (`queuedRenderer`). */
export class RendererBusyError extends RendererUnavailableError {}

/**
 * What a printed page may load: nothing but what it carries itself
 * (opengewerk/opengewerk#686, found in the security review
 * opengewerk-haustechnik#360). Every template embeds its images and fonts as
 * `data:` and its styles inline, and escapes every value; should a value slip
 * past that, the page still cannot fetch, frame, send a form or run a script.
 * `base-uri` and `form-action` are not covered by `default-src`.
 */
export const printPolicy =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; " +
  "base-uri 'none'; form-action 'none'"

/**
 * The page with the policy as the first thing in its head, where Chromium
 * reads it before anything the page asks for. A page without a head gets it
 * right after its doctype or at its start, which the parser puts into the
 * head it makes. Every page is printed through here, so no template can be
 * left without it.
 */
export function withPrintPolicy(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${printPolicy}">`
  const end = endOfHead(html)

  if (end !== null) {
    return html.slice(0, end) + meta + html.slice(end)
  }

  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)

  return doctype === null ? meta + html : doctype[0] + meta + html.slice(doctype[0].length)
}

/**
 * Where the opening tag of the head ends, `<head>` or `<head ...>` and never
 * `<header>`, or null. Searched and not matched with a pattern: a pattern with
 * a run of anything up to ">" goes back over a page full of "<head" again and
 * again, and a page is as long as its embedded images.
 */
function endOfHead(html: string): number | null {
  const lower = html.toLowerCase()

  for (let at = lower.indexOf('<head'); at !== -1; at = lower.indexOf('<head', at + 5)) {
    const next = lower.charAt(at + 5)

    if (
      next === '>' ||
      next === ' ' ||
      next === '\t' ||
      next === '\n' ||
      next === '\r' ||
      next === '\f'
    ) {
      const close = lower.indexOf('>', at + 5)

      return close === -1 ? null : close + 1
    }
  }

  return null
}

/** The four margins of a page, as CSS lengths: `20mm`. */
export interface PageMargin {
  readonly top: string
  readonly right: string
  readonly bottom: string
  readonly left: string
}

/** A page of its own size, as CSS lengths: a label of `62mm` by `29mm`. */
export interface PageSize {
  readonly width: string
  readonly height: string
}

export interface RendererOptions {
  /** Paper format the service understands. A4 unless somebody says otherwise. */
  readonly format?: string
  /** A page of its own size in place of the format, for a label printer (#308). */
  readonly size?: PageSize
  /** How long to wait before giving up, in milliseconds. */
  readonly timeoutMs?: number
  /**
   * HTML printed into the bottom margin of every page, with Chromium's own
   * `pageNumber` and `totalPages` classes filled in. It is rendered as a
   * document of its own, so it brings its styles and fonts inline.
   */
  readonly footerHtml?: string
  readonly margin?: PageMargin
  /** The sheet turned on its side, for a table that needs the width. */
  readonly landscape?: boolean
}

export interface RendererConfiguration {
  /** Where the service listens, for example http://renderer:3000. Empty when there is none. */
  readonly url: string | undefined
  readonly token: string | undefined
}

export function readRendererConfiguration(
  environment: Record<string, string | undefined> = process.env,
): RendererConfiguration {
  const token = environment['RENDERER_TOKEN']?.trim() || undefined

  return {
    url: environment['RENDERER_URL']?.trim() || undefined,
    token: token === undefined ? undefined : refusePlaceholder(token, 'RENDERER_TOKEN'),
  }
}

// Without RENDERER_URL there is no renderer at all, which under Docker Compose
// cannot happen: the compose file always sets it. What is left is a server
// started some other way, and that is who this sentence is for.
const notConfigured =
  'Für diese Instanz ist kein Renderer eingerichtet, es kann deshalb kein PDF ' +
  'erzeugt werden. Mit Docker Compose läuft er von Haus aus mit, ohne Docker gehören ' +
  'RENDERER_URL und RENDERER_TOKEN in die Umgebung.'

// Set up and not answering: stopped, still starting, or switched off in the
// .env. The sentence names the one command that starts it and the one line
// that switches it off, because those are the two things to look at.
const notReachable =
  'Der Renderer antwortet nicht, deshalb kann gerade kein PDF erzeugt werden. Gestartet ' +
  'wird er mit "sh docker/start.sh". Steht in docker/.env "COMPOSE_PROFILES=" ohne ' +
  '"renderer", ist er dort abgeschaltet.'

/**
 * Renders a document. Throws `RendererUnavailableError` when there is no
 * renderer or it does not answer, and a plain `Error` when it answers with a
 * refusal: the first is something an operator fixes, the second something a
 * developer fixes, and telling them apart saves both a wrong guess.
 */
export async function renderPdf(
  html: string,
  configuration: RendererConfiguration,
  options: RendererOptions = {},
): Promise<Uint8Array> {
  if (!configuration.url) {
    throw new RendererUnavailableError(notConfigured)
  }

  const endpoint = new URL('/pdf', configuration.url)

  if (configuration.token) {
    endpoint.searchParams.set('token', configuration.token)
  }

  // An explicit deadline, because the default is none: a renderer that hangs
  // would otherwise hold the request open until whoever asked gives up.
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000)
  let response: Response

  // The footer switches Chromium's header and footer on, and then the header
  // has to be given as well: left out, Chromium prints the date and the title
  // of the page into it.
  const footer =
    options.footerHtml === undefined
      ? {}
      : {
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate: options.footerHtml,
        }

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        html: withPrintPolicy(html),
        options: {
          ...(options.size === undefined
            ? { format: options.format ?? 'A4' }
            : { width: options.size.width, height: options.size.height }),
          printBackground: true,
          ...footer,
          ...(options.margin === undefined ? {} : { margin: options.margin }),
          ...(options.landscape === true ? { landscape: true } : {}),
        },
      }),
      signal: timeout,
    })
  } catch (cause) {
    throw new RendererUnavailableError(notReachable, { cause })
  }

  if (!response.ok) {
    // Not RendererUnavailableError: the service is there and says no, which
    // means the document is wrong and not the installation.
    throw new Error(
      `Der Renderer hat das Dokument abgelehnt (HTTP ${response.status}). ` +
        `Antwort: ${(await response.text()).slice(0, 500)}`,
    )
  }

  return new Uint8Array(await response.arrayBuffer())
}

/** What gets printed: the page itself, and what goes into every footer. */
export interface PrintJob {
  readonly html: string
  readonly footerHtml?: string
  readonly margin?: PageMargin
  readonly landscape?: boolean
  readonly size?: PageSize
}

/**
 * Turns a print job into a PDF. A function rather than the service itself, so
 * the routes that print can be tested without a Chromium: a test hands in one
 * that answers with fixed bytes, or one that is not there.
 *
 * The tenant the job is printed for, where the caller knows it, so that one
 * tenant cannot take every place in the queue (`queuedRenderer`).
 */
export type Renderer = (
  job: PrintJob,
  printedFor?: { readonly tenantId: string },
) => Promise<Uint8Array>

/** The renderer an instance uses, the service from ADR 0007 behind `renderPdf`. */
export function rendererFor(configuration: RendererConfiguration): Renderer {
  return queuedRenderer((job) =>
    renderPdf(job.html, configuration, {
      ...(job.footerHtml === undefined ? {} : { footerHtml: job.footerHtml }),
      ...(job.margin === undefined ? {} : { margin: job.margin }),
      ...(job.landscape === undefined ? {} : { landscape: job.landscape }),
      ...(job.size === undefined ? {} : { size: job.size }),
    }),
  )
}

/**
 * How the prints of an instance queue for its renderer. One at a time, as the
 * renderer of the compose file takes them (`CONCURRENT=1`); ten waiting at
 * most, three of them for one tenant; and none waiting longer than a minute.
 */
export interface RenderQueueLimits {
  readonly atOnce: number
  readonly waiting: number
  readonly waitingPerTenant: number
  readonly waitMs: number
}

export const renderQueueLimits: RenderQueueLimits = {
  atOnce: 1,
  waiting: 10,
  waitingPerTenant: 3,
  waitMs: 60_000,
}

const busy =
  'Der Renderer druckt gerade für andere, deshalb kann im Moment kein PDF erzeugt werden. ' +
  'Bitte gleich noch einmal versuchen.'

/**
 * Puts a renderer behind a queue in this process. Every route that prints
 * renders on each request, the instance has one renderer, and a job went to
 * it the moment it came: whoever could open a print could keep it busy for
 * every tenant, and the jobs piled up behind it. Now the queue holds what
 * the renderer can take and a little more, a tenant only part of that, and
 * whatever finds no place, or waits too long, is told the renderer is busy
 * (`RendererBusyError`, which the routes answer as 503).
 */
export function queuedRenderer(
  render: Renderer,
  limits: RenderQueueLimits = renderQueueLimits,
): Renderer {
  let running = 0
  const waiting: { readonly tenantId: string | null; readonly start: () => void }[] = []

  function next(): void {
    while (running < limits.atOnce) {
      const first = waiting.shift()

      if (!first) {
        return
      }

      running += 1
      first.start()
    }
  }

  async function place(tenantId: string | null): Promise<void> {
    if (running < limits.atOnce && waiting.length === 0) {
      running += 1

      return
    }

    const ofTenant = waiting.filter((entry) => entry.tenantId === tenantId).length

    if (
      waiting.length >= limits.waiting ||
      (tenantId !== null && ofTenant >= limits.waitingPerTenant)
    ) {
      throw new RendererBusyError(busy)
    }

    await new Promise<void>((resolve, reject) => {
      const entry = {
        tenantId,
        start: () => {
          clearTimeout(timer)
          resolve()
        },
      }
      const timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(entry), 1)
        reject(new RendererBusyError(busy))
      }, limits.waitMs)

      waiting.push(entry)
    })
  }

  return async (job, printedFor) => {
    await place(printedFor?.tenantId ?? null)

    try {
      return await render(job, printedFor)
    } finally {
      running -= 1
      next()
    }
  }
}

/**
 * Turns a print job into a PDF, under which a module hands it to the routes
 * that print: the renderer service, or a stand-in in a test.
 */
export const RENDERER = Symbol('Renderer')
