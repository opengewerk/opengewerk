import type { IssuerContent } from './document-content.js'

/**
 * The placeholders a signature under a message may carry.
 *
 * Two, and on purpose not more. `{benutzer}` is the one thing a business
 * cannot write down once, because the person a message is sent by changes
 * with the message. `{briefkopf}` is the letterhead as the business keeps it
 * under "Briefkopf", so that a new telephone number is changed in one place
 * and not also in the signature. Everything else a business wants under its
 * mail it writes as it is.
 */
export const signaturePlaceholders = ['{benutzer}', '{briefkopf}'] as const

export type SignaturePlaceholder = (typeof signaturePlaceholders)[number]

/** The signature of a business that has written none: its letterhead. */
export const defaultSignature = '{briefkopf}'

/** How long a signature may be. A letterhead and a few lines, not a newsletter. */
export const signatureMaxLength = 2000

/** The lines that are there, one under the other. */
function lines(candidates: readonly (string | null)[]): string {
  return candidates.filter((line): line is string => line !== null && line.length > 0).join('\n')
}

/**
 * The business at the foot of a message, the way its letterhead has it: name,
 * address, telephone, mail and web, and under a blank line what the footer of
 * every document prints besides, the VAT ID, the commercial register and who
 * represents the business. What a signature says when the business has not
 * written one, and what `{briefkopf}` stands for when it has.
 *
 * A mail to a customer is a business letter, and a business in the commercial
 * register names its register court, its number and, depending on its legal
 * form, its managing directors on every one (section 37a HGB, section 35a
 * GmbHG and their kin, #278). The seat is the town of the address, as decided
 * on 26.09.2026. A signature without `{briefkopf}` carries none of it, which
 * is the business's own choice.
 */
export function letterheadSignature(issuer: IssuerContent): string {
  const street = [issuer.street, issuer.houseNumber].filter(Boolean).join(' ')
  const town = [issuer.postalCode, issuer.city].filter(Boolean).join(' ')
  const register = [issuer.registerCourt, issuer.registerNumber].filter(Boolean).join(', ')

  const contact = lines([
    issuer.name,
    street || null,
    town || null,
    issuer.phone ? `Telefon ${issuer.phone}` : null,
    issuer.email,
    issuer.website,
  ])
  // In the order of the footer of a document, without the tax number, which
  // belongs on an invoice and not under every mail.
  const legal = lines([
    issuer.vatId ? `USt-IdNr. ${issuer.vatId}` : null,
    register || null,
    issuer.managingDirectors,
  ])

  return [contact, legal].filter((block) => block.length > 0).join('\n\n')
}

/**
 * The placeholders in a signature that are not among the known ones, as they
 * were written.
 *
 * `{Benutzer}` is one of them, and so is `{name}`. A placeholder that stayed
 * in a message to a customer as it was typed is the mistake this is here for,
 * and it is caught when the signature is saved rather than when the first
 * customer reads it.
 */
export function unknownPlaceholders(template: string): readonly string[] {
  const written = template.match(/\{[^{}\n]*\}/g) ?? []
  const known: readonly string[] = signaturePlaceholders

  return [...new Set(written.filter((token) => !known.includes(token)))]
}

/**
 * The signature under one message.
 *
 * `sender` is the person a message goes out for: whoever sent a document to a
 * customer or invited somebody. A message nobody sent by hand, a task that
 * fell due or a report signed on site, has none. Every line that names the
 * sender is then left out, rather than printed with a gap where the name
 * would be, and the blank lines around it close up.
 */
export function renderSignature(
  template: string | null,
  facts: { readonly issuer: IssuerContent; readonly sender: string | null },
): string {
  const source = template !== null && template.trim() !== '' ? template : defaultSignature
  const letterhead = letterheadSignature(facts.issuer)

  return source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => facts.sender !== null || !line.includes('{benutzer}'))
    .map((line) =>
      line
        .replaceAll('{benutzer}', facts.sender ?? '')
        .replaceAll('{briefkopf}', letterhead)
        .trimEnd(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
