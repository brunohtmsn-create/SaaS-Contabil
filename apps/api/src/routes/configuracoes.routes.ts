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
        select: {
          id: true,
          nome: true,
          cnpj: true,
          subdominio: true,
          plano: true,
          ativo: true,
          criadoEm: true,
        },
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
    const { senhaAtual, novaSenha } = z
      .object({
        senhaAtual: z.string().min(1),
        novaSenha: z.string().min(8, 'Nova senha deve ter pelo menos 8 caracteres'),
      })
      .parse(request.body)

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
    if (perfil !== 'ADMIN')
      return reply.code(403).send({ error: 'Acesso restrito a administradores' })

    return db.usuario.findMany({
      where: { tenantId },
      select: { id: true, nome: true, email: true, perfil: true, ativo: true, criadoEm: true },
      orderBy: { nome: 'asc' },
    })
  })

  // POST /configuracoes/usuarios — cria novo usuário no tenant (admin only)
  app.post('/usuarios', async (request, reply) => {
    const { tenantId, perfil } = request.user as any
    if (perfil !== 'ADMIN')
      return reply.code(403).send({ error: 'Acesso restrito a administradores' })

    const { nome, email, senha, perfilNovo } = z
      .object({
        nome: z.string().min(2).max(100),
        email: z.string().email(),
        senha: z.string().min(8),
        perfilNovo: z.enum(['ADMIN', 'CONTADOR', 'AUXILIAR', 'CLIENTE']).default('AUXILIAR'),
      })
      .parse(request.body)

    const existente = await db.usuario.findFirst({ where: { email } })
    if (existente) return reply.code(409).send({ error: 'E-mail já cadastrado' })

    const senhaHash = await bcrypt.hash(senha, 12)
    const usuario = await db.usuario.create({
      data: { tenantId, nome, email, senhaHash, perfil: perfilNovo },
      select: { id: true, nome: true, email: true, perfil: true, ativo: true, criadoEm: true },
    })

    return reply.code(201).send(usuario)
  })

  // PATCH /configuracoes/usuarios/:id — altera perfil ou status do usuário (admin only)
  app.patch('/usuarios/:id', async (request, reply) => {
    const { tenantId, perfil, sub: adminId } = request.user as any
    if (perfil !== 'ADMIN')
      return reply.code(403).send({ error: 'Acesso restrito a administradores' })

    const { id } = request.params as { id: string }
    const body = z
      .object({
        perfilNovo: z.enum(['ADMIN', 'CONTADOR', 'AUXILIAR', 'CLIENTE']).optional(),
        ativo: z.boolean().optional(),
      })
      .parse(request.body)

    const usuario = await db.usuario.findFirst({ where: { id, tenantId } })
    if (!usuario) return reply.code(404).send({ error: 'Usuário não encontrado' })

    if (id === adminId && body.ativo === false)
      return reply.code(400).send({ error: 'Não é possível desativar a própria conta' })

    const data: Record<string, unknown> = {}
    if (body.perfilNovo !== undefined) data['perfil'] = body.perfilNovo
    if (body.ativo !== undefined) data['ativo'] = body.ativo

    const updated = await db.usuario.update({
      where: { id },
      data: data as any,
      select: { id: true, nome: true, email: true, perfil: true, ativo: true },
    })

    return updated
  })
}
