import { longestSignaturePath } from '@opengewerk/domain'
import { useId, useRef, useState } from 'react'
import type { PointerEvent } from 'react'

import { Button } from '../components/index.js'
import { signatureStroke, signatureViewBox } from '../app/signature.js'
import { farEnough, pathOf, type Point, pointIn } from './signing.js'

/**
 * Where the customer signs, with a finger or a pen.
 *
 * The strokes live in a ref and not in state. A finger reports its position
 * faster than React renders, and every report handled against the strokes of
 * the last render would overwrite the one before it: the signature would come
 * out with gaps exactly where the hand moved fastest. The state holds the path
 * made from them, and that is all the render reads.
 *
 * The path goes to the screen around it when a stroke ends, not on every
 * movement, so the report above does not render a few hundred times per
 * signature. Nothing can be pressed while a finger is still on the pad.
 *
 * `touch-none` is what keeps the page from scrolling under the pen. Without it
 * a downward stroke on a phone moves the page and draws nothing.
 */
export function SignaturePad({
  label,
  onChange,
}: {
  readonly label: string
  /** The path as it stands after each stroke, or null once it is cleared. */
  readonly onChange: (path: string | null) => void
}) {
  const strokes = useRef<Point[][]>([])
  const drawing = useRef<number | null>(null)
  const [drawn, setDrawn] = useState('')
  const [full, setFull] = useState(false)
  const hint = useId()

  /** Keeps a new set of strokes, unless it no longer fits into one signature. */
  function keep(next: Point[][]): void {
    const path = pathOf(next)

    if (path.length > longestSignaturePath) {
      setFull(true)

      return
    }

    strokes.current = next
    setDrawn(path)
  }

  function start(event: PointerEvent<SVGSVGElement>) {
    const point = pointIn(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)

    if (!point) {
      return
    }

    event.preventDefault()
    // Keeps the stroke going when the finger leaves the pad for a moment,
    // which it does at the end of every generous signature.
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = event.pointerId
    keep([...strokes.current, [point]])
  }

  function extend(event: PointerEvent<SVGSVGElement>) {
    if (drawing.current !== event.pointerId) {
      return
    }

    const point = pointIn(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)
    const stroke = strokes.current.at(-1)
    const last = stroke?.at(-1)

    if (!point || !stroke || (last && !farEnough(last, point))) {
      return
    }

    keep([...strokes.current.slice(0, -1), [...stroke, point]])
  }

  function end(event: PointerEvent<SVGSVGElement>) {
    if (drawing.current !== event.pointerId) {
      return
    }

    drawing.current = null
    onChange(strokes.current.length > 0 ? pathOf(strokes.current) : null)
  }

  function clear() {
    strokes.current = []
    drawing.current = null
    setFull(false)
    setDrawn('')
    onChange(null)
  }

  // As `pad()` of the boards draws it: the field in the colour of an input,
  // the line to sign on, and under it the hint with "Feld leeren" beside it.
  return (
    <div className="flex flex-col gap-2">
      <svg
        role="img"
        aria-label={label}
        aria-describedby={hint}
        viewBox={signatureViewBox}
        className="block aspect-[5/2] w-full cursor-crosshair touch-none rounded-[6px] border border-line-strong bg-input text-ink select-none"
        onPointerDown={start}
        onPointerMove={extend}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {/* The line people sign on. Only a guide, it is not part of the signature. */}
        <line
          x1="60"
          y1="320"
          x2="940"
          y2="320"
          className="text-line"
          stroke="currentColor"
          strokeWidth={3}
        />
        <path d={drawn} {...signatureStroke} />
      </svg>
      {full ? (
        <p role="status" className="text-[16px] text-ink">
          Das Feld ist voll. Was bis hierher gezeichnet ist, gilt; zum Neuanfang das Feld leeren.
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <p id={hint} className="min-w-0 grow text-[15px] leading-[1.45] text-ink-muted">
          Mit dem Finger oder einem Stift im Feld unterschreiben.
        </p>
        <Button tone="quiet" height={44} disabled={drawn === ''} onClick={clear}>
          Feld leeren
        </Button>
      </div>
    </div>
  )
}
