import type { EntryIcons, EntryWords } from '@opengewerk/platform-web/tools/manifests'

import { applicationName } from '../app/name.js'

/**
 * What the two web app manifests of this application say: what each entry is
 * called and what it is for, and its icon.
 *
 * The rest of both is the foundation's (`entryManifests` in
 * `@opengewerk/platform-web/tools/manifests`, ADR 0010): where each entry
 * starts and how far it reaches, its colours, and how the icon is offered.
 * The build hands it these.
 *
 * The icons come from `assets/brand`, which the build serves as `/brand`.
 * There is no second copy of them in this package: the brand files live in the
 * organisation repository and are copied here once, never twice.
 */

export const icons = {
  192: '/brand/opengewerk-app-icon-192.png',
  512: '/brand/opengewerk-app-icon-512.png',
} satisfies EntryIcons

export const officeWords = {
  name: applicationName,
  short_name: applicationName,
  description: 'Handwerkersoftware für den Betrieb: Kunden, Objekte, Anlagen und Aufträge.',
} satisfies EntryWords

export const siteWords = {
  name: `${applicationName} Baustelle`,
  short_name: 'Baustelle',
  description: 'Die Aufträge des Tages, auch ohne Netz.',
} satisfies EntryWords
