import {
  countryProblem,
  correctionProblem,
  locationProblem,
  timeEntryProblem,
  deviceInfoProblem,
  inverterLinkProblem,
  jobNoteProblem,
  linePositionProblem,
  lumpSumPriceBaseProblem,
  priceBaseProblem,
  noteTimeProblem,
  pvSystemLinkProblem,
  servicePeriodProblem,
  signerNameProblem,
  supplierProblems,
  titleAmountProblem,
  tradeAttachments,
  tradeContacts,
} from '@opengewerk/domain'
import {
  attachmentRecordRules,
  contactRecordRules,
  type RecordRule,
  type RecordRules,
  recordRuleRefusal,
} from '@opengewerk/platform-server'

// Whose mistake a broken rule is, a conflict or a refusal of the transmission,
// is the foundation's and the same for every application (ADR 0010,
// `recordRuleRefusal`). The rules are this application's.

/**
 * The country of an address (#144), the same for a customer and a site. Left
 * out, the database writes Germany, and a device that never sent a country,
 * the site app among them, is not refused for it.
 */
const country: RecordRule = {
  fields: ['country'],
  problem: (at) => {
    const value = at('country')

    return value === undefined ? null : countryProblem(value)
  },
}

/**
 * The checks on the tables of the sync that nothing else in `applyOne` asks,
 * each put as the rule from `domain` the forms ask as well.
 *
 * Left to the database, every one of them refused the whole transmission with
 * "Die Angaben passen nicht zum Datenmodell.", everything the device had sent
 * with it included, and the device sent the same stack again at the next
 * exchange. A service period that ended before it began was enough, typed in
 * the head of an invoice in the office (#118).
 *
 * The other checks are asked where they belong: a contact's parent, the
 * figures of a circuit, the payment term and the path of a signature, the
 * net amount of a line, which the server works out itself, and the job a
 * follow-up follows, which is a question about another record (#170).
 *
 * A battery, a meter or a wallbox names the PV system it belongs to, and an
 * inverter only with it (#300): two rules over the installation's own fields,
 * which the checks and the trigger in the database hold as well. Whether the
 * system and the inverter fit is a question about other records, asked with
 * the references (`pvLinkRefusal`).
 *
 * The versions of an attachment have no check in the database for type, size
 * and hash, and are here all the same (#77). Their key onto `files` holds the
 * hash and the size of what it finds, and a version that breaks one of these
 * is a mistake of the client that should say so, not reach the key. These
 * rules and the one over the places of a file are the foundation's
 * (opengewerk-haustechnik#97), asked with the four places and the sentences
 * of this application.
 */
const rules: RecordRules = {
  ...attachmentRecordRules(tradeAttachments),
  customers: [country],
  sites: [country],
  // A contact (#121) under the rules of the foundation
  // (opengewerk-haustechnik#85): the family name no contact does without,
  // and one that hangs on a customer, a site and a supplier at once. A form
  // makes a contact on the screen of what it belongs to and has no way to
  // name another as well, so on several it is a mistake only the client can
  // make, and the answer is the sentence of the rule.
  contacts: contactRecordRules(tradeContacts),
  // A supplier is master data a device may create (#296): its name, the
  // customer number there and its short code, as `supplierProblems` and the
  // checks hold them.
  suppliers: [
    country,
    {
      fields: ['name'],
      problem: (at) => supplierProblems({ name: at('name') })['name'] ?? null,
    },
    {
      fields: ['customerNumber'],
      problem: (at) =>
        supplierProblems({ customerNumber: at('customerNumber') })['customerNumber'] ?? null,
    },
    // The short code an import appends to a number that is taken (#297).
    {
      fields: ['shortCode'],
      problem: (at) => supplierProblems({ shortCode: at('shortCode') })['shortCode'] ?? null,
    },
  ],
  installations: [
    {
      fields: ['kind', 'pvSystemId'],
      problem: (at) => pvSystemLinkProblem(at('kind'), at('pvSystemId')),
    },
    {
      fields: ['pvSystemId', 'inverterId'],
      problem: (at) => inverterLinkProblem(at('pvSystemId'), at('inverterId')),
    },
  ],
  documents: [
    {
      fields: ['serviceFrom', 'serviceUntil'],
      problem: (at) => servicePeriodProblem(at('serviceFrom'), at('serviceUntil')),
    },
  ],
  document_lines: [
    { fields: ['position'], problem: (at) => linePositionProblem(at('position')) },
    // Left out, the column gives one: a device of a version before #456 sends none.
    {
      fields: ['priceBase'],
      problem: (at) => (at('priceBase') === undefined ? null : priceBaseProblem(at('priceBase'))),
    },
    {
      fields: ['unit', 'priceBase'],
      problem: (at) => lumpSumPriceBaseProblem({ unit: at('unit'), priceBase: at('priceBase') }),
    },
    {
      fields: ['kind', 'quantityMilli', 'unitPriceCents'],
      problem: (at) =>
        titleAmountProblem({
          kind: at('kind'),
          quantityMilli: at('quantityMilli'),
          unitPriceCents: at('unitPriceCents'),
        }),
    },
  ],
  document_signatures: [
    { fields: ['signerName'], problem: (at) => signerNameProblem(at('signerName')) },
    { fields: ['deviceInfo'], problem: (at) => deviceInfoProblem(at('deviceInfo')) },
  ],
  time_entries: [
    {
      fields: ['startedAt', 'endedAt'],
      problem: (at) => timeEntryProblem({ startedAt: at('startedAt'), endedAt: at('endedAt') }),
    },
    {
      fields: ['correctsEntryId', 'note', 'withdrawn'],
      problem: (at) =>
        correctionProblem({
          correctsEntryId: at('correctsEntryId'),
          note: at('note'),
          withdrawn: at('withdrawn'),
        }),
    },
    {
      fields: [
        'startLatitudeMicro',
        'startLongitudeMicro',
        'endLatitudeMicro',
        'endLongitudeMicro',
      ],
      problem: (at) =>
        locationProblem({
          startLatitudeMicro: at('startLatitudeMicro'),
          startLongitudeMicro: at('startLongitudeMicro'),
          endLatitudeMicro: at('endLatitudeMicro'),
          endLongitudeMicro: at('endLongitudeMicro'),
        }),
    },
  ],
  job_notes: [
    { fields: ['text'], problem: (at) => jobNoteProblem(at('text')) },
    { fields: ['writtenAt'], problem: (at) => noteTimeProblem(at('writtenAt')) },
  ],
}

/**
 * The first rule this operation would break, judged on the record as it would
 * stand afterwards, and how to answer it; null when it breaks none. Only the
 * rules whose fields the operation touches: one it leaves alone stands as the
 * database already holds it.
 */
export const ruleRefusal = recordRuleRefusal(rules)
