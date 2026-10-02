import { act, render, screen, waitFor } from '@testing-library/react'
import { useContext, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type CodeReader, openCamera, openCodeReader } from './barcode.js'
import { type CameraWords, type Scanning, ScanningContext, useCodeReading } from './camera.js'

/**
 * The camera reading codes while a screen wants it: the reader first, then
 * the camera, then one frame after the other, and the camera given back on
 * every way out.
 */

const words: CameraWords = {
  noReader: 'Dieses Gerät liest keine Codes.',
  noCamera: 'Die Kamera lässt sich nicht öffnen.',
}

/** What the camera sees now; a test holds a code in front of it by setting this. */
let code: string | null = null
let frames: HTMLVideoElement[] = []
let stopped = 0
let cameras = 0

const reader: CodeReader = {
  read: (frame) => {
    frames.push(frame)

    return Promise.resolve(code)
  },
}

/** A stream whose one track counts how often it is stopped. */
function stream(): MediaStream {
  const made = new MediaStream()
  const track = {
    stop: () => {
      stopped += 1
    },
  } as unknown as MediaStreamTrack

  made.getTracks = () => [track]

  return made
}

function camera(): Promise<MediaStream> {
  cameras += 1

  return Promise.resolve(stream())
}

function Reading({
  active = true,
  onCode,
  sentences = words,
}: {
  readonly active?: boolean
  readonly onCode: (code: string) => void
  readonly sentences?: CameraWords
}) {
  const { video, trouble } = useCodeReading(active, onCode, sentences)

  return (
    <div>
      <video ref={video} aria-label="Bild der Kamera" />
      {trouble === null ? null : <p role="alert">{trouble}</p>}
    </div>
  )
}

/**
 * The screen reading, and a way to render it again with other properties and
 * the same camera and reader: a new value of the context alone would start
 * the reading over, and hide whether the screen's own wishes are followed.
 */
function reading(props: Parameters<typeof Reading>[0], scanning: Partial<Scanning> = {}) {
  const value: Scanning = {
    openReader: () => Promise.resolve(reader),
    openCamera: camera,
    interval: 5,
    ...scanning,
  }
  const shown = (next: Parameters<typeof Reading>[0]) => (
    <ScanningContext.Provider value={value}>
      <Reading {...next} />
    </ScanningContext.Provider>
  )
  const result = render(shown(props))

  return {
    ...result,
    again: (next: Parameters<typeof Reading>[0]) => {
      result.rerender(shown(next))
    },
  }
}

/** A promise and the hand that settles it, for a step a test lets happen later. */
function later<Value>() {
  let settle: (value: Value) => void = () => {}
  const promise = new Promise<Value>((resolve) => {
    settle = resolve
  })

  return { promise, settle }
}

