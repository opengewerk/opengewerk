/**
 * A device as a person recognises it: "Chrome auf Windows", "Safari auf
 * iPhone", from the user agent the session was signed in with (#223).
 *
 * The raw string is a line of vendor names and version numbers that nobody
 * reads, and it was what the device lists under "Konto" and "Zugänge" showed.
 * A browser that no pattern matches is still some browser on some system, so
 * the parts fall back one by one rather than the whole name at once.
 */
export function deviceName(userAgent: string | null | undefined): string {
  if (!userAgent || userAgent.trim() === '') {
    return 'Unbekanntes Gerät'
  }

  const browser = browserOf(userAgent)
  const system = systemOf(userAgent)

  if (browser && system) {
    return `${browser} auf ${system}`
  }

  return browser ?? system ?? 'Unbekanntes Gerät'
}

/**
 * The order matters: Edge and Opera also say "Chrome", Chrome also says
 * "Safari", and the browsers on an iPhone are all Safari underneath and say so.
 */
function browserOf(agent: string): string | null {
  const said = (needle: string) => agent.includes(needle)

  if (said('Edg/') || said('EdgA/') || said('EdgiOS/')) {
    return 'Edge'
  }

  if (said('OPR/') || said('Opera')) {
    return 'Opera'
  }

  if (said('SamsungBrowser/')) {
    return 'Samsung Internet'
  }

  if (said('Firefox/') || said('FxiOS/')) {
    return 'Firefox'
  }

  if (said('Chrome/') || said('CriOS/') || said('Chromium/')) {
    return 'Chrome'
  }

  if (said('Safari/') && said('Version/')) {
    return 'Safari'
  }

  return null
}

function systemOf(agent: string): string | null {
  const said = (needle: string) => agent.includes(needle)

  if (said('iPhone')) {
    return 'iPhone'
  }

  if (said('iPad')) {
    return 'iPad'
  }

  if (said('Android')) {
    return 'Android'
  }

  if (said('Windows')) {
    return 'Windows'
  }

  if (said('CrOS')) {
    return 'ChromeOS'
  }

  if (said('Macintosh') || said('Mac OS X')) {
    return 'macOS'
  }

  if (said('Linux')) {
    return 'Linux'
  }

  return null
}
