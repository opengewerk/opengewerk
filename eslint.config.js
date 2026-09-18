// @ts-check
import eslint from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Nothing generated or vendored is worth linting.
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**'],
  },

  eslint.configs.recommended,
  tseslint.configs.recommended,

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
    files: ['*.js', '*.config.js', '*.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Has to stay last: it switches off everything Prettier already decides.
  prettier,
)
