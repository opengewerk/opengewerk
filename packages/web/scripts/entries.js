import { checkEntries } from '@opengewerk/platform-web/tools/entry-check'

/**
 * Both entries of this application in a real browser with the script of the
 * entry cut off, asked by the foundation's tool (ADR 0010) against the
 * preview (`pnpm run preview`): the page loads itself anew once, and says so
 * where that does not help (opengewerk-haustechnik#279).
 */
await checkEntries({ entries: ['/', '/m/'] })
