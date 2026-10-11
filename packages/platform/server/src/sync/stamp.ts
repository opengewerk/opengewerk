import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import { map, type Observable } from 'rxjs'

/**
 * The columns of the stamp that never leave the server: when a record last
 * changed, who changed it and from which device.
 *
 * A trigger keeps all three on every row that travels, and the change log of
 * the tenant keeps them for whoever may read it. A device needs none of them:
 * it sends a change against the version and asks for more by the change
 * sequence, and both of those still travel. Sent along, the three lay on every
 * device that may read the record and in every answer that hands it out, and
 * said to anybody who reads the record who had last touched it, where and when.
 */
export const leftOnTheServer: readonly string[] = ['updatedAt', 'updatedBy', 'deviceId']

/**
 * The column that tells a record of a table that travels from anything else
 * in an answer. `updatedAt` and `deviceId` mean something else elsewhere: the
 * moment a setting was saved, the device of the session that signs in. Only
 * on a record are they the stamp.
 */
const marker = 'changeSequence'

/** The one of the three that means the stamp wherever it stands. */
const writer = 'updatedBy'

function isPlain(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value) as unknown

  return prototype === Object.prototype || prototype === null
}

/**
 * The answer as it may leave the server: without the stamp of any record in
 * it, however deep it lies, in a list, beside another record of a join or
 * under a field of a page.
 *
 * Arrays and plain objects are walked, nothing else: a date, the bytes of a
 * file or a stream go out as they came. What is handed in is not changed; a
 * part that loses nothing is the same part in the result, so an answer
 * without a record costs a walk and no copy.
 */
export function withoutTheStamp<Answer>(answer: Answer): Answer {
  return strip(answer) as Answer
}

function strip(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    let changed = false
    const items = value.map((item: unknown) => {
      const stripped = strip(item)
      changed ||= stripped !== item

      return stripped
    })

    return changed ? items : value
  }

  if (!isPlain(value)) {
    return value
  }

  const record = Object.hasOwn(value, marker)
  let changed = false
  const entries: [string, unknown][] = []

  for (const [field, inner] of Object.entries(value)) {
    if (field === writer || (record && leftOnTheServer.includes(field))) {
      changed = true
      continue
    }

    const stripped = strip(inner)
    changed ||= stripped !== inner
    entries.push([field, stripped])
  }

  return changed ? Object.fromEntries(entries) : value
}

/**
 * Takes the stamp out of every answer of every route, registered by an
 * application for its whole module (`APP_INTERCEPTOR`), next to its guard.
 *
 * Once for the module and not in each route. A route hands out the rows it
 * read, often whole and often with others joined on; a selection in each of
 * them would be a decision somebody has to remember on the next one, and a
 * route that forgot it would look exactly like one that remembered. The pull
 * of a device takes the stamp out by itself (`travellingRows`), so a device
 * never holds it even where an application has not registered this.
 */
@Injectable()
export class StampInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((answer: unknown) => withoutTheStamp(answer)))
  }
}
