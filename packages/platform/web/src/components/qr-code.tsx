import { encode } from 'uqr'

/**
 * A QR code, as an authenticator app reads one at the setup of a second
 * factor, and as a camera reads one off a label.
 *
 * Drawn from the matrix rather than from a string of SVG, so nothing is handed
 * to `dangerouslySetInnerHTML` and the shape can carry its own labels. The
 * white square underneath is not decoration: a reader needs the quiet zone and
 * the dark on light contrast, and in a dark theme the page behind it is not
 * white.
 */
export function QrCode({
  text,
  label,
  ecc,
  className,
}: {
  readonly text: string
  readonly label: string
  /** How much of the code may go missing; a label in a cabinet takes Q (#308). */
  readonly ecc?: 'L' | 'M' | 'Q' | 'H'
  readonly className?: string
}) {
  const { size, data } = encode(text, ecc === undefined ? {} : { ecc })
  // Four modules of quiet zone, which is what the specification asks for.
  const quiet = 4
  const edge = size + quiet * 2

  return (
    <svg
      viewBox={`0 0 ${String(edge)} ${String(edge)}`}
      role="img"
      aria-label={label}
      className={className ?? 'h-auto w-full rounded-[6px] border border-line'}
      // Blocks, not smoothed. A scaled up QR code with interpolation between
      // the modules is one a camera has to work at.
      style={{ imageRendering: 'pixelated' }}
    >
      <rect width={edge} height={edge} fill="#ffffff" />
      {data.map((row, y) =>
        row.map((dark, x) =>
          dark ? (
            <rect
              key={`${String(x)}-${String(y)}`}
              x={x + quiet}
              y={y + quiet}
              width={1}
              height={1}
              fill="#000000"
            />
          ) : null,
        ),
      )}
    </svg>
  )
}
