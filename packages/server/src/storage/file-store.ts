import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { sha256Pattern } from '@opengewerk/domain'

/** A file the database knows of and the directory does not. */
export class StoredFileMissingError extends Error {}

/**
 * A file whose contents no longer match its name. In a content addressed
 * store that means it is damaged, and it is reported rather than handed out:
 * an invoice that comes back different from how it went out is worse than one
 * that does not come back.
 */
export class StoredFileDamagedError extends Error {}

export interface StoredBlob {
  readonly sha256: string
  readonly sizeBytes: number
}

/** What the routes need from a store, and all a test has to provide. */
export interface FileStorage {
  put(bytes: Uint8Array): Promise<StoredBlob>
  get(sha256: string): Promise<Uint8Array>
}

/**
 * The store a module gets when nobody handed one in. It refuses on use, with a
 * sentence, rather than quietly writing somewhere: a file that lands in an
 * unintended directory is a file the backup never sees.
 */
export const noFileStorage: FileStorage = {
  put: () => Promise.reject(new Error('Für diese Instanz ist kein Dateispeicher eingerichtet.')),
  get: () => Promise.reject(new Error('Für diese Instanz ist kein Dateispeicher eingerichtet.')),
}

function hashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The content addressed file store from ADR 0007, on the local file system.
 *
 * A file is kept under the SHA-256 of its contents. Three things follow from
 * that and nothing else is needed for them: the same file is stored once,
 * however often it is put; a file cannot be changed without ending up under a
 * different name; and checking that it is intact is comparing the name with
 * a hash of what is in it. `restore.sh` does exactly that with every file
 * after rolling a backup back, which is why the names have to stay bare hex.
 *
 * Two levels of directories from the first four characters, so that no single
 * directory ends up with a hundred thousand entries after a few years of
 * photos. `ab/cd/abcd…`.
 *
 * What the store does not know is who a file belongs to. It is shared by every
 * business on the instance, and the question whether somebody may read a file
 * is answered by the `files` table under row level security, before this
 * class is ever asked. A hash on its own opens nothing.
 */
export class FileStore implements FileStorage {
  constructor(private readonly root: string) {}

  private pathOf(sha256: string): string {
    // Refused rather than joined. A name that is not a hash could walk out
    // of the store with a `..`, and nothing legitimate ever asks for one.
    if (!sha256Pattern.test(sha256)) {
      throw new Error(`Not a SHA-256: ${JSON.stringify(sha256)}`)
    }

    return join(this.root, sha256.slice(0, 2), sha256.slice(2, 4), sha256)
  }

  /**
   * Stores bytes and says under which name.
   *
   * Written to a temporary name beside the target, flushed to the disk, and
   * then renamed into place, so that the name only ever points at a complete
   * file. A crash halfway leaves a stray `.part` file, which the restore check
   * ignores because its name is no hash, and not a truncated invoice under a
   * name that claims otherwise.
   */
  async put(bytes: Uint8Array): Promise<StoredBlob> {
    const sha256 = hashOf(bytes)
    const target = this.pathOf(sha256)
    const blob = { sha256, sizeBytes: bytes.byteLength }

    if (await exists(target)) {
      return blob
    }

    await mkdir(dirname(target), { recursive: true })

    const temporary = `${target}.${randomUUID()}.part`
    const handle = await open(temporary, 'wx')

    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }

    try {
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }

    return blob
  }

  /** The bytes stored under a hash, checked against it before they leave. */
  async get(sha256: string): Promise<Uint8Array> {
    let bytes: Buffer

    try {
      bytes = await readFile(this.pathOf(sha256))
    } catch (cause) {
      if ((cause as { code?: unknown }).code === 'ENOENT') {
        throw new StoredFileMissingError(
          `Die Datei ${sha256} fehlt im Dateispeicher. Wurde er nach einer Sicherung ` +
            'unvollständig zurückgespielt?',
          { cause },
        )
      }

      throw cause
    }

    if (hashOf(bytes) !== sha256) {
      throw new StoredFileDamagedError(
        `Die Datei ${sha256} im Dateispeicher ist beschädigt: ihr Inhalt passt nicht mehr ` +
          'zu ihrem Namen.',
      )
    }

    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)

    return true
  } catch {
    return false
  }
}
