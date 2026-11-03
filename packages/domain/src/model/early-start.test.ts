import { describe, expect, it } from 'vitest'

import type { IssuerContent } from './document-content.js'
import {
  earlyStartSignatureProblem,
  instructionSheetsFingerprint,
  jobInstructions,
  jobInstructionsRefusal,
  withoutWritingLines,
} from './early-start.js'
import type { InstructionForDocument } from './instruction.js'
import { urgentRepairProblem } from './job.js'

const issuer = {
  name: 'Elektro Kohm GmbH',
  street: 'Industriestraße',
  houseNumber: '12',
  postalCode: '68535',
  city: 'Edingen-Neckarhausen',
  country: 'DE',
  phone: '06203 404 55 0',
  email: 'info@elektro-kohm.de',
} as unknown as IssuerContent

function shipped(template: InstructionForDocument['template'], body: string | null = null) {
  return {
    id: `id-${String(template)}`,
    template,
    title: String(template),
    body,
    kinds: ['quote'],
    consumersOnly: true,
    withDocument: true,
  } satisfies InstructionForDocument
}

const four = [
  shipped('withdrawal'),
  shipped('withdrawal_notes'),
  shipped('withdrawal_form'),
  shipped('early_start'),
  shipped('guarantee_notice'),
  { ...shipped(null, 'Unsere Hausordnung.'), title: 'Hausordnung' },
]

describe('the instructions of a service call (#292)', () => {
  it('are the four of withdrawal, without the notice on goods and without the business own ones', () => {
    const { sheets, gaps } = jobInstructions(four, '2026-11-03', issuer)

    expect(sheets.map((sheet) => sheet.template)).toEqual([
      'withdrawal',
      'withdrawal_notes',
      'withdrawal_form',
      'early_start',
    ])
    expect(gaps).toEqual([])
    // Filled in for a contract about work.
    expect(sheets[0]?.text).toContain('ab dem Tag des Vertragsabschlusses')
  })

  it('let the customer sign the request alone on the device, filled in with the business', () => {
    const { request } = jobInstructions(four, '2026-11-03', issuer)

    expect(request).toMatch(/^Ich verlange ausdrücklich, dass Elektro Kohm GmbH mit/)
    expect(request).not.toContain('Vordruck')
  })

  it('take a changed sheet for an early start without its lines to write on', () => {
    const changed = four.map((instruction) =>
      instruction.template === 'early_start'
        ? { ...instruction, body: 'Bitte früher anfangen.\n\nOrt, Datum\n___\nUnterschrift\n___' }
        : instruction,
    )
    const { request } = jobInstructions(changed, '2026-11-03', issuer)

    expect(request).toBe('Bitte früher anfangen.')
  })

  it('are only for a service call for a consumer', () => {
    expect(jobInstructionsRefusal({ kind: 'service' }, { isBusiness: false })).toBeNull()
    expect(jobInstructionsRefusal({ kind: 'project' }, { isBusiness: false })).toContain('Projekt')
    expect(jobInstructionsRefusal({ kind: 'service' }, { isBusiness: true })).toContain(
      'kein Widerrufsrecht',
    )
  })

  it('are marked so that a changed word changes the mark', () => {
    const { sheets, request } = jobInstructions(four, '2026-11-03', issuer)
    const mark = instructionSheetsFingerprint(sheets, request)

    expect(instructionSheetsFingerprint(sheets, request)).toBe(mark)
    expect(
      instructionSheetsFingerprint(
        sheets.map((sheet, index) => (index === 0 ? { ...sheet, text: `${sheet.text}.` } : sheet)),
        request,
      ),
    ).not.toBe(mark)
    expect(instructionSheetsFingerprint(sheets, `${String(request)} `)).not.toBe(mark)
  })
})

describe('the request for an early start', () => {
  it('needs the name and a signature as OpenGewerk draws one', () => {
    expect(earlyStartSignatureProblem('Klaus Lehmann', 'M10,10L20,20')).toBeNull()
    expect(earlyStartSignatureProblem(' ', 'M10,10L20,20')).not.toBeNull()
    expect(earlyStartSignatureProblem('Klaus Lehmann', 'kritzel')).toBe(
      'Das Verlangen braucht die Unterschrift des Kunden.',
    )
  })
})

describe('lines to write on', () => {
  it('go with the label above each, and nothing else does', () => {
    expect(withoutWritingLines('A\n\nOrt\n___\nB\n___\n\nC')).toBe('A\n\nC')
  })
})

describe('the mark of an urgent repair', () => {
  it('is yes or no', () => {
    expect(urgentRepairProblem(true)).toBeNull()
    expect(urgentRepairProblem(undefined)).toBeNull()
    expect(urgentRepairProblem('ja')).toContain('ja oder nein')
  })
})
