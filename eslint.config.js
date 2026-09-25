// @ts-check
import eslint from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Nothing generated or vendored is worth linting.
    ignores: [
      '**/dist/**',
      '**/preview-build/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
    ],
  },

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

  {
    // The domain package computes; it does not talk to the outside world.
    // ADR 0009 keeps Node and DOM types out of its tsconfig, and this rule
    // catches the remaining way in: a runtime global that needs no import.
    files: ['packages/domain/**/*.ts'],
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
      // The clock is input like any other, and this package takes its input as
      // arguments. It matters most in the rule engine: every question there is
      // about a given day, and there is deliberately no way to ask about
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
      // import from here fail: the package declares no runtime dependency,
      // pnpm therefore cannot resolve one, and `rootDir` keeps the build
      // inside `src`. All three fail as a missing module, which reads like a
      // broken install rather than like a rule. This one says what the rule
      // is, and it says it in the editor instead of in CI.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@opengewerk/server', '@opengewerk/server/*'],
              message: 'domain is the layer underneath. Pass what it needs in as an argument.',
            },
            {
              group: ['@opengewerk/web', '@opengewerk/web/*'],
              message: 'domain is the layer underneath. Pass what it needs in as an argument.',
            },
            {
              // The relative way out, at whatever depth. Deliberately not
              // `../../*`: from `src/rules/data` that is an ordinary path to a
              // sibling folder inside the package.
              group: ['../**/server/**', '../**/web/**'],
              message: 'A path leading into another package leaves the boundary as well.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['packages/server/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    files: ['packages/web/**/*.{ts,tsx}'],
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
  },

  {
    // Everything that runs in Node rather than in a browser: the shared
    // configuration at the root, and the small scripts a package keeps beside
    // its source. The build tooling is the one place where reading the
    // environment and writing to a console is the job.
    files: ['*.js', '*.config.js', '*.config.ts', 'packages/*/scripts/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    // The check of the widths runs in Node and hands functions to a browser,
    // which run there: both sets of names are real in the one file (#218).
    files: ['packages/web/scripts/widths.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // Has to stay last: it switches off everything Prettier already decides.
  prettier,
)
