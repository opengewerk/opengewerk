import { unzip as unzipArchive } from '@opengewerk/platform-server'

/**
 * The files of a ZIP archive (#297), as a wholesaler delivers DATANORM:
 * DATANORM.001 with the articles, DATPREIS.001 with the prices, DATANORM.WRG
 * and DATANORM.RAB. The reading itself is the foundation's, since a workbook
 * of a spreadsheet is an archive as well (opengewerk-haustechnik#100); what
 * stays here is the limit of a delivery and that its files are known by
 * their names alone, whatever folder a packer put them into.
 */

export { isZip, ZipRefused } from '@opengewerk/platform-server'

export interface ZipEntry {
  readonly name: string
  readonly bytes: Uint8Array
}

/** The most an archive may unpack to: a full catalogue is a few hundred megabytes. */
export const largestUnpackedBytes = 400_000_000

/** The entries of an archive that are files, in the order of its directory. */
export function unzip(bytes: Uint8Array, limit = largestUnpackedBytes): ZipEntry[] {
  return unzipArchive(bytes, limit, {
    tooLarge: 'Das Archiv entpackt sich zu mehr als 400 MB.',
  }).map((entry) => ({ name: entry.path.split('/').pop() ?? entry.path, bytes: entry.bytes }))
}
