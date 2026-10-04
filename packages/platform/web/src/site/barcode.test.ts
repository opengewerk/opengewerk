import { encode } from 'uqr'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { openCamera, openCodeReader } from './barcode.js'

/**
 * Where a code on a label is read: by the detector of the browser where it has
 * one, and otherwise by the reader in JavaScript, loaded when it is needed.
 */

// The reader in JavaScript is a large module. Loading it the first time took
// longer than a test may whenever every package ran its tests at once, and the
// first test that falls back to it ran out of time twice while it was green on
// its own. Loaded once here, with time of its own, it costs the tests nothing.
beforeAll(async () => {
  await import('@zxing/browser')
}, 60_000)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A frame of the camera, as large as the picture it shows. */
function frame(width: number, height: number): HTMLVideoElement {
  const video = document.createElement('video')

  Object.defineProperty(video, 'videoWidth', { value: width })
  Object.defineProperty(video, 'videoHeight', { value: height })

  return video
}

/** A detector of the browser that knows these formats and finds these codes. */
function detector(supported: Promise<string[]>, found: readonly string[] = []) {
  const made: unknown[] = []
  const looked: unknown[] = []

  class Detector {
    static getSupportedFormats() {
      return supported
    }

    constructor(options: unknown) {
      made.push(options)
    }

    detect(source: unknown) {
      looked.push(source)

      return Promise.resolve(found.map((rawValue) => ({ rawValue })))
    }
  }

  vi.stubGlobal('BarcodeDetector', Detector)

  return { made, looked }
}

/**
 * What the canvas of the reader in JavaScript shows: the picture it was last
 * drawn, as the pixels a context hands out. Without it happy-dom has no
 * context to give.
 */
function canvasShowing(pixels: (width: number, height: number) => Uint8ClampedArray) {
  const drawn: number[][] = []

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      drawImage: (_source: unknown, x: number, y: number, width: number, height: number) => {
        drawn.push([x, y, width, height, this.width, this.height])
      },
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        width,
        height,
        data: pixels(width, height),
      }),
    } as unknown as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext)

  return drawn
}

const white = (width: number, height: number) => new Uint8ClampedArray(width * height * 4).fill(255)

/** A QR code of this text as pixels, eight to a module, with a quiet zone of four modules. */
function qrPixels(text: string) {
  const { data, size } = encode(text)
  const scale = 8
  const side = (size + 8) * scale

  return {
    side,
    pixels: (width: number, height: number) => {
      const out = new Uint8ClampedArray(width * height * 4).fill(255)

      for (let y = 0; y < Math.min(side, height); y += 1) {
        for (let x = 0; x < Math.min(side, width); x += 1) {
          const row = Math.floor(y / scale) - 4
          const column = Math.floor(x / scale) - 4

          if (data[row]?.[column] === true) {
            out.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3)
          }
        }
      }

      return out
    },
  }
}

describe('the camera', () => {
  it('is the one at the back, without a microphone', async () => {
    const asked: unknown[] = []
    const stream = new MediaStream()

    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      mediaDevices: {
        getUserMedia: (constraints: unknown) => {
          asked.push(constraints)

          return Promise.resolve(stream)
        },
      },
    })

    expect(await openCamera()).toBe(stream)
    expect(asked).toEqual([{ video: { facingMode: { ideal: 'environment' } }, audio: false }])
  })
})

describe('the detector of the browser', () => {
  it('reads the codes of a label it knows, the first one it finds', async () => {
    const { made, looked } = detector(
      Promise.resolve(['aztec', 'qr_code', 'upc_a', 'ean_13', 'data_matrix', 'code_128']),
      ['JA2404118772', 'a second code'],
    )
    // The reader in JavaScript could be made as well; the browser's own goes first.
    const drawn = canvasShowing(white)
    const reader = await openCodeReader()
    const video = frame(1920, 1080)

    expect(await reader?.read(video)).toBe('JA2404118772')
    // The formats of a label it supports, in the order of the list, and no
    // other: a format nobody prints only slows every frame down.
    expect(made).toEqual([{ formats: ['code_128', 'ean_13', 'qr_code', 'data_matrix'] }])
    expect(looked).toEqual([video])
    expect(drawn).toEqual([])
  })

  it('reads nothing in a frame without a code', async () => {
    detector(Promise.resolve(['qr_code']), [])

    expect(await (await openCodeReader())?.read(frame(640, 480))).toBeNull()
  })

  it('makes way for the reader in JavaScript where it knows none of the formats', async () => {
    const { made } = detector(Promise.resolve(['aztec', 'upc_a']), ['from the detector'])
    const drawn = canvasShowing(white)
    const reader = await openCodeReader()

    expect(reader).not.toBeNull()
    expect(made).toEqual([])
    expect(await reader?.read(frame(640, 480))).toBeNull()
    expect(drawn).toHaveLength(1)
  })

  it('makes way for the reader in JavaScript where it cannot say what it reads', async () => {
    const { made } = detector(Promise.reject(new Error('not now')), ['from the detector'])
    const drawn = canvasShowing(white)
    const reader = await openCodeReader()

    expect(reader).not.toBeNull()
    expect(made).toEqual([])
    expect(await reader?.read(frame(640, 480))).toBeNull()
    expect(drawn).toHaveLength(1)
  })
})

describe('the reader in JavaScript', () => {
  it('reads a QR code from the picture of the camera', async () => {
    const qr = qrPixels('https://example.org/a/7K2M9QX4TBA3HW8P')

    canvasShowing(qr.pixels)
    const reader = await openCodeReader()

    expect(await reader?.read(frame(qr.side, qr.side))).toBe(
      'https://example.org/a/7K2M9QX4TBA3HW8P',
    )
  })

  it('reads a frame at most 960 pixels wide, and a smaller one as it is', async () => {
    const drawn = canvasShowing(white)
    const reader = await openCodeReader()

    expect(await reader?.read(frame(1920, 1080))).toBeNull()
    expect(await reader?.read(frame(640, 480))).toBeNull()
    expect(drawn).toEqual([
      [0, 0, 960, 540, 960, 540],
      [0, 0, 640, 480, 640, 480],
    ])
  })

  it('tells the browser that its canvas is read often', async () => {
    const asked: unknown[] = []

    canvasShowing(white)
    const getContext = vi.mocked(HTMLCanvasElement.prototype.getContext)
    const made = getContext.getMockImplementation()

    getContext.mockImplementation(function (this: HTMLCanvasElement, ...given: unknown[]) {
      asked.push(given)

      return made?.apply(this, given as never) ?? null
    } as unknown as typeof HTMLCanvasElement.prototype.getContext)

    await openCodeReader()

    // Before a single frame: the canvas the frames are drawn on, once.
    expect(asked).toEqual([['2d', { willReadFrequently: true }]])
  })

  it('reads nothing before the picture has a size', async () => {
    const drawn = canvasShowing(white)
    const reader = await openCodeReader()

    expect(await reader?.read(frame(0, 480))).toBeNull()
    expect(await reader?.read(frame(640, 0))).toBeNull()
    expect(drawn).toEqual([])
  })

  it('is not there where the browser has nothing to draw on', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    expect(await openCodeReader()).toBeNull()
  })
})
