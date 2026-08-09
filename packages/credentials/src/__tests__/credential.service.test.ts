/**
 * Testes unitários — CredentialService
 *
 * Cobre:
 *  - store(): cria credencial com encryptedData, iv e authTag
 *  - store(): salva tenantId, empresaId e cnpj corretos
 *  - store(): status inicial ATIVO
 *  - retrieve(): lança erro quando credencial não encontrada
 *  - retrieve(): lança erro quando status VENCIDO
 *  - retrieve(): lança erro quando status REVOGADO
 *  - retrieve(): retorna CredentialDecrypted com cnpj e tipo corretos
 *  - retrieve(): atualiza ultimoUso e ultimoResultado=SUCESSO
 *  - markError(): atualiza ultimoResultado=FALHA
 *  - revoke(): chama updateMany com status=REVOGADO e filtra tenantId
 *  - checkExpiring(): filtra status ATIVO e validade dentro do corte
 *  - updateExpiredStatuses(): atualiza status vencidas e retorna count
 *  - findByCnpj(): busca por tenantId + cnpj + ATIVO
 *  - findByTipo(): busca por tenantId + cnpj + tipo + ATIVO
 *
 * PrismaClient e funções de cripto/shared são mockadas.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    credencial: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    deriveKey: vi.fn(() => Buffer.from('chave-derivada-mock-32-bytes-000')),
    encrypt: vi.fn(() => ({
      encrypted: Buffer.from('encrypted'),
      iv: Buffer.from('iv-mock-12bytes!'),
      tag: Buffer.from('tag-mock'),
    })),
    decrypt: vi.fn(() => Buffer.from('{"senha":"abc123"}')),
    nowBR: vi.fn(() => new Date('2025-05-15T12:00:00.000Z')),
    addDays: vi.fn((date: Date, days: number) => new Date(date.getTime() + days * 86400000)),
  }
})

import { CredentialService } from '../credential.service.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-cred'
const EMPRESA_ID = 'emp-cred'
const CNPJ = '11222333000181'
const CRED_ID = 'cred-uuid-001'

const CRED_DB = {
  id: CRED_ID,
  tenantId: TENANT_ID,
  cnpj: CNPJ,
  tipo: 'ECAC',
  status: 'ATIVO',
  encryptedData: Buffer.from('encrypted'),
  iv: Buffer.from('iv-mock-12bytes!'),
  authTag: Buffer.from('tag-mock'),
  validade: null,
  escopos: ['PGDAS'],
  ultimoUso: null,
  ultimoResultado: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ===========================================================================
// store
// ===========================================================================

describe('CredentialService.store()', () => {
  it('cria credencial com dados criptografados (encryptedData, iv, authTag)', async () => {
    mockDb.credencial.create.mockResolvedValueOnce({ id: CRED_ID })

    const svc = new CredentialService()
    await svc.store({
      tenantId: TENANT_ID,
      empresaId: EMPRESA_ID,
      cnpj: CNPJ,
      tipo: 'ECAC',
      rawData: Buffer.from('meu-certificado'),
      escopos: ['PGDAS'],
      criadoPor: 'user-1',
    })

    const data = mockDb.credencial.create.mock.calls[0][0].data
    expect(data.encryptedData).toBeDefined()
    expect(data.iv).toBeDefined()
    expect(data.authTag).toBeDefined()
  })

  it('salva tenantId, empresaId e cnpj corretos', async () => {
    mockDb.credencial.create.mockResolvedValueOnce({ id: CRED_ID })

    const svc = new CredentialService()
    await svc.store({
      tenantId: TENANT_ID,
      empresaId: EMPRESA_ID,
      cnpj: CNPJ,
      tipo: 'ECAC',
      rawData: Buffer.from('cert'),
      escopos: [],
      criadoPor: 'user-1',
    })

    const data = mockDb.credencial.create.mock.calls[0][0].data
    expect(data.tenantId).toBe(TENANT_ID)
    expect(data.empresaId).toBe(EMPRESA_ID)
    expect(data.cnpj).toBe(CNPJ)
  })

  it('define status inicial como ATIVO', async () => {
    mockDb.credencial.create.mockResolvedValueOnce({ id: CRED_ID })

    const svc = new CredentialService()
    await svc.store({
      tenantId: TENANT_ID,
      empresaId: EMPRESA_ID,
      cnpj: CNPJ,
      tipo: 'ECAC',
      rawData: Buffer.from('cert'),
      escopos: [],
      criadoPor: 'user-1',
    })

    const data = mockDb.credencial.create.mock.calls[0][0].data
    expect(data.status).toBe('ATIVO')
  })
})

// ===========================================================================
// retrieve
// ===========================================================================

describe('CredentialService.retrieve()', () => {
  it('lança erro quando credencial não é encontrada', async () => {
    mockDb.credencial.findFirst.mockResolvedValueOnce(null)

    const svc = new CredentialService()
    await expect(svc.retrieve(CRED_ID, TENANT_ID)).rejects.toThrow(/não encontrada/)
  })

  it('lança erro quando status é VENCIDO', async () => {
    mockDb.credencial.findFirst.mockResolvedValueOnce({ ...CRED_DB, status: 'VENCIDO' })

    const svc = new CredentialService()
    await expect(svc.retrieve(CRED_ID, TENANT_ID)).rejects.toThrow(/vencida/)
  })

  it('lança erro quando status é REVOGADO', async () => {
    mockDb.credencial.findFirst.mockResolvedValueOnce({ ...CRED_DB, status: 'REVOGADO' })

    const svc = new CredentialService()
    await expect(svc.retrieve(CRED_ID, TENANT_ID)).rejects.toThrow(/revogada/)
  })

  it('retorna CredentialDecrypted com cnpj e tipo corretos', async () => {
    mockDb.credencial.findFirst.mockResolvedValueOnce(CRED_DB)
    mockDb.credencial.update.mockResolvedValueOnce({})

    const svc = new CredentialService()
    const result = await svc.retrieve(CRED_ID, TENANT_ID)

    expect(result.cnpj).toBe(CNPJ)
    expect(result.tipo).toBe('ECAC')
    expect(result.tenantId).toBe(TENANT_ID)
  })

  it('atualiza ultimoUso e ultimoResultado=SUCESSO após retrieve', async () => {
    mockDb.credencial.findFirst.mockResolvedValueOnce(CRED_DB)
    mockDb.credencial.update.mockResolvedValueOnce({})

    const svc = new CredentialService()
    await svc.retrieve(CRED_ID, TENANT_ID)

    const updateData = mockDb.credencial.update.mock.calls[0][0].data
    expect(updateData.ultimoResultado).toBe('SUCESSO')
    expect(updateData.ultimoUso).toBeDefined()
  })

  it('filtra findFirst por tenantId (isolamento)', async () => {
    mockDb.credencial.findFirst.mockResolvedValueOnce(null)

    const svc = new CredentialService()
    await svc.retrieve(CRED_ID, TENANT_ID).catch(() => {})

    const { where } = mockDb.credencial.findFirst.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.id).toBe(CRED_ID)
  })
})

// ===========================================================================
// markError
// ===========================================================================

describe('CredentialService.markError()', () => {
  it('atualiza ultimoResultado=FALHA para a credencial', async () => {
    mockDb.credencial.update.mockResolvedValueOnce({})

    const svc = new CredentialService()
    await svc.markError(CRED_ID)

    const { data } = mockDb.credencial.update.mock.calls[0][0]
    expect(data.ultimoResultado).toBe('FALHA')
  })
})

// ===========================================================================
// revoke
// ===========================================================================

describe('CredentialService.revoke()', () => {
  it('chama updateMany com status=REVOGADO', async () => {
    mockDb.credencial.updateMany.mockResolvedValueOnce({ count: 1 })

    const svc = new CredentialService()
    await svc.revoke(CRED_ID, TENANT_ID)

    const call = mockDb.credencial.updateMany.mock.calls[0][0]
    expect(call.data.status).toBe('REVOGADO')
    expect(call.where.id).toBe(CRED_ID)
    expect(call.where.tenantId).toBe(TENANT_ID)
  })
})

// ===========================================================================
// checkExpiring
// ===========================================================================

describe('CredentialService.checkExpiring()', () => {
  it('busca credenciais com status ATIVO e validade próxima', async () => {
    mockDb.credencial.findMany.mockResolvedValueOnce([])

    const svc = new CredentialService()
    await svc.checkExpiring(TENANT_ID, 30)

    const { where } = mockDb.credencial.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.status).toBe('ATIVO')
    expect(where.validade).toBeDefined()
  })

  it('retorna lista de credenciais próximas ao vencimento', async () => {
    const credVencendo = [{ id: 'cred-vence-logo', tipo: 'ECAC', cnpj: CNPJ }]
    mockDb.credencial.findMany.mockResolvedValueOnce(credVencendo)

    const svc = new CredentialService()
    const result = await svc.checkExpiring(TENANT_ID)

    expect(result).toEqual(credVencendo)
  })
})

// ===========================================================================
// updateExpiredStatuses
// ===========================================================================

describe('CredentialService.updateExpiredStatuses()', () => {
  it('atualiza status de vencidas para VENCIDO e retorna count', async () => {
    mockDb.credencial.updateMany.mockResolvedValueOnce({ count: 3 })

    const svc = new CredentialService()
    const count = await svc.updateExpiredStatuses(TENANT_ID)

    expect(count).toBe(3)
    const call = mockDb.credencial.updateMany.mock.calls[0][0]
    expect(call.data.status).toBe('VENCIDO')
    expect(call.where.tenantId).toBe(TENANT_ID)
    expect(call.where.status).toBe('ATIVO')
  })
})

// ===========================================================================
// findByCnpj / findByTipo
// ===========================================================================

describe('CredentialService.findByCnpj()', () => {
  it('busca por tenantId + cnpj + status ATIVO', async () => {
    mockDb.credencial.findMany.mockResolvedValueOnce([{ id: 'c1' }])

    const svc = new CredentialService()
    const result = await svc.findByCnpj(TENANT_ID, CNPJ)

    const { where } = mockDb.credencial.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.cnpj).toBe(CNPJ)
    expect(where.status).toBe('ATIVO')
    expect(result).toHaveLength(1)
  })
})

describe('CredentialService.findByTipo()', () => {
  it('busca por tenantId + cnpj + tipo + status ATIVO', async () => {
    mockDb.credencial.findFirst.mockResolvedValueOnce({ id: 'c1', tipo: 'ECAC' })

    const svc = new CredentialService()
    const result = await svc.findByTipo(TENANT_ID, CNPJ, 'ECAC')

    const { where } = mockDb.credencial.findFirst.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.cnpj).toBe(CNPJ)
    expect(where.status).toBe('ATIVO')
    expect(result?.tipo).toBe('ECAC')
  })

  it('retorna null quando nenhuma credencial do tipo encontrada', async () => {
    mockDb.credencial.findFirst.mockResolvedValueOnce(null)

    const svc = new CredentialService()
    const result = await svc.findByTipo(TENANT_ID, CNPJ, 'SIMPLES_NACIONAL')

    expect(result).toBeNull()
  })
})
