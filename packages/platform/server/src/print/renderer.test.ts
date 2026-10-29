import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type PrintJob,
  printPolicy,
  queuedRenderer,
  readRendererConfiguration,
  renderPdf,
  RendererBusyError,
  rendererFor,
  RendererUnavailableError,
  withPrintPolicy,
} from './renderer.js'

/**
 * The renderer is the one service an instance may run without, so the
 * interesting cases are the ones where it is missing. A crash there would
 * take down a request that has nothing to do with documents; a clear sentence
 * sends an operator to the right knob.
 */

const configured = { url: 'http://renderer:3000', token: 'geheim' }

/** The policy as every printed page carries it (#686). */
const policyTag =
  '<meta http-equiv="Content-Security-Policy" content="' +
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; " +
  "base-uri 'none'; form-action 'none'" +
  '">'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the renderer', () => {
  it('reads where it listens, and says so when it does not', () => {
    expect(readRendererConfiguration({ RENDERER_URL: 'http://renderer:3000' })).toEqual({
      url: 'http://renderer:3000',
      token: undefined,
    })
    expect(readRendererConfiguration({})).toEqual({ url: undefined, token: undefined })
    expect(readRendererConfiguration({ RENDERER_URL: '  ' }).url).toBeUndefined()
  })

  it('names the variables when no renderer is set up at all', async () => {
    await expect(
      renderPdf('<p>Rechnung</p>', { url: undefined, token: undefined }),
    ).rejects.toThrow(RendererUnavailableError)
    await expect(
      renderPdf('<p>Rechnung</p>', { url: undefined, token: undefined }),
    ).rejects.toThrow(/RENDERER_URL/)
  })

  /**
   * Under Docker Compose the renderer starts with the instance, so a renderer
   * that does not answer was stopped or switched off. The sentence names the
   * command that starts it and the line that switches it off, and no longer a
   * profile flag nobody needs any more.
   */
  it('names the start command and the switch when the renderer does not answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    const failure = renderPdf('<p>Rechnung</p>', configured)

    await expect(failure).rejects.toThrow(RendererUnavailableError)
    await expect(failure).rejects.toThrow(/sh docker\/start\.sh/)
    await expect(failure).rejects.toThrow(/COMPOSE_PROFILES/)
  })

  /**
   * The distinction the class exists for. A renderer that answers with a
   * refusal is running, so pointing an operator at the container would send
   * them the wrong way: the document is what is wrong.
   */
  it('separates "no renderer" from "the renderer said no"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Cannot read property of undefined', { status: 400 })),
    )

    const failure = renderPdf('<p>kaputt</p>', configured)

    await expect(failure).rejects.toThrow(/HTTP 400/)
    await expect(failure).rejects.not.toThrow(RendererUnavailableError)
  })

  it('hands the document over and gives back what came back', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    const fetched = vi.fn(async () => new Response(pdf, { status: 200 }))
    vi.stubGlobal('fetch', fetched)

    const result = await renderPdf('<h1>Rechnung 2026-0001</h1>', configured, { format: 'A5' })

    expect(result).toEqual(pdf)

    const [endpoint, request] = fetched.mock.calls[0] as unknown as [URL, RequestInit]

    // The token travels in the query string because that is what the service
    // reads; it never leaves the docker network.
    expect(endpoint.toString()).toBe('http://renderer:3000/pdf?token=geheim')
    expect(JSON.parse(String(request.body))).toEqual({
      html: `${policyTag}<h1>Rechnung 2026-0001</h1>`,
      options: { format: 'A5', printBackground: true },
    })
  })

  it('asks for a footer on every page, and for an empty header with it', async () => {
    const fetched = vi.fn(async () => new Response(new Uint8Array([0x25]), { status: 200 }))
    vi.stubGlobal('fetch', fetched)

    await renderPdf('<p>Rechnung</p>', configured, {
      footerHtml: '<div>Seite <span class="pageNumber"></span></div>',
      margin: { top: '15mm', right: '20mm', bottom: '32mm', left: '20mm' },
    })

    const [, request] = fetched.mock.calls[0] as unknown as [URL, RequestInit]

    // Without the empty header Chromium fills the space above every page with
    // the date and the title of the document, which nobody asked for.
    expect(JSON.parse(String(request.body))).toEqual({
      html: `${policyTag}<p>Rechnung</p>`,
      options: {
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: '<div>Seite <span class="pageNumber"></span></div>',
        margin: { top: '15mm', right: '20mm', bottom: '32mm', left: '20mm' },
      },
    })
  })

  it('gives up rather than holding a request open forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_endpoint: unknown, request: RequestInit) => {
        // What fetch does when the signal fires: it rejects, and the caller
        // has to turn that into something readable rather than let it through.
        expect(request.signal).toBeInstanceOf(AbortSignal)
        throw new DOMException('The operation was aborted.', 'TimeoutError')
      }),
    )

    await expect(renderPdf('<p>dauert</p>', configured, { timeoutMs: 10 })).rejects.toThrow(
      RendererUnavailableError,
    )
  })
})

/**
 * The queue in front of the renderer: one job at a time, a few waiting, a
 * tenant only part of those, and nobody waiting forever.
 */
