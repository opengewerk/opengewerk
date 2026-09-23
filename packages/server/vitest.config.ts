import { mergeConfig } from 'vitest/config'
import { shared } from '../../vitest.shared.js'

export default mergeConfig(shared, {
  test: {
    name: 'server',
    environment: 'node',
    // The database tests share one database and empty it before they run.
    // Side by side they would pull the schema out from under each other.
    fileParallelism: false,
    // Vitest gives a test five seconds. Running every migration up and back
    // down takes about two and a half on a laptop and went past five on a
    // busy CI runner (#160), and a task test did the same once before. A test
    // that talks to the real database is measured against the slowest machine
    // it runs on, not against the fastest.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
