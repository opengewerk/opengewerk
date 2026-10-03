import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkWidths } from '@opengewerk/platform-web/tools/widths'

/**
 * Every screen of this application at the widths of the board "Breiten und
 * Auflösungen", light and dark (#218), measured by the foundation's tool
 * (ADR 0010) against the preview (`pnpm run preview`), where every request
 * counts as the owner of a sample business. What the tool cannot find by
 * following links, this application names.
 */
await checkWidths({
  report: resolve(dirname(fileURLToPath(import.meta.url)), '..', 'widths-report'),

  /**
   * Where the walk starts: the office, the site, and the account, which is
   * behind the menu under the name and not behind a link on any page. And the
   * page the browser of a phone opens for a label (#308), which only a scan
   * reaches, here with a code no label has, so that it says so.
   */
  entries: ['/', '/m/', '/konto', `/a/${'0'.repeat(16)}`],

  /**
   * Pages only a scan reaches, found through a link to the same record: the
   * installation a label opens on the site (#308) is the one the office links
   * to under `/anlagen/<id>`. From there the walk follows its links as usual.
   */
  scannedOnly: [[/^\/anlagen\/([^/]+)$/, (id) => `/m/anlagen/${id}`]],

  /**
   * The buttons that open a form without an address of its own, or go to one
   * without a link: the forms of a customer and of a site hold the tags a
   * person can remove, and the walk, which follows links, never saw them
   * (Greptile on #446). A page that has one is checked a second time as a
   * kind of its own, with the button pressed. Found like the pages, by its
   * name, so that the next form with the same button is checked as well. The
   * new position of a document and the material of a report open the choice
   * of an article (#296). The preview plants a quote and a report in draft as
   * its newest documents, so that the walk meets them among the first of
   * their kind: the quote with a price per 100 (#456), the report on site.
   */
  openers: ['Bearbeiten', 'Position hinzufügen', 'Material eintragen'],
})
