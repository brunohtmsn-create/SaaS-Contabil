import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to their TypeScript source so tests
      // run without requiring a prior build of sibling packages.
      '@saas-contabil/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      '@saas-contabil/database': path.resolve(__dirname, '../database/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
