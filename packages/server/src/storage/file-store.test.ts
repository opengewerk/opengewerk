import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FileStore, StoredFileDamagedError, StoredFileMissingError } from './file-store.js'

/**
 * The store is the one place where an invoice that went out can come back
 * different, so the tests are about the ways that could happen: a file
 * changed on disk, a file missing, a name that is not a hash.
 */

let root: string
let store: FileStore

const contents = new TextEncoder().encode('%PDF-1.7 Rechnung 2026-0001')
const hash = createHash('sha256').update(contents).digest('hex')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opengewerk-store-'))
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
