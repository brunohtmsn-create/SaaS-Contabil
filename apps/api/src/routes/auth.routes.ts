import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcrypt'
import { getPrismaClient } from '@saas-contabil/database'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { email, password } = loginSchema.parse(request.body)
      const db = getPrismaClient()

      const usuario = await db.usuario.findFirst({
        where: { email, ativo: true },
        include: { tenant: true },
      })

      if (!usuario) return reply.code(401).send({ error: 'Credenciais inválidas' })

      const valid = await bcrypt.compare(password, usuario.senhaHash)
      if (!valid) return reply.code(401).send({ error: 'Credenciais inválidas' })

      const token = app.jwt.sign(
        { sub: usuario.id, tenantId: usuario.tenantId, perfil: usuario.perfil },
        { expiresIn: '8h' }
      )

      const refreshToken = app.jwt.sign(
        { sub: usuario.id, tenantId: usuario.tenantId, type: 'refresh' },
        { expiresIn: '30d' }
      )

      return {
        token,
        refreshToken,
        usuario: {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          perfil: usuario.perfil,
        },
      }
    }
  )

  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(request.body)
    try {
      const payload = app.jwt.verify(refreshToken) as any
      if (payload.type !== 'refresh') throw new Error('Invalid token type')
      const newToken = app.jwt.sign(
        { sub: payload.sub, tenantId: payload.tenantId },
        { expiresIn: '8h' }
      )
      return { token: newToken }
    } catch {
      return reply.code(401).send({ error: 'Token inválido' })
    }
  })
}
