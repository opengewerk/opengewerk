/**
 * Collects a response that is not JSON into a Buffer, for supertest's `parse`.
 *
 * Supertest reads JSON and text by itself and leaves anything else, a PDF or
 * an image, unread. Two test files need the bytes, so the collector is here
 * once rather than copied into each.
 */
export function binary(response: unknown, done: (error: Error | null, body: Buffer) => void): void {
  const stream = response as NodeJS.ReadableStream
  const chunks: Buffer[] = []

  stream.on('data', (chunk: Buffer) => chunks.push(chunk))
  stream.on('end', () => {
    done(null, Buffer.concat(chunks))
  })
}
