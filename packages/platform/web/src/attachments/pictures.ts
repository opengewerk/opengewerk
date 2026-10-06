/**
 * A picture drawn smaller, as a JPEG, or null when the browser cannot decode
 * it (#77, ADR 0007: "unter 1 MB pro Foto").
 *
 * On the device and before anything else happens to the file: what goes into
 * the local store and up the mobile network is already the small one. The
 * browser turns the picture the way the camera held it while decoding, so a
 * photo taken upright stays upright. Drawn on white, because a JPEG has no
 * transparency and a transparent PNG would otherwise come out black.
 *
 * A picture that is small enough already is drawn at its own size, never
 * larger; the result is still a JPEG, which is what a preview has to be.
 *
 * Its own module so that tests put something in its place: a browser in a
 * test has no canvas that draws.
 */
export async function shrinkPicture(
  file: Blob,
  longEdge: number,
  quality: number,
): Promise<ArrayBuffer | null> {
  let bitmap: ImageBitmap

  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }

  try {
    const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')

    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')

    if (!context) {
      return null
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality)
    })

    return blob ? await blob.arrayBuffer() : null
  } finally {
    bitmap.close()
  }
}
