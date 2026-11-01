import type { QualificationKind } from '@opengewerk/platform-domain'

/**
 * The kinds of qualification the files of the business offer (#287,
 * Feature-Gliederung 4.9): the four the concept names, each with the level
 * of the foundation it stands for. A business adds kinds of its own beside
 * them. The key is "<package>.<key>" as the foundation asks; the electrical
 * ones carry the name of the trade they belong to, as in OpenGewerk
 * Haustechnik, so that the same qualification has the same key in both.
 */
export const qualificationCatalogue: readonly QualificationKind[] = [
  { key: 'elektro.skilled_person', label: 'Elektrofachkraft', level: 'skilled_person' },
  { key: 'elektro.pv_certificate', label: 'PV-Zertifizierung', level: 'skilled_person' },
  { key: 'core.work_at_height', label: 'Höhenarbeit', level: 'instructed_person' },
  { key: 'core.driving_licence', label: 'Führerschein', level: 'instructed_person' },
]

/** The kind of deadline a qualification that runs out makes (`core.json`). */
export const qualificationDeadlineKind = 'qualification.renewal'
