import {
  countryProblem,
  correctionProblem,
  locationProblem,
  timeEntryProblem,
  attachmentHomeProblem,
  attachmentMediaTypeProblem,
  attachmentSizeProblem,
  deviceInfoProblem,
  fileHashProblem,
  jobNoteProblem,
  linePositionProblem,
  noteTimeProblem,
  type Operation,
  type RecordState,
  servicePeriodProblem,
  signerNameProblem,
  titleAmountProblem,
} from '@opengewerk/domain'

/**
 * A rule over the fields of one record, the way a check in the database holds
 * it: the fields it reads, and the sentence for a record that breaks it.
 */
interface RecordRule {
  readonly fields: readonly string[]
  readonly problem: (at: (field: string) => unknown) => string | null
}

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
 * The versions of an attachment have no check in the database for type, size
 * and hash, and are here all the same (#77). Their key onto `files` holds the
 * hash and the size of what it finds, and a version that breaks one of these
 * is a mistake of the client that should say so, not reach the key.
 */
const rules: Readonly<Record<string, readonly RecordRule[]>> = {
  customers: [country],
  sites: [country],
  documents: [
    {
      fields: ['serviceFrom', 'serviceUntil'],
      problem: (at) => servicePeriodProblem(at('serviceFrom'), at('serviceUntil')),
    },
  ],
  document_lines: [
    { fields: ['position'], problem: (at) => linePositionProblem(at('position')) },
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
  attachments: [
    {
      fields: ['customerId', 'siteId', 'installationId', 'jobId'],
      problem: (at) =>
        attachmentHomeProblem({
          customerId: at('customerId'),
          siteId: at('siteId'),
          installationId: at('installationId'),
          jobId: at('jobId'),
        }),
    },
  ],
  job_notes: [
    { fields: ['text'], problem: (at) => jobNoteProblem(at('text')) },
    { fields: ['writtenAt'], problem: (at) => noteTimeProblem(at('writtenAt')) },
  ],
  attachment_versions: [
    { fields: ['sha256'], problem: (at) => fileHashProblem(at('sha256')) },
    {
      fields: ['previewSha256'],
      problem: (at) => {
        const preview = at('previewSha256')

        return preview === null || preview === undefined ? null : fileHashProblem(preview)
      },
    },
    { fields: ['mediaType'], problem: (at) => attachmentMediaTypeProblem(at('mediaType')) },
    {
      fields: ['sizeBytes'],
      problem: (at) => {
        const size = at('sizeBytes')

        return attachmentSizeProblem(typeof size === 'number' ? size : Number.NaN)
      },
    },
  ],
}

/** How a broken rule is answered: by refusing the transmission, or as a conflict about one operation. */
export type RuleRefusal =
  | { readonly kind: 'client'; readonly message: string }
  | {
      readonly kind: 'conflict'
      readonly reason: 'changed_elsewhere'
      readonly fields: readonly string[]
    }

/**
 * The first rule this operation would break, judged on the record as it would
 * stand afterwards, and how to answer it; null when it breaks none.
 *
 * Whose mistake a broken rule is follows from the fields the operation sets.
 * When it sets every field the rule reads, or makes the record, the break is
 * in its own values, and its form asked the same rule of those values before
 * anything was queued: a mistake only the client can make, refused with the
 * sentence for the whole transmission, like a payment term out of range. When
 * it sets only some of them, the break comes from a value it did not set, and
 * the form judged by the value it had in front of it. That value has changed
 * since, so somebody else wrote the other half: two changes that each fit and
 * do not fit together, which is a conflict about this one operation, with all
 * the fields of the rule for a person to look at.
 *
 * Only the rules whose fields the operation touches: one it leaves alone
 * stands as the database already holds it.
 */
export function ruleRefusal(
  operation: Operation,
  values: Readonly<Record<string, unknown>>,
  current: RecordState | null,
): RuleRefusal | null {
  if (operation.kind === 'delete') {
    return null
  }

  const at = (field: string) => (field in values ? values[field] : current?.[field])

  for (const rule of rules[operation.entity] ?? []) {
    const touched = rule.fields.filter((field) => field in values)

    if (operation.kind !== 'create' && touched.length === 0) {
      continue
    }

    const problem = rule.problem(at)

    if (problem === null) {
      continue
    }

    return operation.kind === 'create' || touched.length === rule.fields.length
      ? { kind: 'client', message: problem }
      : { kind: 'conflict', reason: 'changed_elsewhere', fields: rule.fields }
  }

  return null
}
