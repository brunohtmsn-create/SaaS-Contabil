import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcrypt'
import { getPrismaClient } from '@saas-contabil/database'

export async function configuracoesRoutes(app: FastifyInstance) {
  const db = getPrismaClient()

  // GET /configuracoes/perfil — dados do tenant + usuário logado
  app.get('/perfil', async (request, reply) => {
    const { tenantId, sub: userId } = request.user as any

    const [tenant, usuario] = await Promise.all([
      db.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, nome: true, cnpj: true, subdominio: true, plano: true, ativo: true, criadoEm: true },
      }),
      db.usuario.findUnique({
        where: { id: userId },
        select: { id: true, nome: true, email: true, perfil: true, criadoEm: true },
      }),
    ])

    if (!tenant) return reply.code(404).send({ error: 'Tenant não encontrado' })

    const [totalEmpresas, totalUsuarios] = await Promise.all([
      db.empresaCliente.count({ where: { tenantId } }),
      db.usuario.count({ where: { tenantId, ativo: true } }),
    ])

    return { tenant, usuario, stats: { totalEmpresas, totalUsuarios } }
  })

  // PUT /configuracoes/perfil — atualiza nome do usuário logado
  app.put('/perfil', async (request, reply) => {
    const { sub: userId } = request.user as any
    const { nome } = z.object({ nome: z.string().min(2).max(100) }).parse(request.body)

    const updated = await db.usuario.update({
      where: { id: userId },
      data: { nome },
      select: { id: true, nome: true, email: true, perfil: true },
    })

    return updated
  })

  // PUT /configuracoes/senha — troca senha do usuário logado
  app.put('/senha', async (request, reply) => {
    const { sub: userId } = request.user as any
    const { senhaAtual, novaSenha } = z.object({
      senhaAtual: z.string().min(1),
      novaSenha: z.string().min(8, 'Nova senha deve ter pelo menos 8 caracteres'),
    }).parse(request.body)

    const usuario = await db.usuario.findUnique({ where: { id: userId } })
    if (!usuario) return reply.code(404).send({ error: 'Usuário não encontrado' })

    const valida = await bcrypt.compare(senhaAtual, usuario.senhaHash)
    if (!valida) return reply.code(400).send({ error: 'Senha atual incorreta' })

    const hash = await bcrypt.hash(novaSenha, 12)
    await db.usuario.update({ where: { id: userId }, data: { senhaHash: hash } })

    return { success: true }
  })

  // GET /configuracoes/usuarios — lista usuários do tenant (admin only)
  app.get('/usuarios', async (request, reply) => {
    const { tenantId, perfil } = request.user as any
    if (perfil !== 'ADMIN') return reply.code(403).send({ error: 'Acesso restrito a administradores' })

    return db.usuario.findMany({
      where: { tenantId },
      select: { id: true, nome: true, email: true, perfil: true, ativo: true, criadoEm: true },
      orderBy: { nome: 'asc' },
    })
  })
}
