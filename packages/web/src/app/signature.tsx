import { signatureBox, signaturePathIsValid } from '@opengewerk/domain'

/** The box every signature is drawn in and shown in, as an SVG view box. */
export const signatureViewBox = `0 0 ${String(signatureBox.width)} ${String(signatureBox.height)}`

/**
 * The stroke a signature is drawn with. The same width the printed document
 * uses, so the strokes on the screen and on paper look like the same hand.
 */
export const signatureStroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/**
 * A signature as it was drawn, scaled to the space it is given.
 *
 * A path that does not have the shape the pad writes is not drawn at all. The
 * server refuses such a path on the way in, so one can only turn up here
 * through something that went around it, and a picture of it would claim a
 * signature where there is none.
 */
export function SignaturePicture({
  path,
  label,
}: {
  readonly path: string
  readonly label: string
}) {
  if (!signaturePathIsValid(path)) {
    return null
  }

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={signatureViewBox}
      className="block w-full max-w-md aspect-[5/2] text-ink"
    >
      <path d={path} {...signatureStroke} />
    </svg>
  )
}
