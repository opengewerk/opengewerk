import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FileStore, StoredFileDamagedError, StoredFileMissingError } from './store.js'

/**
 * The store is the one place where a record that went in can come back
 * different, so the tests are about the ways that could happen: a file
 * changed on disk, a file missing, a name that is not a hash.
 */

let root: string
let store: FileStore

const contents = new TextEncoder().encode('%PDF-1.7 Probe 2026-0001')
const hash = createHash('sha256').update(contents).digest('hex')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'file-store-'))
  store = new FileStore(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Every file under the root, as paths relative to it. */
function everything(): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .replaceAll('\\', '/'),
    )
}

describe('the file store', () => {
  it('keeps a file under its hash, two directories deep', async () => {
    const stored = await store.put(contents)

    expect(stored).toEqual({ sha256: hash, sizeBytes: contents.byteLength })
    expect(everything()).toEqual([`${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`])
  })

  it('gives the same bytes back', async () => {
    await store.put(contents)

    expect(await store.get(hash)).toEqual(contents)
  })

  it('stores the same file once, however often it is put', async () => {
    await store.put(contents)
    await store.put(contents)
    await store.put(new Uint8Array(contents))

    expect(everything()).toHaveLength(1)
  })

  it('leaves no temporary file behind', async () => {
    await store.put(contents)
    await store.put(new TextEncoder().encode('ein anderes Dokument'))

    // The restore check looks at every file and verifies the ones named like
    // a hash. A stray temporary file would be counted and never checked.
    expect(everything().every((path) => /\/[0-9a-f]{64}$/.test(path))).toBe(true)
  })

  it('refuses a file that was changed on disk, rather than handing it out', async () => {
    await store.put(contents)
    const path = join(root, hash.slice(0, 2), hash.slice(2, 4), hash)
    writeFileSync(path, readFileSync(path).toString().replace('0001', '0002'))

    await expect(store.get(hash)).rejects.toThrow(StoredFileDamagedError)
  })

  it('says which file is missing when it is not there', async () => {
    await expect(store.get(hash)).rejects.toThrow(StoredFileMissingError)
    await expect(store.get(hash)).rejects.toThrow(hash)
  })

  it('does not take a name that is not a hash, so nothing walks out of the store', async () => {
    await expect(store.get('../../etc/passwd')).rejects.toThrow('Not a SHA-256')
    await expect(store.get(hash.toUpperCase())).rejects.toThrow('Not a SHA-256')
  })
})

/**
 * The sweep of the store (#657): what no tenant holds any more goes once it
 * is older than the grace, and nothing else. `held` stands in for the
 * database, which answers for every tenant.
 */
describe('the sweep of the file store', () => {
  const day = 24 * 60 * 60 * 1000
  const before = () => new Date(Date.now() - day)

  /** Stores bytes and makes them as old as a week. */
  async function oldFile(text: string): Promise<string> {
    const { sha256 } = await store.put(new TextEncoder().encode(text))
    const week = new Date(Date.now() - 7 * day)

    utimesSync(join(root, sha256.slice(0, 2), sha256.slice(2, 4), sha256), week, week)

    return sha256
  }

  const holding =
    (...names: string[]) =>
    async (asked: readonly string[]) =>
      new Set(asked.filter((name) => names.includes(name)))

  it('keeps a file as new as the last put of the same bytes', async () => {
    const sha256 = await oldFile('Rechnung')
    const path = join(root, sha256.slice(0, 2), sha256.slice(2, 4), sha256)

    await store.put(new TextEncoder().encode('Rechnung'))

    expect(statSync(path).mtime.getTime()).toBeGreaterThan(before().getTime())
  })

  it('takes out an old file nobody holds, and keeps one a tenant holds', async () => {
    const orphan = await oldFile('Verwaist')
    const kept = await oldFile('Gehalten')

    expect(await store.sweep(holding(kept), before())).toBe(1)
    await expect(store.get(orphan)).rejects.toThrow(StoredFileMissingError)
    expect(new TextDecoder().decode(await store.get(kept))).toBe('Gehalten')
  })

  it('keeps a file nobody holds yet while it is younger than the grace, and does not ask about it', async () => {
    const { sha256 } = await store.put(new TextEncoder().encode('Gerade gekommen'))
    const asked: string[] = []

    expect(
      await store.sweep(async (names) => {
        asked.push(...names)

        return new Set<string>()
      }, before()),
    ).toBe(0)
    expect(asked).toEqual([])
    expect(new TextDecoder().decode(await store.get(sha256))).toBe('Gerade gekommen')
  })

  it('keeps a file put again while the sweep asked about it', async () => {
    const sha256 = await oldFile('Noch einmal')

    // The same bytes arrive between the answer and the removal: the upload
    // that brings them writes its row a moment later.
    const removed = await store.sweep(async () => {
      await store.put(new TextEncoder().encode('Noch einmal'))

      return new Set<string>()
    }, before())

    expect(removed).toBe(0)
    expect(new TextDecoder().decode(await store.get(sha256))).toBe('Noch einmal')
    expect(everything()).toEqual([`${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`])
  })

  it('takes out what an unfinished write or sweep left behind once it is old', async () => {
    const sha256 = await oldFile('Daneben')
    const folder = join(root, sha256.slice(0, 2), sha256.slice(2, 4))
    const week = new Date(Date.now() - 7 * day)

    for (const stray of [`${sha256}.1234.part`, `${sha256}.5678.gone`]) {
      writeFileSync(join(folder, stray), 'halb')
      utimesSync(join(folder, stray), week, week)
    }
    writeFileSync(join(folder, `${sha256}.9999.part`), 'gerade')

    await store.sweep(holding(sha256), before())

    expect(everything().sort()).toEqual(
      [`${sha256}`, `${sha256}.9999.part`].map(
        (name) => `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${name}`,
      ),
    )
  })
})
