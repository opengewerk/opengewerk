// What the tests of an application stand on, as an entry of its own:
// `@opengewerk/platform-web/testing`. Nothing a running interface needs is in
// here, and nothing in here is part of what an entry point loads.

import tokens from './styles/tokens.css?raw'

// Whether the classes in a set of sources name tokens that exist.
export { tokenUsage } from './styles/usage.js'
export type { TokenUsage, TokenUsageOptions } from './styles/usage.js'

// A stand in for the server, for the tests of screens that write through the
// outbox.
export { TestServer } from './sync/test-server.js'

// A router around one screen, for a test that renders a screen and not a
// whole entry.
export { InRouter } from './in-router.js'

/**
 * Whether a button lets nobody press it: disabled, or locked in place while it
 * holds the focus, which is what a button that was just pressed and is now
 * waiting is (#629). A test that asks `disabled` alone misses the second.
 */
export function isLocked(element: Element): boolean {
  return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true'
}

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

// A browser that can take push, for the tests of the account and of the menu
// of the site.
export { fakePushBrowser, forgetPushBrowser } from './session/test-push.js'

// A device with the service worker of an application, for the tests of when a
// new version is taken: the registration, whether the page is shown, and
// whether there is a network.
export { standInWorker } from './shell/test-updates.js'
