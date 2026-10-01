import { mergeConfig } from 'vitest/config'
import { shared } from '../../../vitest.shared.js'

export default mergeConfig(shared, {
  test: {
    name: 'platform-server',
    environment: 'node',
    // The tests that talk to a database share one and empty it before they
    // run. Side by side they would pull the schema out from under each other.
    // The same database is the one the tests of an application use, which is
    // why `turbo.json` runs these first and never beside them.
    fileParallelism: false,
    // Measured against the slowest machine a test runs on, not the fastest: a
    // test that migrates a real database went past the five seconds Vitest
    // gives on a busy CI runner.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
