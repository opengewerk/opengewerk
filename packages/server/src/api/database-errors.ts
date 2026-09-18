import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common'
import type { Response } from 'express'

/** The PostgreSQL error codes that mean the caller sent something wrong. */
const badRequestCodes = new Set([
  '22P02', // invalid_text_representation, e.g. a malformed uuid
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '23514', // check_violation
  '22007', // invalid_datetime_format
])

/** insufficient_privilege. What a row level security policy answers with. */
const rowLevelSecurity = '42501'

function databaseCode(error: unknown): string | undefined {
  // Drizzle wraps the driver error and keeps the original as the cause.
  const candidates = [error, (error as { cause?: unknown }).cause]

  for (const candidate of candidates) {
    const code = (candidate as { code?: unknown } | undefined)?.code

    if (typeof code === 'string') {
      return code
    }
  }

  return undefined
}

/**
 * Turns database errors into answers a caller can act on. Without this a
 * missing field comes back as a 500, which tells the caller that we broke
 * rather than that they did.
 *
 * A policy violation becomes a 403 and says nothing else. Whether the row
 * exists in another tenant is not the caller's business, and an error message
 * that distinguished the two would answer exactly that question.
 */
@Catch()
export class DatabaseExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    const translated = this.translate(error)

    response.status(translated.getStatus()).json(translated.getResponse())
  }

  private translate(error: unknown): HttpException {
    if (error instanceof HttpException) {
      return error
    }

    const code = databaseCode(error)

    if (code === rowLevelSecurity) {
      return new ForbiddenException('Kein Zugriff auf diesen Datensatz.')
    }

    if (code && badRequestCodes.has(code)) {
      return new BadRequestException('Die Angaben passen nicht zum Datenmodell.')
    }

    return new InternalServerErrorException()
  }
}
