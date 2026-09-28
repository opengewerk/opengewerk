import { createContext, type RefObject, useContext, useEffect, useRef, useState } from 'react'

import { openCamera, openCodeReader, type CodeReader } from '../app/barcode.js'

/**
 * The camera of the site reading codes: the serial numbers of modules (#300)
 * and the QR labels of installations (#308) through the same reader.
 */

/**
 * Where the camera and the reader come from, and how often a frame is read.
 * The tests put their own in; a browser without a camera has none to give.
 */
export interface Scanning {
  readonly openReader: () => Promise<CodeReader | null>
  readonly openCamera: () => Promise<MediaStream>
  /** Milliseconds between two frames. */
  readonly interval: number
}

export const ScanningContext = createContext<Scanning>({
  openReader: openCodeReader,
  openCamera,
  interval: 250,
})

/** What the screen says when it cannot read, in its own words. */
export interface CameraWords {
  /** The device has no reader, neither its own nor the one loaded on demand. */
  readonly noReader: string
  /** The camera is not allowed, not there, or its picture does not start. */
  readonly noCamera: string
}

/**
 * Reads codes from the camera while `active` holds: the reader first, since
 * without one the camera is not worth opening, then the camera, then one frame
 * every `interval`. Every code goes to the `onCode` of the last render, which
 * knows the state of the screen. The camera is released when the screen goes
 * or `active` turns false, on every way out.
 *
 * Returns the ref for the `<video>` the picture goes into, and the sentence to
 * show when reading is not possible, or null.
 */
export function useCodeReading(
  active: boolean,
  onCode: (code: string) => void,
  words: CameraWords,
): { readonly video: RefObject<HTMLVideoElement | null>; readonly trouble: string | null } {
  const scanning = useContext(ScanningContext)
  const video = useRef<HTMLVideoElement>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const latestCode = useRef(onCode)
  const latestWords = useRef(words)

  // The handler of the last render, which knows what is next.
  useEffect(() => {
    latestCode.current = onCode
    latestWords.current = words
  })

  useEffect(() => {
    if (!active) {
      return
    }

    let stopped = false
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const release = () => {
      for (const track of stream?.getTracks() ?? []) {
        track.stop()
      }
    }

    void (async () => {
      const reader = await scanning.openReader()

      if (stopped) {
        return
      }

      if (!reader) {
        setTrouble(latestWords.current.noReader)

        return
      }

      const element = video.current

      try {
        stream = await scanning.openCamera()

        if (stopped || !element) {
          release()

          return
        }

        element.srcObject = stream
      } catch {
        // Refused, not there, or a stream the picture does not take: the same
        // for whoever stands in front of the cabinet.
        release()

        if (!stopped) {
          setTrouble(latestWords.current.noCamera)
        }

        return
      }

      try {
        await element.play()
      } catch {
        // A picture that does not start is read all the same, or not at all;
        // either way the frames below say so.
      }

      const next = async () => {
        if (stopped) {
          return
        }

        const code = await reader.read(element).catch(() => null)

        if (code !== null && !stopped) {
          latestCode.current(code)
        }

        timer = setTimeout(() => void next(), scanning.interval)
      }

      void next()
    })()

    return () => {
      stopped = true
      clearTimeout(timer)
      release()
    }
  }, [active, scanning])

  return { video, trouble }
}
