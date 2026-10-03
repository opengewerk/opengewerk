import react from '@vitejs/plugin-react'
import { mergeConfig } from 'vitest/config'
import { shared } from '../../../vitest.shared.js'

export default mergeConfig(shared, {
  plugins: [react()],
  test: {
    name: 'platform-web',
    // The tools beside the source run in Node, and so do their tests, each of
    // which says so at its top.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tools/**/*.test.js'],
    setupFiles: ['./test-setup.ts'],
    environment: 'happy-dom',
    // Without this a `?raw` import of a stylesheet comes back as an empty
    // string: vitest replaces CSS with a stub unless it is told to process it,
    // and the suffix does not get past that. The contrast test reads the token
    // file that way, so a silent empty string would turn it into a test that
    // checks nothing and still passes.
    css: true,
  },
})
