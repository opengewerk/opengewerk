import { describe, expect, it } from 'vitest'

import type { IssuerContent } from '../model/document-content.js'
import {
  filledInstruction,
  instructionPlaceholders,
  instructionTemplates,
  placeholdersIn,
  withdrawalVariants,
} from '../model/instruction.js'
import {
  contractBlocksAt,
  instructionWordingAt,
  latestWording,
  normalizedWording,
  shippedInstructionDefaults,
  shippedWordings,
  wordingAt,
  wordingPackage,
} from './instructions.js'

const issuer: IssuerContent = {
  name: 'Elektro Kohm',
  street: 'Hauptstraße',
  houseNumber: '103',
  postalCode: '68535',
  city: 'Edingen-Neckarhausen',
  country: 'DE',
  phone: '06203 123456',
  email: 'info@elektro-kohm.de',
  website: null,
  taxNumber: null,
  vatId: null,
  iban: null,
  bic: null,
  bankName: null,
  registerCourt: null,
  registerNumber: null,
  managingDirectors: null,
  logo: null,
}

/**
 * The instruction on withdrawal for a contract about work, as it is printed
 * for the business above, written out in full.
 *
 * On purpose a second copy of the words in the package and not a reading of
 * it. The model is a safe harbour only in the law's words, and a change to
 * the package that nobody meant, a word lost in a merge, a quotation mark
 * straightened by an editor, would otherwise go out to every customer of every
 * business. Whoever changes the package on purpose changes this as well and
 * knows why.
 */
const serviceInstruction = [
  '# Widerrufsrecht',
  '',
  'Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu ' +
    'widerrufen.',
  '',
  'Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.',
  '',
  'Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (Elektro Kohm, Hauptstraße 103, 68535 ' +
    'Edingen-Neckarhausen, Telefon 06203 123456, E-Mail info@elektro-kohm.de) mittels einer ' +
    'eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren ' +
    'Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte ' +
    'Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.',
  '',
  'Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des ' +
    'Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.',
  '',
  '# Folgen des Widerrufs',
  '',
  'Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen ' +
    'erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die ' +
    'sich daraus ergeben, dass Sie eine andere Art der Lieferung als die von uns angebotene, ' +
    'günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn ' +
    'Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags ' +
    'bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das ' +
    'Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ' +
    'ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung ' +
    'Entgelte berechnet.',
  '',
  'Haben Sie verlangt, dass die Dienstleistungen während der Widerrufsfrist beginnen soll, so ' +
    'haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, ' +
    'zu dem Sie uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags ' +
    'unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im ' +
    'Vertrag vorgesehenen Dienstleistungen entspricht.',
].join('\n')

function filled(template: 'withdrawal' | 'withdrawal_form' | 'early_start', on: string) {
  const wording = wordingAt(template, on)
  const blocks = contractBlocksAt('service', on)

  if (!wording || !blocks) {
    throw new Error(`No ${template} on ${on}.`)
  }

  return filledInstruction(wording.text, { issuer, blocks })
}

describe('the shipped wordings', () => {
  it('never have two versions of one instruction in force on the same day, and no gap', () => {
    for (const template of instructionTemplates) {
      const versions = shippedWordings
        .filter((wording) => wording.template === template)
        .sort((left, right) => left.validFrom.localeCompare(right.validFrom))

      expect(versions.length, template).toBeGreaterThan(0)
      expect(versions.at(-1)?.validUntil, `${template} ends`).toBeNull()

      for (let index = 1; index < versions.length; index += 1) {
        const earlier = versions[index - 1]
        const later = versions[index]
        const dayAfter = new Date(`${earlier?.validUntil ?? ''}T12:00:00Z`)
        dayAfter.setUTCDate(dayAfter.getUTCDate() + 1)

        expect(later?.validFrom, template).toBe(dayAfter.toISOString().slice(0, 10))
      }
    }
  })

  it('say where they come from and use only known placeholders', () => {
    for (const wording of shippedWordings) {
      expect(wording.source.length, wording.template).toBeGreaterThan(20)
      expect(wording.title.trim(), wording.template).not.toBe('')

      for (const token of placeholdersIn(wording.text)) {
        expect(Object.keys(instructionPlaceholders), `${wording.template} ${token}`).toContain(
          token,
        )
      }
    }
  })

  it('give every version of the instruction on withdrawal both kinds of contract', () => {
    for (const wording of shippedWordings.filter((entry) => entry.template === 'withdrawal')) {
      for (const variant of withdrawalVariants) {
        expect(wording.contract?.[variant]?.fristbeginn, variant).toBeTruthy()
        expect(wording.contract?.[variant]?.folgen, variant).toBeTruthy()
      }
    }
  })

  it('carry no dash of the kind the repository keeps out', () => {
    // Built from their code points, so that this file does not carry them either.
    const dashes = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)]
    const written = JSON.stringify(wordingPackage)

    expect(dashes.filter((dash) => written.includes(dash))).toEqual([])
  })

  it('have a start for every shipped instruction', () => {
    for (const template of instructionTemplates) {
      expect(shippedInstructionDefaults[template].kinds.length, template).toBeGreaterThan(0)
    }
  })
})

