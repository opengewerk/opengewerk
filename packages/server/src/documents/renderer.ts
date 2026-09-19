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

/** What a caller gets instead of a PDF, phrased for whoever reads the log. */
export class RendererUnavailableError extends Error {}

export interface RendererOptions {
  /** Paper format the service understands. A4 unless somebody says otherwise. */
  readonly format?: string
  /** How long to wait before giving up, in milliseconds. */
  readonly timeoutMs?: number
}

export interface RendererConfiguration {
  /** Where the service listens, for example http://renderer:3000. Empty when there is none. */
  readonly url: string | undefined
  readonly token: string | undefined
}

export function readRendererConfiguration(
  environment: Record<string, string | undefined> = process.env,
): RendererConfiguration {
  return {
    url: environment['RENDERER_URL']?.trim() || undefined,
    token: environment['RENDERER_TOKEN']?.trim() || undefined,
  }
}

const notConfigured =
  'Für diese Instanz ist kein Renderer eingerichtet, es kann deshalb kein PDF ' +
  'erzeugt werden. Er wird mit "docker compose --profile renderer up -d" gestartet.'

const notReachable =
  'Der Renderer antwortet nicht. Läuft der Dienst? Gestartet wird er mit ' +
  '"docker compose --profile renderer up -d".'

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

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        html,
        options: { format: options.format ?? 'A4', printBackground: true },
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
