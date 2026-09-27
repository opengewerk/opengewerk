import { readFile } from 'node:fs/promises'

import { PDFDocument } from '@cantoo/pdf-lib'
import { shippedWordings } from '@opengewerk/domain'
import { describe, expect, it } from 'vitest'

import {
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
