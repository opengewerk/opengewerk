import react from '@vitejs/plugin-react'
import { mergeConfig } from 'vitest/config'
import { shared } from '../../vitest.shared.js'

export default mergeConfig(shared, {
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'happy-dom',
  },
})
