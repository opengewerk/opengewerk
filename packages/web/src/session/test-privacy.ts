import type { PrivacyDocumentsSummary } from '@opengewerk/domain'

/** What the three cards of the documents on data protection say in a test (#319). */
export const aDocumentsSummary: PrivacyDocumentsSummary = {
  record: {
    controller: 'Elektro Kohm GmbH, Hauptstraße 103, 68535 Edingen-Neckarhausen',
    officer: null,
    used: 13,
    confirmed: 9,
    unused: 2,
  },
  measures: { changedOn: '2026-11-02', subprocessors: 2 },
  deletion: { kinds: 6, automatic: [], prospectMonths: 12, customerMonths: 36 },
}
