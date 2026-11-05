import { readFileSync } from 'node:fs'

import { describeMeasures, measuresPartA } from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import { measuresTemplate } from './template.js'

/**
 * The template of the measures as the application ships it (#319): every
 * place filled once, part A without a place in it, which the page of the
 * contract on opengewerk.de shows, and the folder in the package.
 */
describe('the template of the measures', () => {
  it('fills every place it has, once', () => {
    const filled = describeMeasures(measuresTemplate(), {
      business: 'Elektro Nord GmbH',
      at: 'am 05.11.2026 um 10:40',
      measures: {},
      subprocessors: [],
      changedAt: null,
    })

    expect(filled).not.toContain('{{')
    expect(filled).toContain('# Technische und organisatorische Maßnahmen für Elektro Nord GmbH')
  })

  it('has a part A that holds no place, as the page of the contract shows it', () => {
    const partA = measuresPartA(measuresTemplate())

    expect(partA.startsWith('## Teil A: Was die Anwendung mitbringt')).toBe(true)
    expect(partA).toContain('### A.7 Datenschutz durch Technikgestaltung')
    expect(partA).not.toContain('{{')
  })

  it('goes into the package beside dist', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { files: string[] }

    expect(manifest.files).toContain('templates')
  })
})
