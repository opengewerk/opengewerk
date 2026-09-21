import { embedFacturX, PDFDocument } from '@cantoo/pdf-lib'

/**
 * The ZUGFeRD PDF of an issued invoice: the PDF the business sends anyway,
 * with the e-invoice inside.
 *
 * ZUGFeRD 2 and Factur-X are one format under two names. The XML is the same
 * Cross Industry Invoice the XRechnung is written in, here in the profile of
 * the standard itself, attached under the name `factur-x.xml`. The PDF around
 * it has to be PDF/A-3, the archive format that allows an attachment, and its
 * metadata says which attachment is the invoice and in which profile.
 *
 * What makes a PDF a PDF/A-3 is added here: an identifier, the colour space
 * the page was meant for, and the metadata in XMP beside the information
 * dictionary, the two saying the same. What the page itself has to be, fonts
 * embedded and nothing fetched from outside, is what Chromium delivers
 * anyway. Whether both together pass is checked by Mustang in the CI, against
 * invoices printed by the real renderer, because no test in this process can
 * say it.
 */

/** What the attachment is called in a viewer's list of attached files. */
const description = 'Rechnungsdaten nach EN 16931 (ZUGFeRD)'

/**
 * Turns the PDF of an invoice into its ZUGFeRD PDF.
 *
 * The page stays the page that was printed, down to the byte of every content
 * stream: the PDF is rewritten around it, not printed again. `at` is when the
 * file is made, and it goes into the dates of the file and of its attachment.
 */
export async function zugferdPdf(pdf: Uint8Array, xml: string, at: Date): Promise<Uint8Array> {
  // The metadata Chromium wrote stays: the title it took from the page, and
  // the program that drew it. Loading with the default would sign the file as
  // pdf-lib's and date it anew, and the XMP would then say so too.
  const document = await PDFDocument.load(pdf, { updateMetadata: false })

  document.setCreator('OpenGewerk')
  document.setModificationDate(at)

  await embedFacturX(document, new TextEncoder().encode(xml), {
    conformanceLevel: 'EN 16931',
    description,
    creationDate: at,
    modificationDate: at,
  })

  return document.save()
}
