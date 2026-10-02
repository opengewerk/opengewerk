/**
 * Reading the code on a label from a frame of the camera: a bar code, a QR
 * code or a Data Matrix. First read for the serial number of a PV module
 * (#300).
 *
 * The browser's own `BarcodeDetector` where there is one, Chrome on Android;
 * everywhere else, Safari on an iPhone above all, ZXing in JavaScript, loaded
 * only when the camera opens, so that the site does not carry it on every
 * start. In JavaScript and not as WebAssembly: that would need
 * `wasm-unsafe-eval` in the policy of the shell, which allows no evaluation.
 * The service worker holds the chunk with the rest, so it reads without a
 * network as well.
 */

/** Something that reads the code in a frame. */
export interface CodeReader {
  /** The text of the code in this frame, or null when none is read. */
  readonly read: (frame: HTMLVideoElement) => Promise<string | null>
}

/** The codes a label carries: bar codes of a serial number, and QR or Data Matrix. */
const formats = [
  'code_128',
  'code_39',
  'code_93',
  'codabar',
  'itf',
  'ean_13',
  'qr_code',
  'data_matrix',
] as const

interface DetectedCode {
  readonly rawValue: string
}

interface Detector {
  detect(source: CanvasImageSource): Promise<readonly DetectedCode[]>
}

interface DetectorClass {
  new (options: { formats: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
}

/** A frame is read at most this wide: a label fills the frame, and ZXing reads a smaller one faster. */
const frameWidth = 960

async function nativeReader(): Promise<CodeReader | null> {
  const native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector

  if (!native) {
    return null
  }

  try {
    const supported = await native.getSupportedFormats()
    const wanted = formats.filter((format) => supported.includes(format))

    if (wanted.length === 0) {
      return null
    }

    const detector = new native({ formats: wanted })

    return {
      read: async (frame) => (await detector.detect(frame))[0]?.rawValue ?? null,
    }
  } catch {
    return null
  }
}

async function zxingReader(): Promise<CodeReader | null> {
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const reader = new BrowserMultiFormatReader()
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })

    if (!context) {
      return null
    }

    return {
      read: (frame) => {
        const { videoWidth, videoHeight } = frame

        if (videoWidth === 0 || videoHeight === 0) {
          return Promise.resolve(null)
        }

        const scale = Math.min(1, frameWidth / videoWidth)
        canvas.width = Math.round(videoWidth * scale)
        canvas.height = Math.round(videoHeight * scale)
        context.drawImage(frame, 0, 0, canvas.width, canvas.height)

        try {
          return Promise.resolve(reader.decodeFromCanvas(canvas).getText())
        } catch {
          // Nothing in this frame; ZXing says so by throwing.
          return Promise.resolve(null)
        }
      },
    }
  } catch {
    return null
  }
}

/** A reader for this browser, or null where neither way works. */
export async function openCodeReader(): Promise<CodeReader | null> {
  return (await nativeReader()) ?? (await zxingReader())
}

/** The camera at the back of the device, the one a label is held in front of. */
export function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  })
}
