import { BadRequestException } from '@nestjs/common'

/**
 * Reads the fields a route accepts and nothing else. Handing a request body
 * straight to the database would let a caller set columns the route never
 * meant to expose, `tenant_id` first among them. Row level security would
 * refuse that particular one, but a rule that only holds because something
 * else catches it is not a rule.
 */
export function pick<Field extends string>(
  body: unknown,
  fields: readonly Field[],
): Partial<Record<Field, unknown>> {
  if (typeof body !== 'object' || body === null) {
    throw new BadRequestException('Es wurde kein Objekt übergeben.')
  }

  const source = body as Record<string, unknown>
  const picked: Partial<Record<Field, unknown>> = {}

  for (const field of fields) {
    if (field in source && source[field] !== undefined) {
      picked[field] = source[field]
    }
  }

  return picked
}

/** Reads the required fields, and says which ones are missing rather than how many. */
export function requireFields<Field extends string>(
  values: Partial<Record<Field, unknown>>,
  fields: readonly Field[],
): void {
  const missing = fields.filter((field) => values[field] === undefined || values[field] === '')

  if (missing.length > 0) {
    throw new BadRequestException(`Pflichtangaben fehlen: ${missing.join(', ')}`)
  }
}

/** An update with no fields at all is a mistake worth naming. */
export function requireSomething(values: Record<string, unknown>): void {
  if (Object.keys(values).length === 0) {
    throw new BadRequestException('Die Anfrage enthält keine Änderung.')
  }
}
