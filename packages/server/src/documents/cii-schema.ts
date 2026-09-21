import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  XmlDocument,
  XmlParseError,
  XmlValidateError,
  XsdValidator,
  xmlRegisterInputProvider,
} from 'libxml2-wasm'

/**
 * The check an e-invoice passes before it leaves the house: the XML schema of
 * the UN/CEFACT Cross Industry Invoice, version D16B, the one XRechnung and
 * ZUGFeRD are both built on.
 *
 * An e-invoice the recipient's software refuses is worse than a PDF, because
 * nobody notices: the file was sent, the invoice is in the books, and the
 * money does not come. So the file is held against the schema here, every
 * time, and one that fails is not stored and not handed out. Whether the
 * business rules of EN 16931 and XRechnung hold as well is checked by the
 * validator of the KoSIT in the CI, against a set of invoices that covers every
 * branch of the writer; the values that depend on what a business entered are
 * checked before the invoice is issued, see `eInvoiceGaps`.
 *
 * The schema lies in the repository, under `schemas/cii-d16b`, and nothing is
 * fetched from anywhere. A self hosted installation has to be able to write an
 * invoice with the network down.
 */

/** Where the four files of the schema lie, next to `dist` as next to `src`. */
export const schemaFolder = join(dirname(fileURLToPath(import.meta.url)), '../../schemas/cii-d16b')

const entryFile = 'CrossIndustryInvoice_100pD16B.xsd'

/**
 * The address the schema is known under while it is read. Not a file URL:
 * the imports inside it resolve against this, and a reader that only answers
 * for addresses under it can never be talked into reading a file of the
 * machine, whatever a document one day asks for.
 */
const base = 'opengewerk-schema:/cii-d16b/'

export class SchemaCheckError extends Error {}

let validator: XsdValidator | null = null

/**
 * The schema, read once and kept. Reading it costs twenty milliseconds, a
 * check afterwards one; there is no reason to pay the first part per invoice.
 */
function compiled(): XsdValidator {
  if (validator) {
    return validator
  }

  const files = new Map(
    readdirSync(schemaFolder)
      .filter((name) => name.endsWith('.xsd'))
      .map((name) => [base + name, readFileSync(join(schemaFolder, name))]),
  )
  const reading = new Map<number, { readonly bytes: Uint8Array; at: number }>()
  let next = 1

  // The only files the parser may open while it follows the imports: the four
  // above, out of memory.
  xmlRegisterInputProvider({
    match: (name) => files.has(name),
    open: (name) => {
      const bytes = files.get(name)

      if (!bytes) {
        return undefined
      }

      const handle = next

      next += 1
      reading.set(handle, { bytes, at: 0 })

      return handle
    },
    read: (handle, buffer) => {
      const file = reading.get(handle)

      if (!file) {
        return -1
      }

      const count = Math.min(buffer.byteLength, file.bytes.byteLength - file.at)

      buffer.set(file.bytes.subarray(file.at, file.at + count))
      file.at += count

      return count
    },
    close: (handle) => reading.delete(handle),
  })

  const entry = files.get(base + entryFile)

  if (!entry) {
    throw new Error(`The schema ${entryFile} is missing from ${schemaFolder}.`)
  }

  validator = XsdValidator.fromDoc(XmlDocument.fromBuffer(entry, { url: base + entryFile }))

  return validator
}

/**
 * Holds an e-invoice against the schema, says what is wrong if anything is,
 * and hands back the checked document the way it is stored: indented, one
 * element to a line. The writer produces one long line, which a machine reads
 * as well as any other; a person who opens the file, a tax auditor for one,
 * reads this, and a line number in a validator's report points somewhere.
 * Only the whitespace between elements differs, which the standard ignores.
 *
 * The messages are the parser's, in English, with the line: they describe a
 * fault in the writer and not in what somebody entered, and the person who
 * reads them is the one who fixes the writer.
 */
export function checkedCii(xml: string): string {
  const schema = compiled()
  let document: XmlDocument

  try {
    document = XmlDocument.fromString(xml)
  } catch (error) {
    if (error instanceof XmlParseError) {
      throw new SchemaCheckError(`Die E-Rechnung ist kein wohlgeformtes XML: ${error.message}`)
    }

    throw error
  }

  try {
    schema.validate(document)

    return document.toString({ format: true })
  } catch (error) {
    if (error instanceof XmlValidateError) {
      const found = error.details
        .slice(0, 5)
        .map((detail) => `Zeile ${String(detail.line)}: ${detail.message.trim()}`)
        .join(' ')

      throw new SchemaCheckError(`Die E-Rechnung besteht die Schemaprüfung nicht. ${found}`)
    }

    throw error
  } finally {
    document.dispose()
  }
}