describe('the version of a day', () => {
  it('is the one in force on it, the law of 2026 from the day it applied', () => {
    expect(wordingAt('withdrawal', '2026-06-18')?.validFrom).toBe('2022-05-28')
    expect(wordingAt('withdrawal', '2026-06-19')?.validFrom).toBe('2026-06-19')
    expect(latestWording('withdrawal')?.validFrom).toBe('2026-06-19')
  })

  it('is none before the first version that shipped', () => {
    expect(wordingAt('withdrawal', '2022-05-27')).toBeNull()
    expect(contractBlocksAt('service', '2022-05-27')).toBeNull()
  })
})

describe('the instruction on withdrawal, filled in', () => {
  it('is the model of annex 1 word for word, for work', () => {
    expect(filled('withdrawal', '2026-09-22')).toBe(serviceInstruction)
  })

  it('reads the same under the version before 2026, which changed no printed word', () => {
    expect(filled('withdrawal', '2025-03-01')).toBe(serviceInstruction)
  })

  it('names the day the goods arrive and offers to fetch them, for a delivery', () => {
    const wording = wordingAt('withdrawal', '2026-09-22')
    const blocks = contractBlocksAt('goods', '2026-09-22')
    const text = filledInstruction(wording?.text ?? '', {
      issuer,
      blocks: blocks ?? serviceBlocks(),
    })

    expect(text).toContain(
      'Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem Sie oder ein von Ihnen ' +
        'benannter Dritter, der nicht der Beförderer ist, die Waren in Besitz genommen haben ' +
        'bzw. hat.',
    )
    expect(text).toContain(
      'Wir holen die Waren ab. Wir tragen die Kosten der Rücksendung der Waren.',
    )
    expect(text).not.toContain('Dienstleistungen während der Widerrufsfrist')
  })

  it('addresses the form to the business with its e-mail address and without its telephone', () => {
    const form = filled('withdrawal_form', '2026-09-22')

    expect(form).toContain(
      '- An Elektro Kohm, Hauptstraße 103, 68535 Edingen-Neckarhausen, E-Mail info@elektro-kohm.de:',
    )
    expect(form).not.toContain('06203')
    expect(form).toContain('(*) Unzutreffendes streichen.')
  })
})

function serviceBlocks() {
  const blocks = contractBlocksAt('service', '2026-09-22')

  if (!blocks) {
    throw new Error('No blocks.')
  }

  return blocks
}

describe('the words of an instruction on a day', () => {
  const shipped = { template: 'withdrawal' as const, title: 'Widerrufsbelehrung', body: null }

  it('are the model of that day for a shipped instruction nobody changed', () => {
    const words = instructionWordingAt(shipped, '2026-09-22')

    expect(words?.changed).toBe(false)
    expect(words?.text).toBe(wordingAt('withdrawal', '2026-09-22')?.text)
    expect(words?.wording?.validFrom).toBe('2026-06-19')
  })

  it('are none for a shipped instruction on a day before its first version', () => {
    expect(instructionWordingAt(shipped, '2020-01-01')).toBeNull()
  })

  it('are the business own for one it changed, still tied to the model it came from', () => {
    const words = instructionWordingAt({ ...shipped, body: 'Eigener Text.' }, '2026-09-22')

    expect(words).toMatchObject({
      title: 'Widerrufsbelehrung',
      text: 'Eigener Text.',
      changed: true,
    })
    expect(words?.wording?.template).toBe('withdrawal')
  })

  it('are its own for an instruction the business wrote, on any day', () => {
    expect(
      instructionWordingAt({ template: null, title: 'AGB', body: 'Es gilt.' }, '1999-01-01'),
    ).toEqual({ title: 'AGB', text: 'Es gilt.', wording: null, changed: false })
  })
})

describe('a wording compared', () => {
  it('ignores line endings, spaces at the end of a line and empty lines around it', () => {
    expect(normalizedWording('\r\n Eins  \r\nZwei\t\r\n\r\n')).toBe('Eins\nZwei')
    expect(normalizedWording(wordingAt('withdrawal', '2026-09-22')?.text ?? '')).toBe(
      wordingAt('withdrawal', '2026-09-22')?.text,
    )
  })
})
