import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { secretsTouchedIn } from './boundaries.js'

/**
 * The check an application holds its code to: the table of sealed credentials
 * is imported in its store and nowhere else.
 *
 * Tested against a source tree written for the test, because the foundation
 * has no such import itself: its store is handed the table. What is held here
 * is that the check sees every way of getting at the table, so that an
 * application whose test passes really has one place only.
 */

let source: string

function write(path: string, text: string): void {
  const file = join(source, path)

  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf8')
}

beforeAll(() => {
  source = mkdtempSync(join(tmpdir(), 'secrets-boundaries-'))

  write(
    'secrets/store.ts',
    "import { secretStore } from '@opengewerk/platform-server'\n\n" +
      "import { secrets } from '../database/schema/index.js'\n\n" +
      'export const store = secretStore(secrets)\n',
  )
  write(
    'database/schema/secrets.ts',
    "import { secretsSchema } from '@opengewerk/platform-server'\n\n" +
      "export const { secretPurpose, secrets } = secretsSchema(['mailbox'])\n",
  )
  // Beside other tables, over several lines.
  write(
    'api/leaky.controller.ts',
    'import {\n  customers,\n  secrets,\n  sites,\n} from' + " '../database/schema/index.js'\n",
  )
  // Straight from the file of the table, and only as a type.
  write('jobs/direct.ts', "import type { secrets } from '../database/schema/secrets.js'\n")
  // Under another name.
  write('jobs/renamed.ts', "import { secrets as sealed } from '../database/schema/index.js'\n")
  // Through the whole schema.
  write(
    'jobs/whole.ts',
    "import * as schema from '../database/schema/index.js'\n\n" +
      'export const table = schema.secrets\n',
  )

  // What does not touch it.
  write(
    'jobs/other-table.ts',
    "import * as schema from '../database/schema/index.js'\n\nexport const table = schema.customers\n",
  )
  write('mail/settings.ts', "import { readSecret } from '../secrets/store.js'\n")
  write('mail/words.ts', "export const secrets = 'a word, and no table'\n")
  // An import written out in a comment imports nothing.
  write(
    'mail/commented.ts',
    "// import { secrets } from '../database/schema/index.js'\n" +
      "/* import { secrets } from '../database/schema/index.js' */\n" +
      'export const nothing = 0\n',
  )
  write('api/leaky.test.ts', "import { secrets } from '../database/schema/index.js'\n")
})

afterAll(() => {
  rmSync(source, { recursive: true, force: true })
})

describe('the files that touch the sealed credentials', () => {
  it('are found whichever way they import the table', () => {
    expect(secretsTouchedIn(source)).toEqual([
      'api/leaky.controller.ts',
      'jobs/direct.ts',
      'jobs/renamed.ts',
      'jobs/whole.ts',
      'secrets/store.ts',
    ])
  })

  it('are none in the foundation itself, whose store is handed the table', () => {
    const foundation = fileURLToPath(new URL('..', import.meta.url))

    expect(secretsTouchedIn(foundation)).toEqual([])
  })
})
