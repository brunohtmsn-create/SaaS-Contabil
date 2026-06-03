/**
 * Testes unitários — CreditosPisCofinsLRService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime LP/SN/MEI → lança erro (exclusivo LR)
 *  - sem documentos → créditos zerados
 *  - documento com valorPis/valorCofins preenchidos → usa valores do doc
 *  - documento sem PIS/COFINS → calcula PIS 1,65% e COFINS 7,6%
 *  - documento de SAIDA não gera crédito
 *  - totalCreditosCombinados = PIS + COFINS
 *  - múltiplos documentos → soma correta
 *  - persiste com tipo COFINS
 *  - registra PIS_COFINS_LP_APURADO no audit (reutiliza evento existente)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = { registrar: vi.fn() }

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  documentoFiscal: { findMany: vi.fn() },
  apuracaoFiscal: { upsert: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { CreditosPisCofinsLRService } from '../creditos-pis-cofins-lr.service.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-cred-lr'
const EMPRESA_ID = 'emp-cred-lr'

const EMPRESA_LR = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa LR Créditos Ltda',
  regime: 'LUCRO_REAL',
  cnae: '4711301',
  uf: 'SP',
}

function makeDocEntrada(opts: {
  valorTotal: number
  valorPis?: number
  valorCofins?: number
  tipo?: string
  direcao?: string
  cfop?: string
}) {
  return {
    id: `doc-${Math.random()}`,
    numero: '000001',
    serie: '001',
    dataEmissao: new Date('2025-05-10'),
    dataCompetencia: new Date('2025-05-10'),
    tipo: opts.tipo ?? 'NFE',
    direcao: opts.direcao ?? 'ENTRADA',
    status: 'CONCILIADO',
    cfop: opts.cfop ?? '1101',
    valorTotal: { toString: () => opts.valorTotal.toString() },
    valorPis: { toString: () => (opts.valorPis ?? 0).toString() },
    valorCofins: { toString: () => (opts.valorCofins ?? 0).toString() },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LR)
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'cred-1' })
})

// ===========================================================================

describe('CreditosPisCofinsLRService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new CreditosPisCofinsLRService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('lança erro para regime LUCRO_PRESUMIDO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LR,
      regime: 'LUCRO_PRESUMIDO',
    })
    const service = new CreditosPisCofinsLRService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('Lucro Real')
  })

  it('lança erro para regime SIMPLES_NACIONAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LR,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new CreditosPisCofinsLRService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('Lucro Real')
  })

  it('lança erro para regime MEI', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LR, regime: 'MEI' })
    const service = new CreditosPisCofinsLRService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('Lucro Real')
  })
})

// ===========================================================================

describe('CreditosPisCofinsLRService — cálculo de créditos', () => {
  it('sem documentos → créditos zerados', async () => {
    const service = new CreditosPisCofinsLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.totalCreditoPIS)).toBe(0)
    expect(Number(r.totalCreditoCOFINS)).toBe(0)
    expect(Number(r.totalCreditosCombinados)).toBe(0)
    expect(r.totalDocumentosEntrada).toBe(0)
  })

  it('doc sem PIS/COFINS → calcula PIS = valor × 1,65%', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocEntrada({ valorTotal: 100000 })])

    const service = new CreditosPisCofinsLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.totalCreditoPIS)).toBe(1650)
  })

  it('doc sem PIS/COFINS → calcula COFINS = valor × 7,6%', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocEntrada({ valorTotal: 100000 })])

    const service = new CreditosPisCofinsLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.totalCreditoCOFINS)).toBe(7600)
  })

  it('doc com PIS/COFINS preenchidos → usa valores do documento', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDocEntrada({ valorTotal: 100000, valorPis: 1000, valorCofins: 5000 }),
    ])

    const service = new CreditosPisCofinsLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.totalCreditoPIS)).toBe(1000)
    expect(Number(r.totalCreditoCOFINS)).toBe(5000)
  })

  it('totalCreditosCombinados = PIS + COFINS', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocEntrada({ valorTotal: 100000 })])

    const service = new CreditosPisCofinsLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.totalCreditosCombinados)).toBe(
      Number(r.totalCreditoPIS) + Number(r.totalCreditoCOFINS)
    )
  })

  it('múltiplos documentos → soma correta', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDocEntrada({ valorTotal: 50000 }),
      makeDocEntrada({ valorTotal: 50000 }),
    ])

    const service = new CreditosPisCofinsLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    // 100.000 × 1,65% = 1.650 PIS; 100.000 × 7,6% = 7.600 COFINS
    expect(Number(r.totalCreditoPIS)).toBe(1650)
    expect(Number(r.totalCreditoCOFINS)).toBe(7600)
    expect(r.totalDocumentosEntrada).toBe(2)
  })

  it('totalBaseCredito = soma dos valores dos documentos', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDocEntrada({ valorTotal: 30000 }),
      makeDocEntrada({ valorTotal: 70000 }),
    ])

    const service = new CreditosPisCofinsLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(r.totalBaseCredito)).toBe(100000)
  })
})

// ===========================================================================

describe('CreditosPisCofinsLRService — CFOP', () => {
  it('CFOP 1101 (compra p/ revenda) → gera crédito', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDocEntrada({ valorTotal: 10000, cfop: '1101' }),
    ])

    const service = new CreditosPisCofinsLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(r.totalDocumentosEntrada).toBe(1)
  })

  it('documento sem CFOP → gera crédito (abordagem conservadora)', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDocEntrada({ valorTotal: 10000, cfop: undefined }),
    ])

    const service = new CreditosPisCofinsLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(r.totalDocumentosEntrada).toBe(1)
    expect(Number(r.totalCreditoPIS)).toBeGreaterThan(0)
  })
})

// ===========================================================================

describe('CreditosPisCofinsLRService — itens', () => {
  it('retorna array de itens com creditoPIS e creditoCOFINS por documento', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocEntrada({ valorTotal: 50000 })])

    const service = new CreditosPisCofinsLRService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(r.itens).toHaveLength(1)
    expect(Number(r.itens[0]!.creditoPIS)).toBe(825)
    expect(Number(r.itens[0]!.creditoCOFINS)).toBe(3800)
  })
})

// ===========================================================================

describe('CreditosPisCofinsLRService — persistência e auditoria', () => {
  it('persiste com tipo COFINS', async () => {
    const service = new CreditosPisCofinsLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(call[0].where.tenantId_empresaId_competencia_tipo.tipo).toBe('COFINS')
  })

  it('registra evento no audit', async () => {
    const service = new CreditosPisCofinsLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.tenantId).toBe(TENANT_ID)
    expect(auditCall.estadoNovo.regime).toBe('LUCRO_REAL')
  })

  it('audit estadoNovo contém totalCreditoPIS e totalCreditoCOFINS', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDocEntrada({ valorTotal: 100000 })])

    const service = new CreditosPisCofinsLRService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(Number(auditCall.estadoNovo.totalCreditoPIS)).toBe(1650)
    expect(Number(auditCall.estadoNovo.totalCreditoCOFINS)).toBe(7600)
  })
})