describe('the queue of the renderer', () => {
  /** A renderer whose jobs end when the test says, in the order they started. */
  function heldRenderer() {
    const started: string[] = []
    const ends: (() => void)[] = []
    const render = (job: PrintJob) =>
      new Promise<Uint8Array>((resolve) => {
        started.push(job.html)
        ends.push(() => {
          resolve(new Uint8Array([1]))
        })
      })

    return { started, ends, render }
  }

  it('stands in front of the renderer an instance prints with', async () => {
    const answers: ((response: Response) => void)[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => answers.push(resolve))),
    )

    const render = rendererFor(configured)
    const first = render({ html: '<p>eins</p>' })
    const second = render({ html: '<p>zwei</p>' })

    await settled()
    expect(answers).toHaveLength(1)

    answers[0]?.(new Response(new Uint8Array([1])))
    await first
    await settled()
    expect(answers).toHaveLength(2)

    answers[1]?.(new Response(new Uint8Array([2])))
    await second
  })

  const settled = () => new Promise((resolve) => setTimeout(resolve, 5))

  it('renders one job at a time, the others in the order they came, and turns away what finds no place', async () => {
    const held = heldRenderer()
    const queued = queuedRenderer(held.render, {
      atOnce: 1,
      waiting: 2,
      waitingPerTenant: 5,
      waitMs: 10_000,
    })
    const first = queued({ html: 'eins' })
    const second = queued({ html: 'zwei' })
    const third = queued({ html: 'drei' })

    await expect(queued({ html: 'vier' })).rejects.toBeInstanceOf(RendererBusyError)
    await settled()
    expect(held.started).toEqual(['eins'])

    held.ends[0]?.()
    await first
    await settled()
    expect(held.started).toEqual(['eins', 'zwei'])

    held.ends[1]?.()
    await second
    await settled()
    held.ends[2]?.()
    await third
    expect(held.started).toEqual(['eins', 'zwei', 'drei'])
  })

  it('keeps places for the others when one tenant waits with as many as it may', async () => {
    const held = heldRenderer()
    const queued = queuedRenderer(held.render, {
      atOnce: 1,
      waiting: 5,
      waitingPerTenant: 2,
      waitMs: 10_000,
    })
    const north = { tenantId: 'nord' }
    const jobs = [
      queued({ html: 'nord 1' }, north),
      queued({ html: 'nord 2' }, north),
      queued({ html: 'nord 3' }, north),
    ]

    await expect(queued({ html: 'nord 4' }, north)).rejects.toBeInstanceOf(RendererBusyError)

    const south = queued({ html: 'süd 1' }, { tenantId: 'sued' })

    for (let index = 0; index < 4; index += 1) {
      await settled()
      held.ends[index]?.()
    }

    await Promise.all([...jobs, south])
    expect(held.started).toEqual(['nord 1', 'nord 2', 'nord 3', 'süd 1'])
  })

  it('tells a job that waited too long that the renderer is busy, and gives its place up', async () => {
    const held = heldRenderer()
    const queued = queuedRenderer(held.render, {
      atOnce: 1,
      waiting: 1,
      waitingPerTenant: 1,
      waitMs: 20,
    })
    const first = queued({ html: 'lang' })
    const waited = queued({ html: 'wartet' })

    await expect(waited).rejects.toBeInstanceOf(RendererBusyError)
    await expect(waited).rejects.toBeInstanceOf(RendererUnavailableError)

    // Its place is free again, and it was never rendered.
    const next = queued({ html: 'danach' })

    held.ends[0]?.()
    await first
    await settled()
    held.ends[1]?.()
    await next
    expect(held.started).toEqual(['lang', 'danach'])
  })
})

/**
 * What a printed page may load (#686): nothing from anywhere, images and fonts
 * only from the page itself, styles inline, and no script at all. The policy
 * stands first in the head of every page the renderer is handed, so that a
 * value that slipped past the escaping of a template could still reach nothing.
 */
describe('the policy of a printed page', () => {
  it('lets a page load nothing but its own images, fonts and styles', () => {
    expect(printPolicy).toBe(
      "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; " +
        "base-uri 'none'; form-action 'none'",
    )
  })

  it('stands first in the head, before anything the page asks for', () => {
    expect(
      withPrintPolicy(
        '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Beleg</title></head>' +
          '<body><header>Kopf</header></body></html>',
      ),
    ).toBe(
      `<!doctype html><html lang="de"><head>${policyTag}<meta charset="utf-8"><title>Beleg</title></head>` +
        '<body><header>Kopf</header></body></html>',
    )
    expect(withPrintPolicy('<html><head lang="de"><title>x</title></head></html>')).toBe(
      `<html><head lang="de">${policyTag}<title>x</title></head></html>`,
    )
  })

  it('stands at the start of a page without a head, and never in a header', () => {
    expect(withPrintPolicy('<!doctype html><header>Kopf</header>')).toBe(
      `<!doctype html>${policyTag}<header>Kopf</header>`,
    )
    expect(withPrintPolicy('<p>Etikett</p>')).toBe(`${policyTag}<p>Etikett</p>`)
  })
})
