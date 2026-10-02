// What the tests of an application stand on, as an entry of its own:
// `@opengewerk/platform-web/testing`. Nothing a running interface needs is in
// here, and nothing in here is part of what an entry point loads.

import tokens from './styles/tokens.css?raw'

// Whether the classes in a set of sources name tokens that exist.
export { tokenUsage } from './styles/usage.js'
export type { TokenUsage, TokenUsageOptions } from './styles/usage.js'

/** The design tokens as text, the way the checks of colours and classes read them. */
export const designTokens: string = tokens

/**
 * The sources of the components of this package, by path.
 *
 * For the one question an application asks of both together: whether every
 * colour the tokens declare is used at all, by a component here or by a
 * screen there.
 */
export const foundationSources = import.meta.glob(['./**/*.tsx', '!./**/*.test.tsx'], {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Readonly<Record<string, string>>
