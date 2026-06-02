/**
 * Testes unitários — PisCofinsLPService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime SN → lança erro
 *  - regime LP → apura PIS (0,65%) e COFINS (3%)
 *  - regime LR → também apura
 *  - receita zero → PIS e COFINS zerados
 *  - múltiplos documentos somados corretamente
 *  - persiste PIS e COFINS no banco
 *  - registra PIS_COFINS_LP_APURADO no audit
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

import { PisCofinsLPService } from '../pis-cofins-lp.service.js'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-piscofins'
const EMPRESA_ID = 'emp-piscofins'

const EMPRESA_LP = {
  id: EMPRESA_ID,
  cnpj: '77666555000144',
  razaoSocial: 'Empresa LP PIS Ltda',
  regime: 'LUCRO_PRESUMIDO',
  cnae: '6920601',
}

function makeDocs(valores: number[]) {
  return valores.map((v, i) => ({
    id: `doc-${i}`,
    valorTotal: { toString: () => v.toString() },
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LP)
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'ap-1' })
})

// ===========================================================================

describe('PisCofinsLPService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new PisCofinsLPService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('lança erro para regime SIMPLES_NACIONAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LP,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new PisCofinsLPService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('não é LP ou LR')
  })

  it('lança erro para regime MEI', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'MEI' })
    const service = new PisCofinsLPService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('não é LP ou LR')
  })

  it('aceita regime LUCRO_REAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'LUCRO_REAL' })
    const service = new PisCofinsLPService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')).resolves.not.toThrow()
  })
})

// ===========================================================================

describe('PisCofinsLPService — cálculo', () => {
  it('receita zero → PIS e COFINS zerados', async () => {
    const service = new PisCofinsLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(resultado.pis.toString()).toBe('0')
    expect(resultado.cofins.toString()).toBe('0')
    expect(resultado.totalDevido.toString()).toBe('0')
  })

  it('PIS = receita × 0,65%', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(makeDocs([100000]))

    const service = new PisCofinsLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.pis)).toBe(650)
  })

  it('COFINS = receita × 3%', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(makeDocs([100000]))

    const service = new PisCofinsLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.cofins)).toBe(3000)
  })

  it('totalDevido = PIS + COFINS', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(makeDocs([100000]))

    const service = new PisCofinsLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.totalDevido)).toBe(3650)
  })

  it('múltiplos documentos somados: 50k + 30k + 20k = 100k', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(makeDocs([50000, 30000, 20000]))

    const service = new PisCofinsLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.receitaBruta)).toBe(100000)
    expect(Number(resultado.pis)).toBe(650)
    expect(Number(resultado.cofins)).toBe(3000)
  })

  it('base de cálculo = receita bruta (regime cumulativo sem créditos)', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(makeDocs([75000]))

    const service = new PisCofinsLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(resultado.baseCalculo.toString()).toBe(resultado.receitaBruta.toString())
  })
})

// ===========================================================================

describe('PisCofinsLPService — persistência', () => {
  it('persiste PIS no banco com tipo PIS', async () => {
    const service = new PisCofinsLPService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const pisUpsert = mockDb.apuracaoFiscal.upsert.mock.calls.find(
      (c: any) => c[0].where.tenantId_empresaId_competencia_tipo.tipo === 'PIS'
    )
    expect(pisUpsert).toBeDefined()
    expect(pisUpsert![0].create.tenantId).toBe(TENANT_ID)
    expect(pisUpsert![0].create.competencia).toBe('2025-05')
    expect(pisUpsert![0].create.status).toBe('CALCULADO')
  })

  it('persiste COFINS no banco com tipo COFINS', async () => {
    const service = new PisCofinsLPService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const cofinsUpsert = mockDb.apuracaoFiscal.upsert.mock.calls.find(
      (c: any) => c[0].where.tenantId_empresaId_competencia_tipo.tipo === 'COFINS'
    )
    expect(cofinsUpsert).toBeDefined()
    expect(cofinsUpsert![0].create.competencia).toBe('2025-05')
  })

  it('busca documentos somente CONCILIADOS', async () => {
    const service = new PisCofinsLPService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const findWhere = mockDb.documentoFiscal.findMany.mock.calls[0][0].where
    expect(findWhere.status).toBe('CONCILIADO')
    expect(findWhere.tenantId).toBe(TENANT_ID)
    expect(findWhere.empresaId).toBe(EMPRESA_ID)
  })
})

// ===========================================================================

describe('PisCofinsLPService — auditoria', () => {
  it('registra PIS_COFINS_LP_APURADO no audit', async () => {
    const service = new PisCofinsLPService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('PIS_COFINS_LP_APURADO')
    expect(auditCall.tenantId).toBe(TENANT_ID)
  })

  it('audit estadoNovo contém competencia e valores', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(makeDocs([100000]))

    const service = new PisCofinsLPService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-05')

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.estadoNovo.competencia).toBe('2025-05')
    expect(Number(auditCall.estadoNovo.pis)).toBe(650)
    expect(Number(auditCall.estadoNovo.cofins)).toBe(3000)
  })
})
