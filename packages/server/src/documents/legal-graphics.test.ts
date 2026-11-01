import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { PDFDocument } from '@cantoo/pdf-lib'
import { shippedWordings } from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import { durabilityLabelSvg } from './durability-label.js'
import {
  filledDurabilityLabel,
  isLegalGraphic,
  LegalGraphicError,
  legalGraphicImage,
  legalGraphics,
  legalPage,
  withLegalPages,
} from './legal-graphics.js'

const notice = 'guarantee-notice-de-2025-09-25'

/** A4 in points, the size of the Commission's page. */
const a4 = { width: 595.276, height: 841.89 }

/** A PDF as the renderer returns it, with pages of a size no notice has. */
async function renderedWith(pages: number): Promise<Uint8Array> {
  const document = await PDFDocument.create()

  for (let index = 0; index < pages; index += 1) {
    document.addPage([500, 700])
  }

  return document.save()
}

describe('the pages the law prescribes whole', () => {
  it('ship with every wording that names one', () => {
    const named = shippedWordings.flatMap((wording) =>
      wording.graphic === undefined ? [] : [wording.graphic],
    )

    expect(named).toEqual([notice])
    expect(named.every(isLegalGraphic)).toBe(true)
  })

  it('carry the digests their README names', async () => {
    const readme = await readFile(new URL('../../assets/legal/README.md', import.meta.url), 'utf-8')

    for (const graphic of Object.values(legalGraphics)) {
      expect(readme).toContain(graphic.pdf.sha256)
      expect(readme).toContain(graphic.image.sha256)
    }
  })

  it('are the page of the Commission, in A4, and its picture', async () => {
    const image = await legalGraphicImage(notice)
    const sheet = await PDFDocument.load(await legalPage(notice))
    const size = sheet.getPage(0).getSize()

    expect(image.mediaType).toBe('image/png')
    expect([...image.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(sheet.getPageCount()).toBe(1)
    expect(size.width).toBeCloseTo(a4.width, 1)
    expect(size.height).toBeCloseTo(a4.height, 1)
  })

  it('take the place of the empty last page, and leave every other one', async () => {
    const pdf = await PDFDocument.load(await withLegalPages(await renderedWith(3), [notice]))

    expect(pdf.getPageCount()).toBe(3)
    expect(pdf.getPage(0).getSize()).toEqual({ width: 500, height: 700 })
    expect(pdf.getPage(1).getSize()).toEqual({ width: 500, height: 700 })
    expect(pdf.getPage(2).getSize().width).toBeCloseTo(a4.width, 1)
    expect(pdf.getPage(2).getSize().height).toBeCloseTo(a4.height, 1)
  })

  it('leave a document without them as it was', async () => {
    const rendered = await renderedWith(2)

    expect(await withLegalPages(rendered, [])).toBe(rendered)
  })

  it('refuse a name this version does not ship, and a PDF without room for them', async () => {
    await expect(legalPage('guarantee-notice-xx')).rejects.toThrow(LegalGraphicError)
    await expect(legalGraphicImage('guarantee-notice-xx')).rejects.toThrow(LegalGraphicError)
    await expect(withLegalPages(await renderedWith(1), [notice])).rejects.toThrow(LegalGraphicError)
  })
})

describe('the label of a guarantee of durability (#433)', () => {
  const guarantee = { halfYears: 5, producer: 'Kraft & Söhne', model: 'K<2>' }

  it('is the file of the Commission byte for byte, with the digest its README names', async () => {
    const digest = '3414c8366823db39702d2557e614f882b530487ce589e903afdc98b7225e1ab1'
    const file = await readFile(
      new URL('../../assets/legal/durability-label-2026-03-19.svg', import.meta.url),
    )
    const readme = await readFile(new URL('../../assets/legal/README.md', import.meta.url), 'utf-8')

    expect(readme).toContain(digest)
    expect(createHash('sha256').update(file).digest('hex')).toBe(digest)
    expect(createHash('sha256').update(durabilityLabelSvg, 'utf8').digest('hex')).toBe(digest)
  })

  it('fills its three fields, the model at the right edge, and escapes what it fills in', () => {
    const label = filledDurabilityLabel(durabilityLabelSvg, guarantee, 'one')

    expect(label).toContain('<tspan x="0" y="0">2,5</tspan>')
    expect(label).toContain('<tspan x="0" y="0">Kraft &amp; Söhne</tspan>')
    expect(label).toContain(
      'text-anchor="end" transform="translate(262.9 74.52)"><tspan x="0" y="0">K&lt;2&gt;</tspan>',
    )
    expect(label).not.toContain('Brand/')
    expect(label).not.toContain('Model identifier')
    expect(label).not.toContain('>XX<')
  })

  it('changes nothing else of the file but the names of its ids and classes', () => {
    const source = durabilityLabelSvg
    const label = filledDurabilityLabel(source, guarantee, 'one')
    // Back to the file: the names without their prefix, and the three fields
    // as the Commission wrote them.
    const back = label
      .replaceAll('id="one-', 'id="')
      .replaceAll('url(#one-', 'url(#')
      .replaceAll('.one-cls-', '.cls-')
      .replaceAll(
        /class="([^"]+)"/g,
        (_, names: string) => `class="${names.replaceAll('one-cls-', 'cls-')}"`,
      )
      .replace(
        '<text class="cls-5" transform="translate(6.32 74.52)"><tspan x="0" y="0">Kraft &amp; Söhne</tspan></text>',
        '<text class="cls-5" transform="translate(6.32 74.52)"><tspan x="0" y="0">Brand/</tspan>' +
          '<tspan class="cls-19" x="28.34" y="0">T</tspan><tspan class="cls-22" x="33.61" y="0">rademark</tspan></text>',
      )
      .replace(
        '<text class="cls-5" text-anchor="end" transform="translate(262.9 74.52)"><tspan x="0" y="0">K&lt;2&gt;</tspan></text>',
        '<text class="cls-5" transform="translate(196.75 74.52)"><tspan x="0" y="0">Model identifier</tspan></text>',
      )
      .replace(
        '<text class="cls-3" transform="translate(5.07 150.57)"><tspan x="0" y="0">2,5</tspan></text>',
        '<text class="cls-3" transform="translate(5.07 150.57)"><tspan x="0" y="0">XX</tspan></text>',
      )

    expect(back).toBe(source.slice(source.indexOf('<svg')))
    expect(label.match(/id="(?!one-)/g)).toBeNull()
  })

  it('gives two labels on one page ids of their own', () => {
    const source = durabilityLabelSvg
    const ids = (label: string) => [...label.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
    const first = ids(filledDurabilityLabel(source, guarantee, 'one'))
    const second = ids(filledDurabilityLabel(source, guarantee, 'two'))

    expect(first.length).toBeGreaterThan(0)
    expect(first.filter((id) => second.includes(id))).toEqual([])
  })

  it('takes a dollar sign in a field as a dollar sign, never as a part of the file', () => {
    const label = filledDurabilityLabel(
      durabilityLabelSvg,
      { halfYears: 6, producer: "A$'B$`C", model: '$&$$' },
      'one',
    )

    expect(label).toContain('<tspan x="0" y="0">A$\'B$`C</tspan>')
    expect(label).toContain('<tspan x="0" y="0">$&amp;$$</tspan>')
    expect(label.split('<svg').length).toBe(2)
  })

  it('refuses a file whose fields do not stand where they should', () => {
    const source = durabilityLabelSvg.replace('Model identifier', 'Model')

    expect(() => filledDurabilityLabel(source, guarantee, 'one')).toThrow(LegalGraphicError)
  })
})
