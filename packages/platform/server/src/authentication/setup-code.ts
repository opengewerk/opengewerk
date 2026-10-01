import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * The code the first run of an instance asks for (#215).
 *
 * Until it existed, an instance with no business and no account took its first
 * run from whoever reached the address first, and between the first start and
 * the first run an instance usually stands open on the internet. Whoever came
 * first became the owner. The code lives in `docker/.env` on the server, next
 * to the passwords of the database, so whoever can read it can get at the
 * server, and that is exactly the person who is meant to set the instance up.
 *
 * `docker/setup.sh` makes it with the other keys: eight characters from an
 * alphabet without 0, O, 1, I and L, grouped as `K7Q4-9PXM`, short enough to
 * type off a terminal and about 40 bits against guessing. Nothing prints it.
 *
 * Once the instance is set up the code opens nothing: the first run still
 * answers only while the instance is empty, and that stays a question asked of
 * the database. The code is a second condition next to it, not a switch.
 */

/**
 * The fewest characters a code may have, spaces and dashes not counted. The
 * one `setup.sh` makes has eight; an operator who writes their own is held to
 * the same, because a shorter one is guessed in an afternoon.
 */
export const shortestSetupCode = 8

/**
 * The code the way it is compared: in capitals, without spaces and dashes.
 *
 * Somebody types it off a terminal, maybe on a phone, and neither the case nor
 * where the dash went is worth a refusal. What is left is what counts.
 */
export function normalizeSetupCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '')
}

function digestOf(code: string): Buffer {
  return createHash('sha256').update(normalizeSetupCode(code), 'utf8').digest()
}

/**
 * Whether a code someone typed is the one the instance has, in constant time.
 *
 * Both sides are hashed first, so that the comparison always runs over 32
 * bytes: `timingSafeEqual` wants two buffers of one length, and comparing the
 * lengths first would tell a caller how long the code is.
 */
export function setupCodesMatch(given: string, expected: string): boolean {
  return timingSafeEqual(digestOf(given), digestOf(expected))
}

/** How many wrong codes the first run takes before it stops listening for a while. */
export interface SetupAttemptLimits {
  /** Wrong codes from one address within the window. */
  readonly perAddress: number
  /** Wrong codes from every address together within the window. */
  readonly overall: number
  /** The window, in milliseconds. */
  readonly windowMs: number
}

/**
 * Five wrong codes per address and quarter of an hour, a hundred from all
 * addresses together.
 *
 * The overall limit is what holds against guessing. At a hundred a quarter of
 * an hour, finding one of the 31^8 codes takes on average more than a hundred
 * thousand years, and more than a thousand with a fresh allowance after a
 * restart every ten seconds. The limit per address is what keeps a single
 * machine from spending that allowance on its own, so that the person at the
 * server still gets in while somebody else is guessing.
 */
export const setupAttemptLimits: SetupAttemptLimits = {
  perAddress: 5,
  overall: 100,
  windowMs: 15 * 60_000,
}

/**
 * The wrong codes of the last quarter of an hour, per address and overall.
 *
 * In memory and not in the database, unlike the limits of the sign in (ADR
 * 0006). Those protect accounts and must survive a restart, because a restart
 * would otherwise hand every attacker a fresh allowance. Here even that would
 * not make guessing worth trying, see `setupAttemptLimits`, and a table for an
 * instance that has nothing in it yet would be a migration for a few minutes of
 * its life.
 *
 * Only a wrong code is counted, and only one that was compared: a request the
 * limit refuses tells nobody anything and costs nothing. That also keeps the
 * memory bounded, because nothing is recorded once the overall limit is
 * reached, and a failure older than the window is forgotten at the next
 * question.
 */
export class SetupAttempts {
  private readonly failures = new Map<string, number[]>()
  private overall: number[] = []

  constructor(
    private readonly limits: SetupAttemptLimits = setupAttemptLimits,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether the next attempt from this address is refused without looking at the code. */
  refuses(address: string): boolean {
    this.forgetOld()

    return (
      this.overall.length >= this.limits.overall ||
      (this.failures.get(address)?.length ?? 0) >= this.limits.perAddress
    )
  }

  /** Counts a wrong code from this address. */
  failed(address: string): void {
    const at = this.now()

    this.failures.set(address, [...(this.failures.get(address) ?? []), at])
    this.overall.push(at)
  }

  private forgetOld(): void {
    const since = this.now() - this.limits.windowMs

    this.overall = this.overall.filter((at) => at > since)

    for (const [address, times] of this.failures) {
      const recent = times.filter((at) => at > since)

      if (recent.length === 0) {
        this.failures.delete(address)
      } else {
        this.failures.set(address, recent)
      }
    }
  }
}
