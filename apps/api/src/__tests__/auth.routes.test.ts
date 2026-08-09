/**
 * Testes de integração — auth.routes.ts
 *
 * Cobre:
 *  POST /auth/login
 *   - credenciais válidas → retorna token + refreshToken + dados do usuário
 *   - token gerado contém sub, tenantId e perfil
 *   - usuário inexistente → 401
 *   - senha incorreta → 401
 *   - body inválido (sem email, sem password) → 400
 *  POST /auth/refresh
 *   - refreshToken válido → retorna novo access token
 *   - refreshToken com tipo errado (access token) → 401
 *   - token inválido → 401
 *   - body sem campo → 400
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import jwt from '@fastify/jwt'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Mocks (devem ser configurados antes de qualquer import do módulo sob teste)
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
    usuario: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { authRoutes } from '../routes/auth.routes.js'
import mockBcrypt from 'bcrypt'
const bcryptCompare = vi.mocked(mockBcrypt.compare)

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  await app.register(jwt, { secret: 'test-secret-key-32-chars-minimum!!' })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Dados inválidos', detalhes: error.errors })
    }
    const statusCode = error.statusCode ?? 500
    return reply.code(statusCode).send({ error: error.message ?? 'Erro interno' })
  })

  await app.register(authRoutes, { prefix: '/auth' })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_HASH = '$2b$04$fakehashthatdoesnotmatter'

function usuarioBase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    nome: 'Contador Silva',
    email: 'contador@escritorio.com',
    senhaHash: FAKE_HASH,
    perfil: 'ADMIN',
    tenantId: 'tenant-1',
    ativo: true,
    tenant: { id: 'tenant-1', nome: 'Escritório Silva' },
    ...overrides,
  }
}

// ===========================================================================
// POST /auth/login
// ===========================================================================

describe('POST /auth/login', () => {
  it('credenciais válidas → 200 com token, refreshToken e dados do usuário', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce(usuarioBase())
    bcryptCompare.mockResolvedValueOnce(true)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'contador@escritorio.com', password: 'senha123' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.token).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(body.usuario).toMatchObject({
      id: 'user-1',
      nome: 'Contador Silva',
      email: 'contador@escritorio.com',
      perfil: 'ADMIN',
    })
  })

  it('token gerado contém sub, tenantId e perfil', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce(usuarioBase())
    bcryptCompare.mockResolvedValueOnce(true)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'contador@escritorio.com', password: 'senha123' },
    })

    const { token } = res.json()
    const payload = app.jwt.verify(token) as Record<string, unknown>
    expect(payload['sub']).toBe('user-1')
    expect(payload['tenantId']).toBe('tenant-1')
    expect(payload['perfil']).toBe('ADMIN')
  })

  it('usuário não encontrado → 401', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'naoexiste@email.com', password: 'qualquer123' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Credenciais inválidas')
  })

  it('senha incorreta → 401', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce(usuarioBase())
    bcryptCompare.mockResolvedValueOnce(false)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'contador@escritorio.com', password: 'senhaErrada' },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Credenciais inválidas')
  })

  it('usuário inativo → 401 (findFirst filtra ativo: true, retorna null)', async () => {
    mockDb.usuario.findFirst.mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'inativo@escritorio.com', password: 'senha123' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('body sem email → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: 'senha123' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('body sem password → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'contador@escritorio.com' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('email inválido (sem @) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nao-e-email', password: 'senha123' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('password muito curta (< 6 chars) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@b.com', password: '123' },
    })

    expect(res.statusCode).toBe(400)
  })
})

// ===========================================================================
// POST /auth/refresh
// ===========================================================================

describe('POST /auth/refresh', () => {
  function makeRefreshToken(extra: Record<string, unknown> = {}) {
    return app.jwt.sign(
      { sub: 'user-1', tenantId: 'tenant-1', type: 'refresh', ...extra },
      { expiresIn: '30d' }
    )
  }

  it('refreshToken válido → 200 com novo access token', async () => {
    const refreshToken = makeRefreshToken()

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    })

    expect(res.statusCode).toBe(200)
    const { token } = res.json()
    expect(token).toBeTruthy()
    const payload = app.jwt.verify(token) as Record<string, unknown>
    expect(payload['sub']).toBe('user-1')
    expect(payload['tenantId']).toBe('tenant-1')
  })

  it('access token passado como refreshToken → 401 (tipo errado)', async () => {
    const accessToken = app.jwt.sign(
      { sub: 'user-1', tenantId: 'tenant-1', perfil: 'ADMIN' },
      { expiresIn: '8h' }
    )

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: accessToken },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Token inválido')
  })

  it('token completamente inválido → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'nao.e.um.jwt.valido' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('body sem refreshToken → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {},
    })

    expect(res.statusCode).toBe(400)
  })
})
