/**
 * Testes unitários — ConciliationService
 *
 * Cobre:
 *  - conciliarNFSeEmitidas(): sem documentos → array vazio
 *  - conciliarNFSeEmitidas(): retorna CONCILIADA para cada doc (NFSeEmitidaReconciler score=100)
 *  - conciliarNFSeEmitidas(): persiste status CONCILIADO via update
 *  - conciliarNFSeEmitidas(): registra auditoria CONCILIADA_AUTOMATICO
 *  - conciliarNFSeEmitidas(): filtra por tenantId, empresaId e tipo NFSE_EMITIDA
 *  - conciliarNFSeEmitidas(): múltiplos docs → todos resultados retornados
 *  - conciliarNFCe(): sem documentos → array vazio
 *  - conciliarNFCe(): retorna CONCILIADA para cada doc
 *  - conciliarNFCe(): atualiza status de todos os docs para CONCILIADO via updateMany
 *  - conciliarNFCe(): filtra por tenantId, empresaId e tipo NFCE
 *  - conciliarNFCe(): múltiplos docs → cada um retorna resultado com score 100
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDocumentoFiscal = {
  findMany: vi.fn().mockResolvedValue([]),
  findFirst: vi.fn().mockResolvedValue(null),
  update: vi.fn().mockResolvedValue({}),
  updateMany: vi.fn().mockResolvedValue({ count: 0 }),
}

const mockEmpresaCliente = {
  findUnique: vi.fn().mockResolvedValue({ cnpj: '11111111000191' }),
}

const mockAlerta = {
  createMany: vi.fn().mockResolvedValue({ count: 0 }),
}

const mockAuditRegistrar = vi.fn().mockResolvedValue(undefined)

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => ({
    documentoFiscal: mockDocumentoFiscal,
    empresaCliente: mockEmpresaCliente,
    alerta: mockAlerta,
  })),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => ({
    registrar: mockAuditRegistrar,
  })),
}))

import { ConciliationService } from '../conciliation.service.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = 'tenant-test'
const EMPRESA = 'empresa-test'
const COMPETENCIA = '2025-05'

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: `doc-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: TENANT,
    empresaId: EMPRESA,
    tipo: 'NFSE_EMITIDA',
    numero: '000001',
    cnpjEmitente: '11111111000191',
    dataCompetencia: new Date('2025-05-01'),
    valorTotal: new Decimal('2000.00'),
    status: 'NORMALIZADO',
    ...overrides,
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEmpresaCliente.findUnique.mockResolvedValue({ cnpj: '11111111000191' })
  mockDocumentoFiscal.update.mockResolvedValue({})
  mockDocumentoFiscal.updateMany.mockResolvedValue({ count: 0 })
})

// ===========================================================================
// conciliarNFSeEmitidas
// ===========================================================================

describe('ConciliationService.conciliarNFSeEmitidas()', () => {
  it('sem documentos no período → retorna array vazio', async () => {
    mockDocumentoFiscal.findMany.mockResolvedValueOnce([])

    const svc = new ConciliationService()
    const result = await svc.conciliarNFSeEmitidas(TENANT, EMPRESA, COMPETENCIA)

    expect(result).toHaveLength(0)
  })

  it('busca documentos com tenantId, empresaId e tipo NFSE_EMITIDA corretos', async () => {
    mockDocumentoFiscal.findMany.mockResolvedValueOnce([])

    const svc = new ConciliationService()
    await svc.conciliarNFSeEmitidas(TENANT, EMPRESA, COMPETENCIA)

    const { where } = mockDocumentoFiscal.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT)
    expect(where.empresaId).toBe(EMPRESA)
    expect(where.tipo).toBe('NFSE_EMITIDA')
  })

  it('um documento válido → retorna resultado com status CONCILIADA', async () => {
    const doc = makeDoc({ id: 'emitida-001' })
    mockDocumentoFiscal.findMany.mockResolvedValueOnce([doc])

    const svc = new ConciliationService()
    const result = await svc.conciliarNFSeEmitidas(TENANT, EMPRESA, COMPETENCIA)

    expect(result).toHaveLength(1)
    expect(result[0]!.status).toBe('CONCILIADA')
    expect(result[0]!.documentoId).toBe('emitida-001')
  })

  it('doc conciliado → chama db.documentoFiscal.update para persistir status CONCILIADO', async () => {
    const doc = makeDoc({ id: 'emitida-002' })
    mockDocumentoFiscal.findMany.mockResolvedValueOnce([doc])

    const svc = new ConciliationService()
    await svc.conciliarNFSeEmitidas(TENANT, EMPRESA, COMPETENCIA)

    expect(mockDocumentoFiscal.update).toHaveBeenCalledOnce()
    const [updateArgs] = mockDocumentoFiscal.update.mock.calls
    expect(updateArgs[0].where.id).toBe('emitida-002')
    expect(updateArgs[0].data.status).toBe('CONCILIADO')
  })

  it('doc conciliado → registra auditoria CONCILIADA_AUTOMATICO', async () => {
    const doc = makeDoc({ id: 'emitida-003' })
    mockDocumentoFiscal.findMany.mockResolvedValueOnce([doc])

    const svc = new ConciliationService()
    await svc.conciliarNFSeEmitidas(TENANT, EMPRESA, COMPETENCIA)

    expect(mockAuditRegistrar).toHaveBeenCalledOnce()
    const [auditArgs] = mockAuditRegistrar.mock.calls
    expect(auditArgs[0].evento).toBe('CONCILIADA_AUTOMATICO')
    expect(auditArgs[0].entidadeId).toBe('emitida-003')
  })

  it('múltiplos docs → retorna resultado para cada um', async () => {
    const docs = [makeDoc({ id: 'em-1' }), makeDoc({ id: 'em-2' }), makeDoc({ id: 'em-3' })]
    mockDocumentoFiscal.findMany.mockResolvedValueOnce(docs)

    const svc = new ConciliationService()
    const result = await svc.conciliarNFSeEmitidas(TENANT, EMPRESA, COMPETENCIA)

    expect(result).toHaveLength(3)
    expect(result.every((r) => r.status === 'CONCILIADA')).toBe(true)
  })

  it('score 100 → sem alertas criados', async () => {
    const doc = makeDoc({ id: 'emitida-no-alert' })
    mockDocumentoFiscal.findMany.mockResolvedValueOnce([doc])

    const svc = new ConciliationService()
    await svc.conciliarNFSeEmitidas(TENANT, EMPRESA, COMPETENCIA)

    expect(mockAlerta.createMany).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// conciliarNFCe
// ===========================================================================

describe('ConciliationService.conciliarNFCe()', () => {
  it('sem documentos no período → retorna array vazio', async () => {
    mockDocumentoFiscal.findMany.mockResolvedValueOnce([])

    const svc = new ConciliationService()
    const result = await svc.conciliarNFCe(TENANT, EMPRESA, COMPETENCIA)

    expect(result).toHaveLength(0)
  })

  it('busca documentos com tenantId, empresaId e tipo NFCE corretos', async () => {
    mockDocumentoFiscal.findMany.mockResolvedValueOnce([])

    const svc = new ConciliationService()
    await svc.conciliarNFCe(TENANT, EMPRESA, COMPETENCIA)

    const { where } = mockDocumentoFiscal.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT)
    expect(where.empresaId).toBe(EMPRESA)
    expect(where.tipo).toBe('NFCE')
  })

  it('um documento NFCE → retorna resultado com status CONCILIADA e score 100', async () => {
    const doc = makeDoc({ id: 'nfce-001', tipo: 'NFCE' })
    mockDocumentoFiscal.findMany.mockResolvedValueOnce([doc])

    const svc = new ConciliationService()
    const result = await svc.conciliarNFCe(TENANT, EMPRESA, COMPETENCIA)

    expect(result).toHaveLength(1)
    expect(result[0]!.status).toBe('CONCILIADA')
    expect(result[0]!.score).toBe(100)
    expect(result[0]!.documentoId).toBe('nfce-001')
  })

  it('docs encontrados → chama updateMany para setar status CONCILIADO', async () => {
    const doc = makeDoc({ id: 'nfce-002', tipo: 'NFCE' })
    mockDocumentoFiscal.findMany.mockResolvedValueOnce([doc])

    const svc = new ConciliationService()
    await svc.conciliarNFCe(TENANT, EMPRESA, COMPETENCIA)

    expect(mockDocumentoFiscal.updateMany).toHaveBeenCalledOnce()
    const [args] = mockDocumentoFiscal.updateMany.mock.calls
    expect(args[0].where.id.in).toContain('nfce-002')
    expect(args[0].data.status).toBe('CONCILIADO')
  })

  it('sem documentos → não chama updateMany', async () => {
    mockDocumentoFiscal.findMany.mockResolvedValueOnce([])

    const svc = new ConciliationService()
    await svc.conciliarNFCe(TENANT, EMPRESA, COMPETENCIA)

    expect(mockDocumentoFiscal.updateMany).not.toHaveBeenCalled()
  })

  it('múltiplos docs NFCE → retorna resultado com score 100 para cada um', async () => {
    const docs = [
      makeDoc({ id: 'nfce-a', tipo: 'NFCE' }),
      makeDoc({ id: 'nfce-b', tipo: 'NFCE' }),
      makeDoc({ id: 'nfce-c', tipo: 'NFCE' }),
    ]
    mockDocumentoFiscal.findMany.mockResolvedValueOnce(docs)

    const svc = new ConciliationService()
    const result = await svc.conciliarNFCe(TENANT, EMPRESA, COMPETENCIA)

    expect(result).toHaveLength(3)
    expect(result.every((r) => r.score === 100)).toBe(true)
    const ids = result.map((r) => r.documentoId)
    expect(ids).toContain('nfce-a')
    expect(ids).toContain('nfce-b')
    expect(ids).toContain('nfce-c')
  })

  it('updateMany recebe todos os IDs dos docs encontrados', async () => {
    const docs = [makeDoc({ id: 'nfce-x', tipo: 'NFCE' }), makeDoc({ id: 'nfce-y', tipo: 'NFCE' })]
    mockDocumentoFiscal.findMany.mockResolvedValueOnce(docs)

    const svc = new ConciliationService()
    await svc.conciliarNFCe(TENANT, EMPRESA, COMPETENCIA)

    const [args] = mockDocumentoFiscal.updateMany.mock.calls
    expect(args[0].where.id.in).toContain('nfce-x')
    expect(args[0].where.id.in).toContain('nfce-y')
  })
})
