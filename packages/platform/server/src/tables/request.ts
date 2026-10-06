import {
  BadRequestException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  tableBodyType,
  tableFileNameHeader,
  tableFileType,
  tableLimits,
  tooMuch,
  type TableFile,
} from '@opengewerk/platform-domain'
import type { Request } from 'express'

import { bodyBytesOf } from '../api/body-bytes.js'
import { AcceptsBody } from '../api/origin.js'
import { TableRefused } from './limits.js'
import { tableFileOf, tableFileTooLarge } from './read.js'

/**
 * How a table reaches a route, twice.
 *
 * First as the file somebody chose: its bytes, under a type no form can
 * send, and its name in a header. The route reads it and answers with the
 * table, and keeps nothing: looking at a list is not yet taking it over.
 *
 * Then as the sheet with what somebody decided about it, as JSON. Such a
 * body is megabytes where every other is a form's worth, so it travels under
 * a type of its own: the parser in front of the routes passes it by, and it
 * is read here, by the handler, for whoever the guards let through
 * (`bodyBytesOf`).
 */

/**
 * The most a request with a sheet may be, in bytes. A sheet within the limits
 * of a table fits: two million characters are six megabytes at their widest
 * in UTF-8 and twelve where every one of them needs an escape, and a row that
 * holds something far to the right carries up to a hundred empty cells of
 * three bytes each in front of it, three megabytes for ten thousand rows.
 */
export const largestTableBodyBytes = 16 * 1024 * 1024

/** Marks a route that takes the file of a table. */
export const AcceptsTableFile = () =>
  AcceptsBody(
    [tableFileType],
    `Eine Tabelle wird als ${tableFileType} geschickt, mit ihrem Namen im Kopf X-File-Name.`,
  )

/** Marks a route that takes a sheet with what was decided about it. */
export const AcceptsTable = () =>
  AcceptsBody(
    [tableBodyType],
    `Eine Tabelle mit ihrer Zuordnung wird als ${tableBodyType} geschickt.`,
  )

/**
 * The table in the file a request carries.
 *
 * @throws PayloadTooLargeException for a file over the limit
 * @throws UnprocessableEntityException for a file that is no table, with the sentence that says what to do
 */
export async function uploadedTable(request: Request): Promise<TableFile> {
  const body = await bodyBytesOf(request, tableLimits.fileBytes)

  if (body === null) {
    throw new PayloadTooLargeException(tableFileTooLarge)
  }

  try {
    return tableFileOf(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      nameOf(request.header(tableFileNameHeader) ?? ''),
    )
  } catch (error) {
    throw error instanceof TableRefused ? new UnprocessableEntityException(error.message) : error
  }
}

function nameOf(header: string): string {
  try {
    return decodeURIComponent(header)
  } catch {
    return header
  }
}

/**
 * What a request under `tableBodyType` carries. A request without a body
 * carries nothing, and the route says what is missing.
 *
 * @throws PayloadTooLargeException for a body over the limit
 * @throws BadRequestException for a body that is no JSON
 */
export async function tableBodyOf(request: Request): Promise<unknown> {
  const body = await bodyBytesOf(request, largestTableBodyBytes)

  if (body === null) {
    throw new PayloadTooLargeException(tooMuch)
  }

  if (body.byteLength === 0) {
    return {}
  }

  try {
    return JSON.parse(body.toString('utf-8')) as unknown
  } catch {
    throw new BadRequestException('Die Anfrage ist kein gültiges JSON.')
  }
}
