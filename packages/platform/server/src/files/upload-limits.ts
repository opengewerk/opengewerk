import { HttpException, HttpStatus } from '@nestjs/common'
import type { TenantId } from '@opengewerk/platform-domain'

import type { FileStorage } from './store.js'

/**
 * How much the routes that take files from people store within an hour, and
 * how much room they leave on the volume of the store.
 *
 * A single file is bounded by its size, the number of them was not. The store
 * keeps the same bytes once, and different bytes every time, so a person with
 * the right to store a single photo could fill the volume the database, the
 * prints and the backup live on as well. The limits stand between that and
 * the volume, and they are wide enough that nobody doing their work meets
 * them.
 */
export interface UploadAllowance {
  /** The bytes one account stores within an hour, in whichever tenants it stores into. */
  readonly accountBytesPerHour: number
  /** The bytes everyone of one tenant stores within an hour, together. */
  readonly tenantBytesPerHour: number
  /**
   * The bytes everyone on the instance stores within an hour, together: the
   * one budget that no number of tenants or accounts multiplies.
   */
  readonly instanceBytesPerHour: number
  /**
   * What a file counts for at least. Each file is a row and a file on the
   * disk, whatever its size, and this keeps the number of them within bounds
   * as well.
   */
  readonly leastCountedBytes: number
  /** The bytes left free on the volume of the store, below which nothing more is stored. */
  readonly keptFreeBytes: number
  /**
   * The bytes left free even by a file the server makes itself, a print: the
   * part of the room kept free that stays for the database and the dump of a
   * backup, which no file ever takes.
   */
  readonly lastFreeBytes: number
  /**
   * The bytes of the files the server makes for one tenant within an hour,
   * so that the prints of one tenant leave room for the prints of the others.
   */
  readonly tenantMadeBytesPerHour: number
}

/**
 * The foundation's numbers.
 *
 * An hour of one account is a gigabyte. A photo of a round is shrunk on the
 * device to 2048 pixels on its long edge (`photoLongEdge`), less than a
 * megabyte with its preview, so a round with a thousand photos fits in an
 * hour, and so do forty files of the largest size a file may have. A tenant
 * gets five gigabytes in the same hour, for several people on a round on the
 * same day and an office filing the documents of a building beside them.
 *
 * The instance gets twenty gigabytes an hour, all tenants together. An account
 * counts for the account alone and not per tenant, and the instance counts
 * once: a tenant can be opened in a minute, and an hour per tenant opened
 * would let one person fill the volume with as many hours as tenants.
 *
 * A file counts for 100 kB at least, so that an hour of one account is ten
 * thousand files at most, however small.
 *
 * And 2 GB stay free on the volume: room for the database to grow, for the
 * prints of a day and for the dump of a backup, all of which share the disk
 * with the files on an installation from the package. Prints may go into the
 * first of these, never into the last: below 1 GB nothing is stored at all,
 * and a tenant has its prints stored at 500 MB an hour, which is a few hundred
 * documents even with a large logo in each, and takes one tenant two hours,
 * not minutes, to fill the gigabyte that prints may use.
 */
export const uploadAllowance: UploadAllowance = {
  accountBytesPerHour: 1_000_000_000,
  tenantBytesPerHour: 5_000_000_000,
  instanceBytesPerHour: 20_000_000_000,
  leastCountedBytes: 100_000,
  keptFreeBytes: 2_000_000_000,
  lastFreeBytes: 1_000_000_000,
  tenantMadeBytesPerHour: 500_000_000,
}

/** Who stores a file: an account of a tenant, or nobody signed in for a tenant. */
export interface Uploader {
  readonly tenantId: TenantId
  /** Null for a file that comes without an account, a photo sent from outside. */
  readonly userId: string | null
}

const hour = 60 * 60 * 1000
const minute = 60 * 1000

/** The one key the budget of the instance is counted under. */
const wholeInstance = 'instance'

/**
 * The bytes counted against each key within the last hour, by the minute
 * they were counted in: sixty numbers a key at most, however many files.
 */
export class HourlyBytes {
  private readonly counted = new Map<string, Map<number, number>>()

  constructor(
    private readonly limit: number,
    private readonly keys = 20_000,
  ) {}

  /** Whether this many bytes more stay within the hour. */
  fits(key: string, bytes: number, now: number): boolean {
    let used = 0

    for (const counted of this.recent(key, now).values()) {
      used += counted
    }

    return used + bytes <= this.limit
  }

  count(key: string, bytes: number, now: number): void {
    const minutes = this.recent(key, now)
    const current = Math.floor(now / minute)

    minutes.set(current, (minutes.get(current) ?? 0) + bytes)

    // Taken out and put back, so the order of the map is the order of use.
    this.counted.delete(key)
    this.counted.set(key, minutes)

    for (const oldest of this.counted.keys()) {
      if (this.counted.size <= this.keys) {
        break
      }

      this.counted.delete(oldest)
    }
  }

  /** The minutes of a key within the last hour; the ones before are let go. */
  private recent(key: string, now: number): Map<number, number> {
    const minutes = this.counted.get(key) ?? new Map<number, number>()
    const tooOld = Math.floor((now - hour) / minute)

    for (const at of minutes.keys()) {
      if (at <= tooOld) {
        minutes.delete(at)
      }
    }

    return minutes
  }
}

