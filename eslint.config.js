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
