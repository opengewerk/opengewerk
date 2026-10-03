import type { Plugin } from 'vite'

// The types of `manifests.js`, for the vite configuration of an application,
// which TypeScript checks. Written beside the script and not generated from
// it: the package has no build, and `manifests.test.js` holds the script to
// what is declared here.

/** What an entry is called where its manifest is read. */
export interface EntryWords {
  /** What the installed application is called. */
  readonly name: string
  /** What stands under its icon, where the whole name has no room. */
  readonly short_name: string
  /** What it is, in one sentence. */
  readonly description: string
}

/** The icon of an application, as PNG, at the two sizes a manifest names. */
export interface EntryIcons {
  /** 192 pixels square. */
  readonly 192: string
  /** 512 pixels square; Android also cuts it into its own shape. */
  readonly 512: string
}

export interface ManifestIcon {
  readonly src: string
  readonly sizes: string
  readonly type: string
  readonly purpose?: string
}

export interface WebManifest extends EntryWords {
  readonly start_url: string
  readonly scope: string
  readonly display: string
  readonly background_color: string
  readonly theme_color: string
  readonly lang: string
  readonly dir: string
  readonly icons: readonly ManifestIcon[]
}

/** What stands in both shells where the name of the application goes. */
export declare const namePlaceholder: '%APPLICATION_NAME%'

/** One manifest: what an entry is called and where it starts, with what both entries share. */
export declare function webManifest(
  entry: EntryWords & { readonly start_url: string },
  icons: EntryIcons,
): WebManifest

/** The plugin of the build that writes both manifests and puts the name into both shells. */
export declare function entryManifests(application: {
  readonly name: string
  readonly icons: EntryIcons
  readonly office: EntryWords
  readonly site: EntryWords
}): Plugin
