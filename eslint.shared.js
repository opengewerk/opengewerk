// @ts-check
import eslint from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// The pieces of the lint configuration that every application of the
// organisation shares (ADR 0010). An application that embeds the foundation
// builds its own `eslint.config.js` out of them and names only what is its
// own: where its packages are and what they are called. The rules themselves
// exist once, here, so that a rule tightened in one application is tightened
// in every one the next time it raises its copy of the foundation.
//
// Functions rather than finished blocks wherever a block names files: the
// layout of the packages is the one thing two repositories do not have in
// common.

/** Nothing generated or vendored is worth linting. */
export const generated = {
  ignores: [
    '**/dist/**',
    '**/preview-build/**',
    '**/node_modules/**',
    '**/.turbo/**',
    '**/coverage/**',
  ],
}

/** What holds for every file, before a package says anything about itself. */
export const everywhere = [
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // A leading underscore means "this exists because something else
      // demands it". Two cases only, and both are real: a method implementing
      // an interface that passes an argument this implementation ignores, and
      // a type parameter a library's declaration merging insists on by
      // position. Without the escape the alternative is a disable comment at
      // every one of them, which is louder and says less.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
]

/**
 * What a package underneath the others may not reach up into: the packages
 * named, and the relative way out into the folders named.
 *
 * @param {{ packages: readonly string[], folders: readonly string[] }} above
 */
export function layersAbove({ packages, folders }) {
  return [
    ...packages.map((name) => ({
      group: [name, `${name}/*`],
      message: 'domain is the layer underneath. Pass what it needs in as an argument.',
    })),
    {
      // The relative way out, at whatever depth. Deliberately not `../../*`:
      // from `src/rules/data` that is an ordinary path to a sibling folder
      // inside the package.
      group: folders.map((folder) => `../**/${folder}/**`),
      message: 'A path leading into another package leaves the boundary as well.',
    },
  ]
}

/**
 * A package that computes and does not talk to the outside world.
 *
 * ADR 0009 keeps Node and DOM types out of its tsconfig, and this block
 * catches the remaining way in: a runtime global that needs no import.
 *
 * @param {readonly string[]} files
 * @param {ReturnType<typeof layersAbove>} above
 */
export function computesOnly(files, above) {
  return {
    files: [...files],
    languageOptions: {
      globals: {},
    },
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message: 'domain runs on both sides and must not read the environment.',
        },
        { name: 'window', message: 'domain runs on both sides and must not touch the browser.' },
        { name: 'document', message: 'domain runs on both sides and must not touch the DOM.' },
        { name: 'fetch', message: 'domain must not perform I/O. Pass the data in.' },
      ],
      // The clock is input like any other, and such a package takes its input
      // as arguments. It matters most in the rule engine: every question there
      // is about a given day, and there is deliberately no way to ask about
      // today. That absence is the whole of the historical application, and it
      // is one convenient helper away from being lost. A date built from a
      // value stays allowed, it is only reading the current time that does not.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'domain must not read the clock. Take the day as an argument, so that a document keeps being judged by the rules of its own time.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'domain must not read the clock. Take the moment as an argument.',
        },
      ],
      // The package boundary ADR 0002 promises. Three things already make an
      // import from such a package fail: it declares no runtime dependency on
      // a layer above, pnpm therefore cannot resolve one, and `rootDir` keeps
      // the build inside `src`. All three fail as a missing module, which
      // reads like a broken install rather than like a rule. This one says
      // what the rule is, and it says it in the editor instead of in CI.
      'no-restricted-imports': ['error', { patterns: [...above] }],
    },
  }
}

/**
 * Imports a set of files may not make, with the sentence that says why.
 *
 * A block of its own with the whole list, never an addition to another one: a
 * later block replaces the options of a rule, it does not add to them. Whoever
 * restricts imports for files that `computesOnly` already covers passes that
 * list in again.
 *
 * @param {readonly string[]} files
 * @param {readonly { group: string[], message: string }[]} patterns
 */
export function mayNotImport(files, patterns) {
  return {
    files: [...files],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...patterns] }],
    },
  }
}

/**
 * Code that runs in Node: a server, the shared configuration at the root, the
 * small scripts a package keeps beside its source.
 *
 * @param {readonly string[]} files
 */
export function runsInNode(files) {
  return {
    files: [...files],
    languageOptions: {
      globals: globals.node,
    },
  }
}

/**
 * An interface built with React.
 *
 * @param {readonly string[]} files
 */
export function runsInBrowser(files) {
  return {
    files: [...files],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // The site interface is offline first. A broken effect there shows up as
      // lost data entry, not as a crash, so these are errors and not warnings.
      ...reactHooks.configs.recommended.rules,
    },
  }
}

/**
 * A script that runs in Node and hands functions to a browser, which run
 * there: both sets of names are real in the one file.
 *
 * @param {readonly string[]} files
 */
export function runsInBoth(files) {
  return {
    files: [...files],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  }
}

/** Has to stay last: it switches off everything Prettier already decides. */
export const formatting = prettier

/** Puts the blocks together, with the types of typescript-eslint. */
export const configuration = tseslint.config
