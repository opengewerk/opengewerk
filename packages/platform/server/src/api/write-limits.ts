import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import type { Request } from 'express'
import type { Observable } from 'rxjs'

import { HourlyBytes } from '../files/upload-limits.js'
import { identityProperty, type RequestWithIdentity, userProperty } from './identity.js'
import { largestTransmissionBytes } from './origin.js'

/**
 * How much one account writes within an hour: the bytes of the JSON bodies of
 * its requests that change something, the transmissions of the sync among
 * them.
 *
 * A route takes a body of a size, and the sync a number of operations, and a
 * document a number of lines; how often somebody sends one had no limit. A
 * member, a technician as well, could fill the database every tenant of the
 * instance shares, and the log keeps every change for good. The budget
 * stands between that and the database and is wide enough that nobody doing
 * their work meets it: a device that sends the work of a week at once is far
 * below a hundred megabytes.
 *
 * Counted per account and not per tenant, as the uploads are: the same person
 * in a second tenant is the same hour. There is no budget of the whole
 * instance, so that one account cannot keep everybody else from saving.
 * A file is no JSON and has its budget of its own (`UploadLimits`).
 */
export interface WriteAllowance {
  /** The bytes one account writes within an hour, in whichever tenants it writes. */
  readonly accountBytesPerHour: number
  /** What a request counts for at least, so that many small ones count as well. */
  readonly leastCountedBytes: number
}

/** The foundation's numbers: 100 MB an hour, a request counts for 1 kB at least. */
export const writeAllowance: WriteAllowance = {
  accountBytesPerHour: 100_000_000,
  leastCountedBytes: 1_000,
}

/**
 * The budget, in the memory of the process like the one of the uploads: an
 * instance is one process, and a restart that forgets the last hour hands out
 * one more hour, nothing worse.
 */
@Injectable()
export class WriteLimits {
  private readonly accounts: HourlyBytes

  constructor(
    private readonly allowance: WriteAllowance = writeAllowance,
    private readonly now: () => number = Date.now,
  ) {
    this.accounts = new HourlyBytes(allowance.accountBytesPerHour)
  }

  /**
   * Counts a request of this many bytes for the account, or refuses it with
   * a 429 while the account has written as much as an hour allows. A refused
   * request counts for nothing.
   */
  admit(account: string, sizeBytes: number): void {
    const now = this.now()
    const counted = Math.max(sizeBytes, this.allowance.leastCountedBytes)

    if (!this.accounts.fits(account, counted, now)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            'Von diesem Konto ist in der letzten Stunde schon so viel gespeichert worden, wie eine ' +
            'Stunde zulässt. Weitere Änderungen lassen sich in spätestens einer Stunde speichern.',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    this.accounts.count(account, counted, now)
  }
}

const changing = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Asks the budget for every request that changes something with a JSON body,
 * behind the guards, so that it knows the account. Registered by the
 * application as an interceptor of every route, with `WriteLimits` beside it.
 *
 * The size is the length the request names. One that names none is counted
 * as the largest body a route takes, the transmission of the sync: it could
 * be that long, and a browser names the length of every body it sends.
 */
@Injectable()
export class WriteLimitInterceptor implements NestInterceptor {
  constructor(private readonly limits: WriteLimits) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & RequestWithIdentity>()
    const account = request[identityProperty]?.userId ?? request[userProperty]?.userId

    if (account && changing.has(request.method) && request.is('json')) {
      const named = Number(request.headers['content-length'])

      this.limits.admit(account, Number.isFinite(named) ? named : largestTransmissionBytes)
    }

    return next.handle()
  }
}