/**
 * The limit every route that takes a file from somebody asks before it puts
 * the bytes into the store: the routes of the foundation and the ones of an
 * application alike, which get it from `fileParts`.
 *
 * Counted in the memory of the process. An instance is one process, and a
 * restart that forgets the last hour hands out one more hour, nothing worse.
 * A file the server makes itself, a print, asks `admitMade` instead: it may
 * go into the room the routes leave free, down to the last of it.
 */
export class UploadLimits {
  private readonly accounts: HourlyBytes
  private readonly tenants: HourlyBytes
  private readonly instance: HourlyBytes
  private readonly madeForTenants: HourlyBytes

  constructor(
    private readonly store: FileStorage,
    private readonly allowance: UploadAllowance = uploadAllowance,
    private readonly now: () => number = Date.now,
  ) {
    this.accounts = new HourlyBytes(allowance.accountBytesPerHour)
    this.tenants = new HourlyBytes(allowance.tenantBytesPerHour)
    this.instance = new HourlyBytes(allowance.instanceBytesPerHour, 1)
    this.madeForTenants = new HourlyBytes(allowance.tenantMadeBytesPerHour)
  }

  /**
   * Counts a file the server makes for a tenant, a print, or refuses it: with
   * a 507 while it would go into the last room on the volume, and with a 429
   * while the tenant has had as much made as an hour allows. Nothing a person
   * stores counts here, and nothing made counts against what a person may
   * store.
   */
  async admitMade(tenantId: TenantId, sizeBytes: number): Promise<void> {
    const free = this.store.freeBytes ? await this.store.freeBytes() : null

    if (free !== null && free - sizeBytes < this.allowance.lastFreeBytes) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INSUFFICIENT_STORAGE,
          message:
            'Auf dem Speicher für Dateien ist kein Platz mehr frei. Damit Datenbank und ' +
            'Sicherung weiterlaufen, wird keine Datei mehr erzeugt, bis auf dem Server Platz ' +
            'geschaffen ist.',
          error: 'Insufficient Storage',
        },
        HttpStatus.INSUFFICIENT_STORAGE,
      )
    }

    const now = this.now()
    const counted = Math.max(sizeBytes, this.allowance.leastCountedBytes)

    if (!this.madeForTenants.fits(tenantId, counted, now)) {
      throw tooMuch(
        'In der letzten Stunde sind für alle zusammen schon so viele Dateien erzeugt worden, ' +
          'wie eine Stunde zulässt. Weitere lassen sich in spätestens einer Stunde erzeugen.',
      )
    }

    this.madeForTenants.count(tenantId, counted, now)
  }

  /**
   * Counts a file of this size for whoever stores it, or refuses it: with a
   * 507 while the volume is too full for it, and with a 429 while the account,
   * the tenant or the instance has stored as much as an hour allows. A refused
   * file counts for nothing.
   */
  async admit(uploader: Uploader, sizeBytes: number): Promise<void> {
    const free = this.store.freeBytes ? await this.store.freeBytes() : null

    if (free !== null && free - sizeBytes < this.allowance.keptFreeBytes) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INSUFFICIENT_STORAGE,
          message:
            'Auf dem Speicher für Dateien ist kaum noch Platz frei. Damit Datenbank, Drucke und ' +
            'Sicherung weiterlaufen, wird keine Datei mehr abgelegt, bis auf dem Server Platz ' +
            'geschaffen ist.',
          error: 'Insufficient Storage',
        },
        HttpStatus.INSUFFICIENT_STORAGE,
      )
    }

    // From here on nothing waits, so no other request comes between the
    // question and the count.
    const now = this.now()
    const counted = Math.max(sizeBytes, this.allowance.leastCountedBytes)
    // The account alone, not the account in the tenant of the session: the
    // same person in a second tenant is the same hour.
    const account = uploader.userId

    if (account !== null && !this.accounts.fits(account, counted, now)) {
      throw tooMuch(
        'Von diesem Konto ist in der letzten Stunde schon so viel abgelegt worden, wie eine ' +
          'Stunde zulässt. Weitere Dateien lassen sich in spätestens einer Stunde ablegen.',
      )
    }

    if (!this.tenants.fits(uploader.tenantId, counted, now)) {
      throw tooMuch(
        'In der letzten Stunde haben alle zusammen schon so viel abgelegt, wie eine Stunde ' +
          'zulässt. Weitere Dateien lassen sich in spätestens einer Stunde ablegen.',
      )
    }

    if (!this.instance.fits(wholeInstance, counted, now)) {
      throw tooMuch(
        'Auf dieser Instanz ist in der letzten Stunde schon so viel abgelegt worden, wie eine ' +
          'Stunde zulässt. Weitere Dateien lassen sich in spätestens einer Stunde ablegen.',
      )
    }

    if (account !== null) {
      this.accounts.count(account, counted, now)
    }

    this.tenants.count(uploader.tenantId, counted, now)
    this.instance.count(wholeInstance, counted, now)
  }
}

function tooMuch(message: string): HttpException {
  return new HttpException(
    { statusCode: HttpStatus.TOO_MANY_REQUESTS, message, error: 'Too Many Requests' },
    HttpStatus.TOO_MANY_REQUESTS,
  )
}
