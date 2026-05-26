/**
 * Testes de integração — configuracoes.routes.ts
 *
 * Cobre:
 *  GET /configuracoes/perfil — dados do tenant + usuário logado + stats
 *  PUT /configuracoes/perfil — atualiza nome do usuário logado
 *  PUT /configuracoes/senha — troca senha (valida senha atual, exige 8+ chars)
 *  GET /configuracoes/usuarios — lista usuários do tenant (admin only → 403 para outros)
 *  POST /configuracoes/usuarios — cria usuário (admin only, verifica e-mail duplicado)
 *  PATCH /configuracoes/usuarios/:id — altera perfil/status (guarda auto-desativação)
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks (antes dos imports das rotas)
// ---------------------------------------------------------------------------

vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
  compare: vi.fn(),
  hash: vi.fn(),
}))

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    tenant: { findUnique: vi.fn() },
    usuario: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    empresaCliente: { count: vi.fn() },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { configuracoesRoutes } from '../routes/configuracoes.routes.js'
import mockBcrypt from 'bcrypt'
const bcryptCompare = vi.mocked(mockBcrypt.compare)
const bcryptHash = vi.mocked(mockBcrypt.hash)

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-t1'
const ADMIN_ID = 'admin-a1'
const USER_ID = 'user-u1'

function buildApp(perfil: 'ADMIN' | 'CONTADOR', userId: string) {
  const a = Fastify({ logger: false })
  a.register(jwt, { secret: 'test-secret-key-32-chars-minimum!!' })
  a.addHook('onRequest', async (request) => {
    if (request.headers['x-test-skip-auth'] === '1') {
      ;(request as any).user = { sub: userId, tenantId: TENANT_ID, perfil }
    }
  })
  a.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Dados inválidos', detalhes: error.errors })
    }
    const statusCode = error.statusCode ?? 500
    return reply.code(statusCode).send({ error: error.message ?? 'Erro interno' })
  })
  a.register(configuracoesRoutes, { prefix: '/configuracoes' })
  return a
}

let adminApp: FastifyInstance
let contadorApp: FastifyInstance

beforeAll(async () => {
  adminApp = buildApp('ADMIN', ADMIN_ID)
  contadorApp = buildApp('CONTADOR', USER_ID)
  await adminApp.ready()
  await contadorApp.ready()
})

afterAll(async () => {
  await adminApp.close()
  await contadorApp.close()
})

beforeEach(() => {
  vi.clearAllMocks()
})

function req(a: FastifyInstance, method: string, url: string, payload?: unknown) {
  return a.inject({
    method: method as any,
    url,
    headers: { 'x-test-skip-auth': '1' },
    payload: payload as any,
  })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tenantBase = {
  id: TENANT_ID,
  nome: 'Escritório Teste',
  cnpj: '11111111000111',
  subdominio: 'teste',
  plano: 'BASICO',
  ativo: true,
  criadoEm: new Date(),
}

const usuarioBase = {
  id: ADMIN_ID,
  nome: 'Admin Silva',
  email: 'admin@teste.com',
  perfil: 'ADMIN',
  criadoEm: new Date(),
}

// ===========================================================================
// GET /configuracoes/perfil
// ===========================================================================

describe('GET /configuracoes/perfil', () => {
  it('retorna tenant, usuario e stats', async () => {
    mockDb.tenant.findUnique.mockResolvedValueOnce(tenantBase)
    mockDb.usuario.findUnique.mockResolvedValueOnce(usuarioBase)
    mockDb.empresaCliente.count.mockResolvedValueOnce(42)
    mockDb.usuario.count.mockResolvedValueOnce(3)

    const res = await req(adminApp, 'GET', '/configuracoes/perfil')

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.tenant.nome).toBe('Escritório Teste')
    expect(body.usuario.nome).toBe('Admin Silva')
    expect(body.stats.totalEmpresas).toBe(42)
    expect(body.stats.totalUsuarios).toBe(3)
  })

  it('tenant não encontrado → 404', async () => {
    mockDb.tenant.findUnique.mockResolvedValueOnce(null)
    mockDb.usuario.findUnique.mockResolvedValueOnce(usuarioBase)

    const res = await req(adminApp, 'GET', '/configuracoes/perfil')

    expect(res.statusCode).toBe(404)
  })

  it('stats usa tenantId do JWT', async () => {
    mockDb.tenant.findUnique.mockResolvedValueOnce(tenantBase)
    mockDb.usuario.findUnique.mockResolvedValueOnce(usuarioBase)
    mockDb.empresaCliente.count.mockResolvedValueOnce(0)
    mockDb.usuario.count.mockResolvedValueOnce(0)

    await req(adminApp, 'GET', '/configuracoes/perfil')

    const empresaWhere = mockDb.empresaCliente.count.mock.calls[0][0].where
    expect(empresaWhere.tenantId).toBe(TENANT_ID)
  })
})

// ===========================================================================
// PUT /configuracoes/perfil
// ===========================================================================

describe('PUT /configuracoes/perfil', () => {
  it('atualiza nome do usuário → 200', async () => {
    mockDb.usuario.update.mockResolvedValueOnce({ ...usuarioBase, nome: 'Novo Nome' })

    const res = await req(adminApp, 'PUT', '/configuracoes/perfil', { nome: 'Novo Nome' })

    expect(res.statusCode).toBe(200)
    expect(res.json().nome).toBe('Novo Nome')
  })

  it('nome com menos de 2 chars → 400', async () => {
    const res = await req(adminApp, 'PUT', '/configuracoes/perfil', { nome: 'A' })
    expect(res.statusCode).toBe(400)
  })

  it('nome com mais de 100 chars → 400', async () => {
    const res = await req(adminApp, 'PUT', '/configuracoes/perfil', { nome: 'A'.repeat(101) })
    expect(res.statusCode).toBe(400)
  })

  it('atualiza somente o usuário do JWT (sub)', async () => {
    mockDb.usuario.update.mockResolvedValueOnce(usuarioBase)

    await req(adminApp, 'PUT', '/configuracoes/perfil', { nome: 'Testando' })

    const { where } = mockDb.usuario.update.mock.calls[0][0]
    expect(where.id).toBe(ADMIN_ID)
  })
})

// ===========================================================================
// PUT /configuracoes/senha
// ===========================================================================

describe('PUT /configuracoes/senha', () => {
  it('senha válida → 200 com success: true', async () => {
    mockDb.usuario.findUnique.mockResolvedValueOnce({ id: ADMIN_ID, senhaHash: 'hash-atual' })
    bcryptCompare.mockResolvedValueOnce(true)
    bcryptHash.mockResolvedValueOnce('novo-hash')
    mockDb.usuario.update.mockResolvedValueOnce({})

    const res = await req(adminApp, 'PUT', '/configuracoes/senha', {
      senhaAtual: 'senha123',
      novaSenha: 'novasenha123',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('senha atual incorreta → 400', async () => {
    mockDb.usuario.findUnique.mockResolvedValueOnce({ id: ADMIN_ID, senhaHash: 'hash' })
    bcryptCompare.mockResolvedValueOnce(false)

    const res = await req(adminApp, 'PUT', '/configuracoes/senha', {
      senhaAtual: 'errada',
      novaSenha: 'novasenha123',
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/incorreta/i)
  })

  it('nova senha com menos de 8 chars → 400', async () => {
    const res = await req(adminApp, 'PUT', '/configuracoes/senha', {
      senhaAtual: 'senha123',
      novaSenha: '1234567',
    })

    expect(res.statusCode).toBe(400)
  })

  it('usuário não encontrado → 404', async () => {
    mockDb.usuario.findUnique.mockResolvedValueOnce(null)

    const res = await req(adminApp, 'PUT', '/configuracoes/senha', {
      senhaAtual: 'senha123',
      novaSenha: 'novasenha123',
    })

    expect(res.statusCode).toBe(404)
  })

  it('grava o novo hash (não a senha em texto) no banco', async () => {
    mockDb.usuario.findUnique.mockResolvedValueOnce({ id: ADMIN_ID, senhaHash: 'hash' })
    bcryptCompare.mockResolvedValueOnce(true)
    bcryptHash.mockResolvedValueOnce('hash-novo-bcrypt')
    mockDb.usuario.update.mockResolvedValueOnce({})

    await req(adminApp, 'PUT', '/configuracoes/senha', {
      senhaAtual: 'senha123',
      novaSenha: 'novasenha123',
    })

    const { data } = mockDb.usuario.update.mock.calls[0][0]
    expect(data.senhaHash).toBe('hash-novo-bcrypt')
  })
})

// ===========================================================================
// GET /configuracoes/usuarios
// ===========================================================================

describe('GET /configuracoes/usuarios', () => {
  it('admin → 200 com lista', async () => {
    mockDb.usuario.findMany.mockResolvedValueOnce([usuarioBase])

    const res = await req(adminApp, 'GET', '/configuracoes/usuarios')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('não-admin (CONTADOR) → 403', async () => {
    const res = await req(contadorApp, 'GET', '/configuracoes/usuarios')

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/administradores/i)
  })

  it('filtra por tenantId do JWT', async () => {
    mockDb.usuario.findMany.mockResolvedValueOnce([])

    await req(adminApp, 'GET', '/configuracoes/usuarios')

    const { where } = mockDb.usuario.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
  })
})

// ===========================================================================
// POST /configuracoes/usuarios
// ===========================================================================

describe('POST /configuracoes/usuarios', () => {
  const novoUser = {
    nome: 'Auxiliar Oliveira',
    email: 'auxiliar@teste.com',
    senha: 'senha12345',
    perfilNovo: 'AUXILIAR',
  }

  it('admin cria usuário → 201', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce(null)
    bcryptHash.mockResolvedValueOnce('hash-senha')
    mockDb.usuario.create.mockResolvedValueOnce({
      id: 'novo-id',
      nome: novoUser.nome,
      email: novoUser.email,
      perfil: 'AUXILIAR',
      ativo: true,
      criadoEm: new Date(),
    })

    const res = await req(adminApp, 'POST', '/configuracoes/usuarios', novoUser)

    expect(res.statusCode).toBe(201)
    expect(res.json().email).toBe('auxiliar@teste.com')
  })

  it('não-admin (CONTADOR) → 403', async () => {
    const res = await req(contadorApp, 'POST', '/configuracoes/usuarios', novoUser)
    expect(res.statusCode).toBe(403)
  })

  it('email duplicado → 409', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce({ id: 'existente' })

    const res = await req(adminApp, 'POST', '/configuracoes/usuarios', novoUser)

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/já cadastrado/i)
  })

  it('senha com menos de 8 chars → 400', async () => {
    const res = await req(adminApp, 'POST', '/configuracoes/usuarios', {
      ...novoUser,
      senha: '1234567',
    })
    expect(res.statusCode).toBe(400)
  })

  it('email inválido → 400', async () => {
    const res = await req(adminApp, 'POST', '/configuracoes/usuarios', {
      ...novoUser,
      email: 'nao-e-email',
    })
    expect(res.statusCode).toBe(400)
  })

  it('cria com tenantId do JWT', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce(null)
    bcryptHash.mockResolvedValueOnce('hash')
    mockDb.usuario.create.mockResolvedValueOnce({ id: 'x' })

    await req(adminApp, 'POST', '/configuracoes/usuarios', novoUser)

    const { data } = mockDb.usuario.create.mock.calls[0][0]
    expect(data.tenantId).toBe(TENANT_ID)
  })

  it('perfil padrão é AUXILIAR quando não informado', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce(null)
    bcryptHash.mockResolvedValueOnce('hash')
    mockDb.usuario.create.mockResolvedValueOnce({ id: 'x' })

    await req(adminApp, 'POST', '/configuracoes/usuarios', {
      nome: 'Teste',
      email: 'tt@ok.com',
      senha: 'senha123456',
    })

    const { data } = mockDb.usuario.create.mock.calls[0][0]
    expect(data.perfil).toBe('AUXILIAR')
  })

  it('não armazena senha em texto — usa hash', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce(null)
    bcryptHash.mockResolvedValueOnce('bcrypt-hash-resultado')
    mockDb.usuario.create.mockResolvedValueOnce({ id: 'x' })

    await req(adminApp, 'POST', '/configuracoes/usuarios', novoUser)

    const { data } = mockDb.usuario.create.mock.calls[0][0]
    expect(data.senhaHash).toBe('bcrypt-hash-resultado')
    expect(data).not.toHaveProperty('senha')
  })
})

// ===========================================================================
// PATCH /configuracoes/usuarios/:id
// ===========================================================================

describe('PATCH /configuracoes/usuarios/:id', () => {
  it('admin altera perfil de outro usuário → 200', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce({ id: USER_ID, ...usuarioBase })
    mockDb.usuario.update.mockResolvedValueOnce({ id: USER_ID, perfil: 'CONTADOR', ativo: true })

    const res = await req(adminApp, 'PATCH', `/configuracoes/usuarios/${USER_ID}`, {
      perfilNovo: 'CONTADOR',
    })

    expect(res.statusCode).toBe(200)
  })

  it('admin tenta desativar a própria conta → 400', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce({ id: ADMIN_ID })

    const res = await req(adminApp, 'PATCH', `/configuracoes/usuarios/${ADMIN_ID}`, {
      ativo: false,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/própria conta/i)
  })

  it('não-admin → 403', async () => {
    const res = await req(contadorApp, 'PATCH', `/configuracoes/usuarios/${USER_ID}`, {
      ativo: false,
    })
    expect(res.statusCode).toBe(403)
  })

  it('usuário não encontrado no tenant → 404', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce(null)

    const res = await req(adminApp, 'PATCH', '/configuracoes/usuarios/nao-existe', {
      ativo: true,
    })

    expect(res.statusCode).toBe(404)
  })

  it('perfil inválido → 400', async () => {
    const res = await req(adminApp, 'PATCH', `/configuracoes/usuarios/${USER_ID}`, {
      perfilNovo: 'SUPER_ADMIN',
    })
    expect(res.statusCode).toBe(400)
  })

  it('admin pode desativar outro usuário', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce({ id: USER_ID })
    mockDb.usuario.update.mockResolvedValueOnce({ id: USER_ID, ativo: false })

    const res = await req(adminApp, 'PATCH', `/configuracoes/usuarios/${USER_ID}`, {
      ativo: false,
    })

    expect(res.statusCode).toBe(200)
    const { data } = mockDb.usuario.update.mock.calls[0][0]
    expect(data.ativo).toBe(false)
  })
})
