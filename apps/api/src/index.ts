import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
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
  secret: process.env['JWT_SECRET'] ?? 'dev-secret',
})

app.addHook('onRequest', async (request, reply) => {
  const publicRoutes = ['/auth/login', '/auth/refresh', '/health']
  if (publicRoutes.includes(request.url)) return

  try {
    await request.jwtVerify()
  } catch {
    reply.code(401).send({ error: 'Unauthorized' })
  }
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

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

const port = Number(process.env['PORT'] ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
console.log(`API running on port ${port}`)
