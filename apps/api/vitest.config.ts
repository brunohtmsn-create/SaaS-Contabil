import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@saas-contabil/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@saas-contabil/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
      '@saas-contabil/audit': path.resolve(__dirname, '../../packages/audit/src/index.ts'),
      '@saas-contabil/storage': path.resolve(__dirname, '../../packages/storage/src/index.ts'),
      '@saas-contabil/credentials': path.resolve(
        __dirname,
        '../../packages/credentials/src/index.ts'
      ),
      '@saas-contabil/conciliation': path.resolve(
        __dirname,
        '../../packages/conciliation/src/index.ts'
      ),
      '@saas-contabil/fiscal': path.resolve(__dirname, '../../packages/fiscal/src/index.ts'),
      '@saas-contabil/contabil': path.resolve(__dirname, '../../packages/contabil/src/index.ts'),
      '@saas-contabil/portals': path.resolve(__dirname, '../../packages/portals/src/index.ts'),
      '@saas-contabil/scraper': path.resolve(__dirname, '../../packages/scraper/src/index.ts'),
      '@saas-contabil/normalizer': path.resolve(
        __dirname,
        '../../packages/normalizer/src/index.ts'
      ),
      '@saas-contabil/notifications': path.resolve(
        __dirname,
        '../../packages/notifications/src/index.ts'
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
