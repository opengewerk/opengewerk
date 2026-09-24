import {
  type FormDefinition,
  longestFormValues,
  readFormDefinition,
  readFormValues,
  reportDefinitionKey,
  reportFieldLines,
  type ReportFieldContent,
  valuesProblem,
} from '@opengewerk/domain'
import { and, desc, eq } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { formDefinitions } from '../database/schema/index.js'

/**
 * The fields a business gives its reports (#78), as the server reads them:
 * one version out of `form_definitions`, the newest for a new report, and
 * the question whether what a report carries fits the version it names.
 */

/** A version of the business's report fields, or null when there is no such version. */
export async function reportDefinitionAt(
  tx: TenantTransaction,
  version: number,
): Promise<FormDefinition | null> {
  const [row] = await tx
    .select({ definition: formDefinitions.definition })
    .from(formDefinitions)
    .where(
      and(
        eq(formDefinitions.key, reportDefinitionKey),
        eq(formDefinitions.definitionVersion, version),
      ),
    )

  return row ? readFormDefinition(row.definition) : null
}

/** The newest version, the one a report started now is filled in. */
export async function currentReportDefinition(
  tx: TenantTransaction,
): Promise<FormDefinition | null> {
  const [row] = await tx
    .select({ definition: formDefinitions.definition })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, reportDefinitionKey))
    .orderBy(desc(formDefinitions.definitionVersion))
    .limit(1)

  return row ? readFormDefinition(row.definition) : null
}

/**
 * What is wrong with the fields of a document as they would stand after an
 * operation, or null. Values need a version, only a report carries them, the
 * version has to be one this business wrote, and the values have to fit it:
 * the form on site asks the same before it saves, so each of these is a
 * mistake of the client and refused with its sentence.
 */
export async function reportFieldsProblem(
  tx: TenantTransaction,
  record: {
    readonly kind: unknown
    readonly fieldsVersion: unknown
    readonly fieldValues: unknown
  },
): Promise<string | null> {
  const { kind, fieldsVersion, fieldValues } = record

  if ((fieldsVersion ?? null) === null && (fieldValues ?? null) === null) {
    return null
  }

  if (kind !== 'time_and_material_report') {
    return 'Nur ein Regiebericht trägt die Felder des Betriebs.'
  }

  if (typeof fieldsVersion !== 'number' || !Number.isInteger(fieldsVersion) || fieldsVersion < 1) {
    return 'Die Felder eines Berichts nennen die Fassung, in der sie ausgefüllt werden.'
  }

  const definition = await reportDefinitionAt(tx, fieldsVersion)

  if (!definition) {
    return 'Diese Fassung der Felder des Regieberichts gibt es in diesem Betrieb nicht.'
  }

  if ((fieldValues ?? null) === null) {
    return null
  }

  if (typeof fieldValues === 'string' && fieldValues.length > longestFormValues) {
    return `Die Werte eines Formulars sind höchstens ${String(longestFormValues)} Zeichen lang.`
  }

  const values = readFormValues(fieldValues)

  return values === null
    ? 'Die Werte eines Formulars kommen als JSON-Text eines Objekts.'
    : valuesProblem(definition, values)
}

/**
 * The fields of a report as they are frozen and printed: label and text, in
 * the order of the version it was filled in, the empty ones left out.
 */
export async function reportFieldContent(
  tx: TenantTransaction,
  document: { readonly fieldsVersion: number | null; readonly fieldValues: string | null },
): Promise<readonly ReportFieldContent[]> {
  if (document.fieldsVersion === null || document.fieldValues === null) {
    return []
  }

  const definition = await reportDefinitionAt(tx, document.fieldsVersion)

  return reportFieldLines(definition, readFormValues(document.fieldValues) ?? {})
}
