import { mergeConfig } from 'vitest/config'
import { shared } from '../../vitest.shared.js'

export default mergeConfig(shared, {
  test: {
    name: 'server',
    environment: 'node',
    // The database tests share one database and empty it before they run.
    // Side by side they would pull the schema out from under each other.
    fileParallelism: false,
  },
})
