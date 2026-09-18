import { defineConfig } from 'vitest/config'

// One base for every package: same reporters, same timeouts, same file
// pattern. A package overrides what its own side needs (an environment, a
// transformer) and inherits the rest, so a change here reaches all of them.
export const shared = defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Globals stay off. An explicit import from 'vitest' is what lets the
    // domain package keep an empty `types` list in its tsconfig.
    globals: false,
    clearMocks: true,
  },
})

export default shared
