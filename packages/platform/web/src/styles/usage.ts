/**
 * A utility class is a string until something builds the stylesheet, and a
 * string with a typo in it looks exactly like one without. `bg-surfce` renders
 * an element with no background, which on an ivory page is invisible, and the
 * typecheck has nothing to say about it.
 *
 * This walks sources, pulls out every class that names a token, and holds it
 * against what the tokens actually declare. It is the cheap half of what a
 * full build of the stylesheet would tell, and it runs without one.
 *
 * A tool and not a test, because the question is asked twice: by this package
 * of its own components, and by every application of its screens. The second
 * half, whether every colour is used at all, only an application can answer:
 * a colour may well be drawn by a screen and by no component.
 */

/** The names the tokens declare under a prefix, `color` or `spacing`. */
function declared(tokens: string, prefix: string): ReadonlySet<string> {
  const names = new Set<string>()

  for (const match of tokens.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+):`, 'g'))) {
    const name = match[1] as string

    // `--text-body--line-height` belongs to `--text-body`, it is not a name of
    // its own.
    if (!name.includes('--')) {
      names.add(name)
    }
  }

  return names
}

/**
 * Suffixes that belong to Tailwind and not to the tokens. Kept as a list on
 * purpose: something new turns a test red once, somebody looks at it, and
 * either it is a keyword that belongs here or it is the typo this exists for.
 */
const builtIn: ReadonlySet<string> = new Set([
  'transparent',
  'current',
  'inherit',
  'collapse',
  'separate',
  'dashed',
  'solid',
  'none',
  'left',
  'right',
  'center',
  'justify',
  'normal',
  'medium',
  'semibold',
  'bold',
  'full',
  'auto',
  'sr',
  'only',
  // `h-px` for a hairline, `min-h-dvh` for a page as tall as the screen that
  // is left, `font-mono` for a placeholder in running text: Tailwind's own
  // scale, which `@import 'tailwindcss'` brings along.
  'px',
  'dvh',
  // `border-spacing-0` on a table whose cells draw their own borders.
  'spacing-0',
  'mono',
])

const prefixes = [
  'bg',
  'border',
  'border-l',
  'border-b',
  'border-t',
  'border-r',
  'outline',
  'ring',
  'fill',
  'stroke',
  'text',
  'rounded',
  'font',
  'h',
  'w',
  'min-h',
  'min-w',
  'p',
  'px',
  'py',
  'gap',
] as const

type Prefix = (typeof prefixes)[number]

// Longest first, so that `border-l` is tried before `border`. Not after a
// hyphen, a slash or a dot: `max-w-md` is not `w-md`, and
// `./screens/text-snippets.js` is a module and not a colour.
const candidate = new RegExp(
  `(?<![-/.])\\b(${[...prefixes].sort((left, right) => right.length - left.length).join('|')})-([a-z][a-z0-9-]*)\\b`,
  'g',
)

export interface TokenUsageOptions {
  /**
   * Strings in the sources that read like a class and are something else, the
   * key of a query for instance. A list for the same reason as the keywords
   * above: one more is a decision.
   */
  readonly notClasses?: ReadonlySet<string>
}

export interface TokenUsage {
  /** Classes that name a token nobody declared, as `file: class`, each once and sorted. */
  readonly unknown: readonly string[]
  /** Every name the sources reach for behind a prefix, the colours among them. */
  readonly usedColours: ReadonlySet<string>
  /** The colours the tokens declare. */
  readonly colours: ReadonlySet<string>
}

/**
 * Holds the classes in these sources against these tokens.
 *
 * @param tokens the stylesheet with the tokens, as text
 * @param sources the sources to read, by path
 */
export function tokenUsage(
  tokens: string,
  sources: Readonly<Record<string, string>>,
  options: TokenUsageOptions = {},
): TokenUsage {
  const colours = declared(tokens, 'color')
  const spacings = declared(tokens, 'spacing')
  const radii = declared(tokens, 'radius')
  const fonts = declared(tokens, 'font')
  const textSizes = declared(tokens, 'text')
  const notClasses = options.notClasses ?? new Set<string>()

  /** Which set of names a prefix draws from. `text-` draws from two. */
  const namespaces: Readonly<Record<Prefix, readonly ReadonlySet<string>[]>> = {
    bg: [colours],
    border: [colours],
    'border-l': [colours],
    'border-b': [colours],
    'border-t': [colours],
    'border-r': [colours],
    outline: [colours],
    ring: [colours],
    fill: [colours],
    stroke: [colours],
    text: [colours, textSizes],
    rounded: [radii],
    font: [fonts],
    h: [spacings],
    w: [spacings],
    'min-h': [spacings],
    'min-w': [spacings],
    p: [spacings],
    px: [spacings],
    py: [spacings],
    gap: [spacings],
  }

  const unknown: string[] = []
  const usedColours = new Set<string>()

  for (const [path, source] of Object.entries(sources)) {
    for (const match of source.matchAll(candidate)) {
      const prefix = match[1] as Prefix
      const suffix = match[2] as string

      // `border-l-copper` reaches its colour through a side. The sides are
      // prefixes of their own above and are tried before `border`, so the
      // name arrives here without one.
      usedColours.add(suffix)

      // `border-b`, `border-l-4`: a side, optionally with a width. Tailwind's
      // own, and not a colour.
      if (
        builtIn.has(suffix) ||
        notClasses.has(`${prefix}-${suffix}`) ||
        /^[btlrxy](-\d+)?$/.test(suffix)
      ) {
        continue
      }

      if (!namespaces[prefix].some((names) => names.has(suffix))) {
        unknown.push(`${path.split('/').pop() ?? path}: ${prefix}-${suffix}`)
      }
    }
  }

  return { unknown: [...new Set(unknown)].sort(), usedColours, colours }
}
