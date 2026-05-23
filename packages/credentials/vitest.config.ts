import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@saas-contabil/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@saas-contabil/database': path.resolve(__dirname, '../database/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
