import { fileURLToPath } from 'node:url'

import { secretsTouchedIn } from '@opengewerk/platform-server/testing'
import { describe, expect, it } from 'vitest'

/**
 * The sealed credentials are read and written in one place.
 *
 * The store of the foundation seals and opens them, and `secrets/store.ts`
 * binds it to the table of this application. A route that imported the table
 * itself could hand the sealed value to a browser, and a job that did could
 * store one without the seal; the test names that before it happens. How the
 * files are found is the foundation's and tested there.
 */

const source = fileURLToPath(new URL('..', import.meta.url))

describe('the sealed credentials', () => {
  it('are touched in secrets/store.ts and nowhere else', () => {
    expect(secretsTouchedIn(source)).toEqual(['secrets/store.ts'])
  })
})
