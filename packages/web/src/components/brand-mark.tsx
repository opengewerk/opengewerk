/**
 * The mark: five arcs of a circle, the last in copper.
 *
 * Drawn inline rather than loaded from `/brand`, so it takes the colour of the
 * text around it and needs no request: the header is the first thing on every
 * screen, offline included. The four light arcs follow `currentColor`, the
 * copper one the copper token, which turns lighter by itself on the dark
 * ground. The shapes are the ones in `opengewerk-orga/brand`.
 */
export function BrandMark({ size = 22 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="shrink-0">
      <g fill="none" strokeWidth="15">
        <path d="M82.888,35.357 A36,36 0 0 1 82.888,64.643" stroke="currentColor" />
        <path d="M79.125,71.160 A36,36 0 0 1 53.763,85.803" stroke="currentColor" />
        <path d="M46.237,85.803 A36,36 0 0 1 20.875,71.160" stroke="currentColor" />
        <path d="M17.112,64.643 A36,36 0 0 1 17.112,35.357" stroke="currentColor" />
        <path d="M20.875,28.840 A36,36 0 0 1 46.237,14.197" stroke="var(--color-copper)" />
      </g>
    </svg>
  )
}
