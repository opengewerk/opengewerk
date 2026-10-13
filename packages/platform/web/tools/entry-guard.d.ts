import type { Plugin } from 'vite'

// The types of `entry-guard.js`, for the vite configuration of an
// application, which TypeScript checks. Written beside the script and not
// generated from it: the package has no build, and `entry-guard.test.js`
// holds the script to what is declared here.

/** Under this key a tab keeps that its page has loaded itself anew. */
export declare const reloadedKey: 'opengewerk.entry.reloaded'

/** The id of the sentence in a shell, which is also the class it is styled by. */
export declare const noticeId: 'entry-notice'

/** What the watch is told about the shell it runs in. */
export interface GuardedShell {
  /** The address of the entry script, as the shell names it. */
  readonly entry: string | null
  /** Under what the tab keeps that it loaded the page anew. */
  readonly key: string
  /** The id of the sentence. */
  readonly notice: string
}

/** Watches the entry of a page: loads the page anew once, then says the sentence. */
export declare function watchEntry(
  window: Pick<Window, 'addEventListener' | 'document' | 'location' | 'sessionStorage'>,
  shell: GuardedShell,
): void

/** The file the build writes: the watch, told its shell by the element that loads it. */
export declare function guardScript(): string

/** The sentence of a shell whose entry did not start, hidden until the watch shows it. */
export declare function noticeOf(name: string): string

/** A built shell with the watch before its entry script and the sentence in its body. */
export declare function guarded(
  html: string,
  guard: { readonly file: string; readonly name: string },
): string

/** The plugin of the build that guards both shells of an application. */
export declare function entryGuard(application: { readonly name: string }): Plugin
