import { describe, expect, it } from 'vitest'

import {
  declarationBlank,
  type FundingEvidence,
  fundingChecklist,
  fundingProgramProblems,
  fundingProgramsFor,
  filledDeclaration,
} from './funding-program.js'

const evidence: readonly FundingEvidence[] = [
  { source: 'invoice', label: 'Rechnung mit Einzelpositionen' },
  { source: 'declaration', label: 'Fachunternehmererklärung' },
  { source: 'commissioning', label: 'Inbetriebnahmeprotokoll' },
  { source: 'photos', label: 'Foto mit Typenschild' },
  { source: 'serial_numbers', label: 'Seriennummer der Wallbox' },
  { source: 'operator', label: 'Kontoauszug' },
  { source: 'operator', label: 'Ökostromvertrag' },
]

const program = {
  name: 'Ladeinfrastruktur 2026',
  sponsor: 'Stadtwerke',
  url: 'https://stadtwerke.example.org/foerderung',
  kinds: ['wallbox'],
  evidence,
  declaration: 'Hiermit bestätigt {betrieb}, dass {anlage} am {inbetriebnahme} in Betrieb ging.',
}

describe('a funding programme as a template (#307)', () => {
  it('holds with a name, a kind, its proofs and the text of its declaration', () => {
    expect(fundingProgramProblems(program)).toEqual({})
  })

  it('needs a name, and a kind that papers can be put together for', () => {
    expect(fundingProgramProblems({ ...program, name: '  ' })).toEqual({
      name: 'Ein Förderprogramm braucht einen Namen.',
    })

    const kinds = 'Ein Förderprogramm gilt für eine PV-Anlage, einen Speicher oder eine Wallbox.'

    expect(fundingProgramProblems({ ...program, kinds: [] })).toEqual({ kinds })
    expect(fundingProgramProblems({ ...program, kinds: ['heating'] })).toEqual({ kinds })
    expect(fundingProgramProblems({ ...program, kinds: ['wallbox', 'wallbox'] })).toEqual({ kinds })
  })

  it('asks for at least one proof and at most twenty, each from a known source with a name', () => {
    expect(fundingProgramProblems({ ...program, evidence: [] })).toEqual({
      evidence: 'Ein Förderprogramm verlangt mindestens einen Nachweis.',
    })
    expect(
      fundingProgramProblems({
        ...program,
        evidence: Array.from({ length: 21 }, () => ({ source: 'operator', label: 'Beleg' })),
      }),
    ).toEqual({ evidence: 'Ein Förderprogramm hat höchstens 20 Nachweise.' })
    expect(
      fundingProgramProblems({ ...program, evidence: [{ source: 'contract', label: 'Vertrag' }] }),
    ).toEqual({ evidence: 'Ein Nachweis kommt aus OpenGewerk oder vom Betreiber.' })
    expect(
      fundingProgramProblems({ ...program, evidence: [{ source: 'operator', label: ' ' }] }),
    ).toEqual({ evidence: 'Jeder Nachweis braucht den Namen, den das Programm ihm gibt.' })
  })

  it('lays in each proof of OpenGewerk once, and lets the operator bring as many as asked', () => {
    expect(
      fundingProgramProblems({
        ...program,
        evidence: [...evidence, { source: 'invoice', label: 'Schlussrechnung' }],
      }),
    ).toEqual({
      evidence:
        'Rechnung steht nur einmal in der Liste; die Förderunterlagen legen sie einmal bei.',
    })
  })

  it('knows the placeholders of a declaration and refuses one it does not', () => {
    expect(fundingProgramProblems({ ...program, declaration: 'Für {kunde} am {datum}.' })).toEqual({
      declaration: 'Den Platzhalter {kunde} kennt OpenGewerk nicht.',
    })
    expect(
      fundingProgramProblems({
        ...program,
        declaration: 'Kapazität {kapazität}, Leistung {leistung}.',
      }),
    ).toEqual({})
  })

  it('wants the text of a declaration it asks for, and none where it asks for none', () => {
    const sentence = 'Eine Fachunternehmererklärung braucht ihren Text.'

    expect(fundingProgramProblems({ ...program, declaration: null })).toEqual({
      declaration: sentence,
    })
    expect(fundingProgramProblems({ ...program, declaration: '  ' })).toEqual({
      declaration: sentence,
    })
    expect(
      fundingProgramProblems({
        ...program,
        evidence: evidence.filter((entry) => entry.source !== 'declaration'),
        declaration: null,
      }),
    ).toEqual({})
  })

  it('takes a page on the web only as an address', () => {
    expect(fundingProgramProblems({ ...program, url: 'stadtwerke.example.org' })).toEqual({
      url: 'Die Seite ist eine Adresse, die mit https:// beginnt.',
    })
  })

  it('offers at an installation the programmes for its kind, by name', () => {
    const programs = [
      { name: 'Speicher 2026', kinds: ['battery' as const] },
      { name: 'Wallbox und Speicher', kinds: ['wallbox' as const, 'battery' as const] },
      { name: 'Ladeinfrastruktur', kinds: ['wallbox' as const] },
    ]

    expect(fundingProgramsFor(programs, 'wallbox').map((entry) => entry.name)).toEqual([
      'Ladeinfrastruktur',
      'Wallbox und Speicher',
    ])
    expect(fundingProgramsFor(programs, 'meter')).toEqual([])
  })
})

describe('the papers of a programme for an installation (#307)', () => {
  it('fills the declaration from the installation, and leaves a line where it says nothing', () => {
    expect(
      filledDeclaration(program.declaration, {
        betrieb: 'Elektro Kohm GmbH',
        anlage: ' Wallbox Garage ',
        inbetriebnahme: null,
      }),
    ).toBe(
      `Hiermit bestätigt Elektro Kohm GmbH, dass Wallbox Garage am ${declarationBlank} in Betrieb ging.`,
    )
  })

  it('lays in what OpenGewerk holds, misses what it does not, and lists what the operator brings', () => {
    const states = fundingChecklist(evidence, {
      invoices: 1,
      commissioning: 0,
      photos: 2,
      serialNumbers: 1,
      declaration: true,
    }).map((entry) => entry.state)

    expect(states).toEqual([
      'enclosed',
      'enclosed',
      'missing',
      'enclosed',
      'enclosed',
      'operator',
      'operator',
    ])
    expect(
      fundingChecklist(evidence, {
        invoices: 0,
        commissioning: 1,
        photos: 0,
        serialNumbers: 0,
        declaration: false,
      }).map((entry) => entry.state),
    ).toEqual(['missing', 'missing', 'enclosed', 'missing', 'missing', 'operator', 'operator'])
  })
})