beforeEach(() => {
  code = null
  frames = []
  stopped = 0
  cameras = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('reading codes with the camera', () => {
  it('shows the picture and reads the code in it, frame after frame', async () => {
    const codes: string[] = []

    reading({ onCode: (found) => codes.push(found) })

    const video = screen.getByLabelText<HTMLVideoElement>('Bild der Kamera')

    await waitFor(() => {
      expect(frames.length).toBeGreaterThanOrEqual(2)
    })
    expect(codes).toEqual([])
    expect(video.srcObject).toBeInstanceOf(MediaStream)
    expect(new Set(frames)).toEqual(new Set([video]))

    code = 'JA2404118772'
    await waitFor(() => {
      expect(codes.length).toBeGreaterThanOrEqual(2)
    })
    // Every frame with the code says it; telling a label read twice from a
    // second one is the screen's business.
    expect(new Set(codes)).toEqual(new Set(['JA2404118772']))
    expect(cameras).toBe(1)
  })

  it('hands every code to the handler and the words of the last render', async () => {
    const first: string[] = []
    const second: string[] = []
    const { again } = reading({ onCode: (found) => first.push(found) })

    await waitFor(() => {
      expect(frames.length).toBeGreaterThan(0)
    })
    again({ onCode: (found) => second.push(found) })
    code = 'JA2404118773'

    await waitFor(() => {
      expect(second.length).toBeGreaterThan(0)
    })
    expect(first).toEqual([])
    // The same reading all along, not one started over for the new handler.
    expect(cameras).toBe(1)
  })

  it('waits the interval between two frames', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    reading({ onCode: () => {} }, { interval: 1000 })

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(frames).toHaveLength(1)

    await act(() => vi.advanceTimersByTimeAsync(999))
    expect(frames).toHaveLength(1)

    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(frames).toHaveLength(2)

    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(frames).toHaveLength(4)
  })

  it('goes on after a frame the reader stumbles over', async () => {
    const codes: string[] = []
    let calls = 0

    reading(
      { onCode: (found) => codes.push(found) },
      {
        openReader: () =>
          Promise.resolve({
            read: () => {
              calls += 1

              return calls === 1 ? Promise.reject(new Error('blurred')) : Promise.resolve('B16')
            },
          }),
      },
    )

    await waitFor(() => {
      expect(codes).toContain('B16')
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reads on where the picture does not start playing', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('NotAllowedError'))
    const codes: string[] = []

    code = 'JA2404118774'
    reading({ onCode: (found) => codes.push(found) })

    await waitFor(() => {
      expect(codes).toContain('JA2404118774')
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('reading codes, when it cannot', () => {
  it('opens no camera without a reader, and says so in the words of the screen', async () => {
    reading({ onCode: () => {} }, { openReader: () => Promise.resolve(null) })

    expect((await screen.findByRole('alert')).textContent).toBe(words.noReader)
    expect(cameras).toBe(0)
  })

  it('says so in the words of the screen when the camera does not open', async () => {
    reading(
      { onCode: () => {} },
      { openCamera: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
    )

    expect((await screen.findByRole('alert')).textContent).toBe(words.noCamera)
    expect(frames).toEqual([])
  })

  it('says it in the words the screen has by the time it knows', async () => {
    const arriving = later<CodeReader | null>()
    const { again } = reading({ onCode: () => {} }, { openReader: () => arriving.promise })

    again({ onCode: () => {}, sentences: { ...words, noReader: 'Hier liest nichts.' } })

    await act(async () => {
      arriving.settle(null)
      await arriving.promise
    })

    expect((await screen.findByRole('alert')).textContent).toBe('Hier liest nichts.')
  })

  it('opens nothing while the screen does not want it', async () => {
    let readers = 0

    reading(
      { active: false, onCode: () => {} },
      {
        openReader: () => {
          readers += 1

          return Promise.resolve(reader)
        },
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(readers).toBe(0)
    expect(cameras).toBe(0)
  })
})

describe('the camera, given back', () => {
  it('when the screen goes', async () => {
    const { unmount } = reading({ onCode: () => {} })

    await waitFor(() => {
      expect(frames.length).toBeGreaterThan(0)
    })
    unmount()

    const read = frames.length

    expect(stopped).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(frames.length).toBeLessThanOrEqual(read + 1)
  })

  it('when the screen no longer wants it', async () => {
    const codes: string[] = []
    const { again } = reading({ onCode: (found) => codes.push(found) })

    await waitFor(() => {
      expect(frames.length).toBeGreaterThan(0)
    })
    again({ active: false, onCode: (found) => codes.push(found) })

    expect(stopped).toBe(1)
    code = 'JA2404118775'
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(codes).toEqual([])
  })

  it('at once, when it arrives after the screen went', async () => {
    const arriving = later<MediaStream>()
    const { unmount } = reading({ onCode: () => {} }, { openCamera: () => arriving.promise })

    await act(() => Promise.resolve())
    unmount()
    expect(stopped).toBe(0)

    await act(async () => {
      arriving.settle(stream())
      await arriving.promise
    })

    expect(stopped).toBe(1)
    expect(frames).toEqual([])
  })

  it('without a word about a code it read after the screen went', async () => {
    const frame = later<string | null>()
    const codes: string[] = []
    const { unmount } = reading(
      { onCode: (found) => codes.push(found) },
      { openReader: () => Promise.resolve({ read: () => frame.promise }) },
    )

    await waitFor(() => {
      expect(cameras).toBe(1)
    })
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
    unmount()

    await act(async () => {
      frame.settle('JA2404118776')
      await frame.promise
    })

    expect(codes).toEqual([])
  })

  it('never opened, when the reader arrives after the screen went', async () => {
    const arriving = later<CodeReader | null>()
    const { unmount } = reading({ onCode: () => {} }, { openReader: () => arriving.promise })

    unmount()
    await act(async () => {
      arriving.settle(reader)
      await arriving.promise
    })

    expect(cameras).toBe(0)
  })
})

describe('where the camera and the reader come from', () => {
  it('is the browser, a frame every quarter of a second, unless a test says otherwise', () => {
    let seen: Scanning | null = null

    function Look({ onSeen }: { readonly onSeen: (scanning: Scanning) => void }) {
      const scanning = useContext(ScanningContext)

      useEffect(() => {
        onSeen(scanning)
      })

      return null
    }

    render(
      <Look
        onSeen={(scanning) => {
          seen = scanning
        }}
      />,
    )

    expect(seen).toEqual({ openReader: openCodeReader, openCamera, interval: 250 })
  })
})
