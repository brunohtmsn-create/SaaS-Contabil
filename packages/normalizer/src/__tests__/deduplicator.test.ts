/**
 * Testes unitários — DeduplicatorService
 *
 * Cobre:
 *  - isDuplicate(): retorna false quando chaveUnica não existe
 *  - isDuplicate(): retorna true quando chaveUnica já existe
 *  - isDuplicate(): filtra por tenantId (isolamento multi-tenant)
 *  - findDuplicates(): retorna array vazio quando não há duplicatas
 *  - findDuplicates(): retorna grupo com IDs duplicados
 *  - findDuplicates(): ignora documentos únicos (sem duplicata)
 *  - findDuplicates(): múltiplos grupos de duplicatas
 *  - findDuplicates(): filtra por tenantId e empresaId
 *
 * PrismaClient é mockado via vi.hoisted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    documentoFiscal: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { DeduplicatorService } from '../deduplicator.service.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-dedup'
const EMPRESA_ID = 'emp-dedup'

beforeEach(() => {
  vi.clearAllMocks()
})

// ===========================================================================
// isDuplicate
// ===========================================================================

describe('DeduplicatorService.isDuplicate()', () => {
  it('retorna false quando chaveUnica não existe', async () => {
    mockDb.documentoFiscal.findFirst.mockResolvedValueOnce(null)

    const svc = new DeduplicatorService()
    const result = await svc.isDuplicate(TENANT_ID, 'chave-unica-nova')

    expect(result).toBe(false)
  })

  it('retorna true quando chaveUnica já existe', async () => {
    mockDb.documentoFiscal.findFirst.mockResolvedValueOnce({ id: 'doc-existente' })

    const svc = new DeduplicatorService()
    const result = await svc.isDuplicate(TENANT_ID, 'chave-unica-existente')

    expect(result).toBe(true)
  })

  it('usa tenantId na query (isolamento multi-tenant)', async () => {
    mockDb.documentoFiscal.findFirst.mockResolvedValueOnce(null)

    const svc = new DeduplicatorService()
    await svc.isDuplicate(TENANT_ID, 'chave-abc')

    const { where } = mockDb.documentoFiscal.findFirst.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.chaveUnica).toBe('chave-abc')
  })

  it('seleciona apenas campo id para eficiência', async () => {
    mockDb.documentoFiscal.findFirst.mockResolvedValueOnce(null)

    const svc = new DeduplicatorService()
    await svc.isDuplicate(TENANT_ID, 'chave-eficiencia')

    const call = mockDb.documentoFiscal.findFirst.mock.calls[0][0]
    expect(call.select).toEqual({ id: true })
  })
})

// ===========================================================================
// findDuplicates
// ===========================================================================

describe('DeduplicatorService.findDuplicates()', () => {
  it('retorna array vazio quando não há duplicatas', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      { id: 'doc-1', chaveUnica: 'chave-a' },
      { id: 'doc-2', chaveUnica: 'chave-b' },
      { id: 'doc-3', chaveUnica: 'chave-c' },
    ])

    const svc = new DeduplicatorService()
    const result = await svc.findDuplicates(TENANT_ID, EMPRESA_ID)

    expect(result).toHaveLength(0)
  })

  it('retorna um grupo quando há dois documentos com a mesma chaveUnica', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      { id: 'doc-1', chaveUnica: 'chave-dup' },
      { id: 'doc-2', chaveUnica: 'chave-dup' },
    ])

    const svc = new DeduplicatorService()
    const result = await svc.findDuplicates(TENANT_ID, EMPRESA_ID)

    expect(result).toHaveLength(1)
    expect(result[0]).toContain('doc-1')
    expect(result[0]).toContain('doc-2')
  })

  it('ignora documentos sem par (único)', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      { id: 'doc-1', chaveUnica: 'chave-dup' },
      { id: 'doc-2', chaveUnica: 'chave-dup' },
      { id: 'doc-3', chaveUnica: 'chave-unica' },
    ])

    const svc = new DeduplicatorService()
    const result = await svc.findDuplicates(TENANT_ID, EMPRESA_ID)

    expect(result).toHaveLength(1)
    // O grupo não deve conter doc-3
    expect(result[0]).not.toContain('doc-3')
  })

  it('retorna múltiplos grupos quando há várias chaves duplicadas', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      { id: 'doc-1', chaveUnica: 'chave-a' },
      { id: 'doc-2', chaveUnica: 'chave-a' },
      { id: 'doc-3', chaveUnica: 'chave-b' },
      { id: 'doc-4', chaveUnica: 'chave-b' },
      { id: 'doc-5', chaveUnica: 'chave-b' },
    ])

    const svc = new DeduplicatorService()
    const result = await svc.findDuplicates(TENANT_ID, EMPRESA_ID)

    expect(result).toHaveLength(2)
    const grupoB = result.find((g) => g.length === 3)
    expect(grupoB).toBeDefined()
    expect(grupoB).toContain('doc-3')
    expect(grupoB).toContain('doc-4')
    expect(grupoB).toContain('doc-5')
  })

  it('filtra por tenantId e empresaId', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const svc = new DeduplicatorService()
    await svc.findDuplicates(TENANT_ID, EMPRESA_ID)

    const { where } = mockDb.documentoFiscal.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
  })

  it('retorna array vazio quando não há documentos', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const svc = new DeduplicatorService()
    const result = await svc.findDuplicates(TENANT_ID, EMPRESA_ID)

    expect(result).toHaveLength(0)
  })
})
