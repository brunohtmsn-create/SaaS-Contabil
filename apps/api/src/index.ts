import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'
import IORedis from 'ioredis'
import { getPrismaClient } from '@saas-contabil/database'
import { authRoutes } from './routes/auth.routes.js'
import { empresaRoutes } from './routes/empresa.routes.js'
import { documentoRoutes } from './routes/documento.routes.js'
import { fiscalRoutes } from './routes/fiscal.routes.js'
import { conciliacaoRoutes } from './routes/conciliacao.routes.js'
import { contabilRoutes } from './routes/contabil.routes.js'
import { portalRoutes } from './routes/portal.routes.js'
import { auditRoutes } from './routes/audit.routes.js'
import { fechamentoRoutes } from './routes/fechamento.routes.js'
import { credencialRoutes } from './routes/credencial.routes.js'
import { dashboardRoutes } from './routes/dashboard.routes.js'
import { relatorioRoutes } from './routes/relatorio.routes.js'
import { wsRoutes } from './routes/ws.routes.js'

// Recusa iniciar sem segredos obrigatórios em produção
if (process.env['NODE_ENV'] === 'production') {
  if (!process.env['JWT_SECRET']) throw new Error('JWT_SECRET não definido em produção')
  if (!process.env['JWT_REFRESH_SECRET']) throw new Error('JWT_REFRESH_SECRET não definido em produção')
  if (!process.env['CREDENTIALS_MASTER_KEY']) throw new Error('CREDENTIALS_MASTER_KEY não definido em produção')
}

const app = Fastify({
  logger: {
    level: process.env['NODE_ENV'] === 'production' ? 'warn' : 'info',
  },
})

await app.register(cors, {
  origin: process.env['FRONTEND_URL'] ?? 'http://localhost:3001',
  credentials: true,
})

await app.register(jwt, {
  // 'dev-secret' apenas aceitável fora de produção — a checagem acima garante isso
  secret: process.env['JWT_SECRET'] ?? 'dev-secret-not-for-production',
})

// multipart DEVE ser registrado ANTES das rotas que usam request.parts()
await app.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB — protege contra DoS por upload gigante
    files: 50,                  // máx 50 arquivos por request (upload em lote)
    fields: 10,
  },
})

await app.register(websocket)

app.addHook('onRequest', async (request, reply) => {
  const publicRoutes = ['/auth/login', '/auth/refresh', '/health']
  if (publicRoutes.includes(request.url)) return

  try {
    await request.jwtVerify()
  } catch {
    reply.code(401).send({ error: 'Unauthorized' })
  }
})

app.setErrorHandler((error, _request, reply) => {
  if (error.validation) {
    return reply.code(400).send({ error: 'Dados inválidos', detalhes: error.validation })
  }
  const statusCode = error.statusCode ?? 500
  if (statusCode >= 500) {
    app.log.error(error)
  }
  reply.code(statusCode).send({ error: error.message ?? 'Erro interno do servidor' })
})

await app.register(authRoutes, { prefix: '/auth' })
await app.register(empresaRoutes, { prefix: '/empresas' })
await app.register(documentoRoutes, { prefix: '/documentos' })
await app.register(fiscalRoutes, { prefix: '/fiscal' })
await app.register(conciliacaoRoutes, { prefix: '/conciliacao' })
await app.register(contabilRoutes, { prefix: '/contabil' })
await app.register(portalRoutes, { prefix: '/portais' })
await app.register(auditRoutes, { prefix: '/auditoria' })
await app.register(fechamentoRoutes, { prefix: '/fechamento' })
await app.register(credencialRoutes, { prefix: '/credenciais' })
await app.register(dashboardRoutes, { prefix: '/dashboard' })
await app.register(relatorioRoutes, { prefix: '/relatorios' })
await app.register(wsRoutes, { prefix: '/ws' })

app.get('/health', async (_request, reply) => {
  const db = getPrismaClient()
  const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null, lazyConnect: true })

  const [dbOk, redisOk] = await Promise.all([
    db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    redis.ping().then((r) => r === 'PONG').catch(() => false),
  ])
  redis.disconnect()

  const status = dbOk && redisOk ? 'ok' : 'degraded'
  reply.code(dbOk && redisOk ? 200 : 503)
  return { status, db: dbOk ? 'ok' : 'error', redis: redisOk ? 'ok' : 'error', timestamp: new Date().toISOString() }
})

const port = Number(process.env['PORT'] ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
console.log(`API running on port ${port}`)
