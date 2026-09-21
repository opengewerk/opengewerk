import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
} from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'

import { ciiInvoice } from './cii.js'
import { checkedCii } from './cii-schema.js'
import { readRendererConfiguration, rendererFor } from './renderer.js'
import { printJob } from './template.js'
import { finalInvoice, samples } from './test-samples.js'
import { zugferdPdf } from './zugferd.js'

/**
 * The ZUGFeRD PDF, on a PDF made here and, in the CI, on invoices the real
 * renderer printed.
 *
 * What is tested here is the structure: the attachment, the relationship that
 * says it is the invoice, the metadata that names the profile, and that the
 * page is left alone. Whether the result is a valid PDF/A-3 and a valid
 * ZUGFeRD is for Mustang to say, which needs Java: the CI job "E-Rechnung
 * gegen KoSIT und Mustang" runs this file with `ZUGFERD_SAMPLES_DIR` and a
 * renderer set, and hands what it wrote to Mustang.
 */

const at = new Date('2026-09-21T10:15:30Z')

/** A PDF of one page with something on it, and a title, as Chromium writes one. */
async function printed(): Promise<Uint8Array> {
  const document = await PDFDocument.create()

  document.setTitle('Schlussrechnung RE-2026-0003, Elektro Nord GmbH')
  document.addPage().drawRectangle({ x: 50, y: 50, width: 200, height: 100 })

  return document.save({ useObjectStreams: false })
}

/** The bytes of every content stream of the first page, as they are stored. */
function pageContents(document: PDFDocument): Uint8Array[] {
  const contents = document.getPage(0).node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents]

  return streams.map((entry) => {
    const stream = document.context.lookup(entry)

    if (!(stream instanceof PDFRawStream)) {
      throw new Error('The page has a content stream that is not raw.')
    }

    return stream.getContents()
  })
}

/** The XMP packet of a document, as text. */
function metadataOf(document: PDFDocument): string {
  const stream = document.catalog.lookup(PDFName.of('Metadata'), PDFStream)

  if (!(stream instanceof PDFRawStream)) {
    throw new Error('The metadata is not a raw stream.')
  }

  return new TextDecoder().decode(decodePDFRawStream(stream).decode())
}

describe('a ZUGFeRD PDF', () => {
  const xml = checkedCii(ciiInvoice(finalInvoice, 'en16931'))

  it('carries the invoice as factur-x.xml, as its alternative and not as a mere attachment', async () => {
    const document = await PDFDocument.load(await zugferdPdf(await printed(), xml, at))
    const attachments = document.getAttachments()

    expect(attachments.map((attachment) => attachment.name)).toEqual(['factur-x.xml'])

    const [attachment] = attachments

    expect(new TextDecoder().decode(attachment?.data)).toBe(xml)
    expect(attachment?.mimeType).toBe('text/xml')
    expect(attachment?.afRelationship).toBe('Alternative')
    expect(attachment?.modificationDate).toEqual(at)

    // PDF/A-3 wants every attachment named in the catalog as well, not only
    // in the name tree a viewer lists.
    expect(document.catalog.lookup(PDFName.of('AF'), PDFArray).size()).toBe(1)
  })

  it('says in its metadata that it is PDF/A-3 and which profile the invoice follows', async () => {
    const document = await PDFDocument.load(await zugferdPdf(await printed(), xml, at))
    const metadata = metadataOf(document)

    expect(metadata).toContain('<pdfaid:part>3</pdfaid:part>')
    expect(metadata).toContain('<pdfaid:conformance>B</pdfaid:conformance>')
    expect(metadata).toContain('<fx:DocumentType>INVOICE</fx:DocumentType>')
    expect(metadata).toContain('<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>')
    expect(metadata).toContain('<fx:Version>1.0</fx:Version>')
    expect(metadata).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>')
    // The extension schema, without which a PDF/A validator refuses the fx
    // properties as unknown.
    expect(metadata).toContain('urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#')

    const [intent] = document.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).asArray()

    expect(
      (document.context.lookup(intent) as PDFDict).lookup(PDFName.of('S'), PDFName).asString(),
    ).toBe('/GTS_PDFA1')
  })

  it('keeps the title the page gave it and says when it was made', async () => {
    const document = await PDFDocument.load(await zugferdPdf(await printed(), xml, at), {
      updateMetadata: false,
    })

    expect(document.getTitle()).toBe('Schlussrechnung RE-2026-0003, Elektro Nord GmbH')
    expect(document.getCreator()).toBe('OpenGewerk')
    expect(document.getModificationDate()).toEqual(at)
    expect(metadataOf(document)).toContain('Schlussrechnung RE-2026-0003, Elektro Nord GmbH')
  })

  it('leaves the page as it was printed', async () => {
    const original = await printed()
    const before = pageContents(await PDFDocument.load(original))
    const after = pageContents(await PDFDocument.load(await zugferdPdf(original, xml, at)))

    expect(after).toEqual(before)
  })
})

/**
 * A logo that fades out from left to right, in copper.
 *
 * Built here rather than kept as a file, because what matters is only that
 * its pixels are partly transparent: Chromium then puts a soft mask on the
 * page, and transparency is what PDF/A is most particular about. Nearly every
 * business has a logo, and many of them are PNGs like this one.
 */
function fadingLogo(): Uint8Array {
  const width = 96
  const height = 24
  const rows = Buffer.alloc((width * 4 + 1) * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * (width * 4 + 1) + 1 + x * 4

      rows.set([0xc8, 0x67, 0x1f, Math.round((255 * x) / (width - 1))], pixel)
    }
  }

  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    const crc = Buffer.alloc(4)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])

    length.writeUInt32BE(data.length)
    crc.writeUInt32BE(crc32(body))

    return Buffer.concat([length, body, crc])
  }

  const header = Buffer.alloc(13)

  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  // Eight bits a channel, red, green, blue and alpha.
  header.set([8, 6, 0, 0, 0], 8)

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe.runIf(process.env['ZUGFERD_SAMPLES_DIR'])('the ZUGFeRD PDFs of the samples', () => {
  it('come out of the renderer with the invoice inside', { timeout: 180_000 }, async () => {
    const folder = process.env['ZUGFERD_SAMPLES_DIR'] ?? ''
    const render = rendererFor(readRendererConfiguration())

    mkdirSync(folder, { recursive: true })

    // The profile of the standard, because that is the one ZUGFeRD carries.
    // An XRechnung goes out as XML of its own.
    const standard = samples.filter((sample) => sample.profile === 'en16931')

    expect(standard.length).toBeGreaterThanOrEqual(4)

    const printed = [
      ...standard.map((sample) => ({
        name: sample.name.replace(/-en16931$/, ''),
        content: sample.content,
        logo: null,
      })),
      {
        name: 'final-invoice-logo',
        content: finalInvoice,
        logo: { mediaType: 'image/png', bytes: fadingLogo() },
      },
    ]

    for (const sample of printed) {
      const xml = checkedCii(ciiInvoice(sample.content, 'en16931'))
      const pdf = await zugferdPdf(
        await render(printJob(sample.content, { logo: sample.logo })),
        xml,
        at,
      )
      const [attachment] = (await PDFDocument.load(pdf)).getAttachments()

      expect(new TextDecoder().decode(attachment?.data)).toBe(xml)

      writeFileSync(join(folder, `${sample.name}-zugferd.pdf`), pdf)
    }
  })
})
