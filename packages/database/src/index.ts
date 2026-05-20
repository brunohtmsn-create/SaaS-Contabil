export { PrismaClient } from '@prisma/client'
export * from '@prisma/client'

import { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env['NODE_ENV'] === 'development' ? ['query', 'error', 'warn'] : ['error'],
    })
  }
  return prisma
}

export { prisma }
