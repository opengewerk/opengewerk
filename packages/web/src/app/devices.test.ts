import { describe, expect, it } from 'vitest'

import { deviceName } from './devices.js'

/** Real user agents, as the device lists received them. */
const agents = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxAndroid: 'Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
  samsungAndroid:
    'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
}

describe('the name of a device', () => {
  it('says the browser and the system, as a person names them (#223)', () => {
    expect(deviceName(agents.chromeWindows)).toBe('Chrome auf Windows')
    expect(deviceName(agents.edgeWindows)).toBe('Edge auf Windows')
    expect(deviceName(agents.safariIphone)).toBe('Safari auf iPhone')
    expect(deviceName(agents.chromeIphone)).toBe('Chrome auf iPhone')
    expect(deviceName(agents.firefoxAndroid)).toBe('Firefox auf Android')
    expect(deviceName(agents.samsungAndroid)).toBe('Samsung Internet auf Android')
    expect(deviceName(agents.safariMac)).toBe('Safari auf macOS')
    expect(deviceName(agents.firefoxLinux)).toBe('Firefox auf Linux')
  })

  it('keeps what it recognises of the rest, and says so when it knows nothing', () => {
    expect(deviceName('curl/8.9.1')).toBe('Unbekanntes Gerät')
    expect(deviceName('SomeBrowser (Windows NT 10.0)')).toBe('Windows')
    expect(deviceName(null)).toBe('Unbekanntes Gerät')
    expect(deviceName('  ')).toBe('Unbekanntes Gerät')
  })
})
