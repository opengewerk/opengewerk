// @ts-check
import {
  computesOnly,
  configuration,
  everywhere,
  formatting,
  generated,
  layersAbove,
  mayNotImport,
  runsInBoth,
  runsInBrowser,
  runsInNode,
} from './eslint.shared.js'

// The rules themselves are in `eslint.shared.js`, where every application of
// the organisation takes them from (ADR 0010). This file says where the
// packages of this repository are and what they are called.

// What a package underneath the others may not reach up into. A value, because
// two blocks below need the same list.
const above = layersAbove({
  packages: ['@opengewerk/server', '@opengewerk/web'],
  folders: ['server', 'web'],
})

// The packages of an application, seen from the foundation (ADR 0010).
const applications = [
  {
    group: [
      '@opengewerk/domain',
      '@opengewerk/domain/*',
      '@opengewerk/gewerk-*',
      '@opengewerk/gewerk-*/*',
    ],
    message:
      'The foundation knows no application (ADR 0010). What only one of them knows comes in as an argument.',
  },
]

export default configuration(
  generated,
  ...everywhere,

  // The domain package computes; it does not talk to the outside world. The
  // same holds for the part of it that every application shares, which
  // ADR 0010 moved into the foundation: it computes on both sides as well.
  computesOnly(['packages/domain/**/*.ts', 'packages/platform/domain/**/*.ts'], above),

  // The foundation of ADR 0010 knows no application. Its packages depend on
  // none of them, so an import the wrong way round fails as a missing module
  // here too, and this rule is again the one that says why.
  mayNotImport(['packages/platform/**/*.{ts,tsx}'], [...above, ...applications]),

  runsInNode(['packages/server/**/*.ts']),
  runsInBrowser(['packages/web/**/*.{ts,tsx}']),

  // Everything else that runs in Node rather than in a browser: the shared
  // configuration at the root, and the small scripts a package keeps beside
  // its source. The build tooling is the one place where reading the
  // environment and writing to a console is the job.
  runsInNode(['*.js', '*.config.js', '*.config.ts', 'packages/*/scripts/**/*.js']),

  // The check of the widths runs in Node and hands functions to a browser
  // (#218).
  runsInBoth(['packages/web/scripts/widths.js']),

  formatting,
)
