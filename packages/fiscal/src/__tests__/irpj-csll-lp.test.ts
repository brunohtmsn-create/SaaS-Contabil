/**
 * Testes unitários — IrpjCsllLPService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime não LP → lança erro
 *  - apura IRPJ + CSLL com percentuais corretos por categoria
 *  - IRPJ adicional (10%) sobre base que excede R$60.000/trimestre
 *  - IRPJ sem adicional quando base ≤ R$60.000
 *  - competência mapeada para trimestre correto (T1-T4)
 *  - persiste IRPJ_LP e CSLL_LP no banco
 *  - registra IRPJ_CSLL_LP_APURADO no audit
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

import { IrpjCsllLPService } from '../irpj-csll-lp.service.js'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-irpj'
const EMPRESA_ID = 'emp-irpj'

const EMPRESA_SERVICOS = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Consultoria LP Ltda',
  regime: 'LUCRO_PRESUMIDO',
  cnae: '6920601',
}

const EMPRESA_COMERCIO = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Comércio LP Ltda',
  regime: 'LUCRO_PRESUMIDO',
  cnae: '4711302',
}

function makeDocs(valores: number[]) {
  return valores.map((v, i) => ({
    id: `doc-${i}`,
    valorTotal: { toString: () => v.toString() },
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_SERVICOS)
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'ap-1' })
})

// ===========================================================================

describe('IrpjCsllLPService — validações iniciais', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new IrpjCsllLPService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('lança erro quando regime não é Lucro Presumido', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_SERVICOS,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new IrpjCsllLPService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')).rejects.toThrow(
      'não é Lucro Presumido'
    )
  })

  it('LUCRO_REAL → rejeita', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_SERVICOS,
      regime: 'LUCRO_REAL',
    })
    const service = new IrpjCsllLPService()
    await expect(service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')).rejects.toThrow(
      'não é Lucro Presumido'
    )
  })
})

// ===========================================================================

describe('IrpjCsllLPService — mapeamento de trimestres', () => {
  it('competência janeiro (mes 01) → T1', async () => {
    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')
    expect(resultado.trimestreLabel).toBe('2025-T1')
  })

  it('competência março (mes 03) → T1', async () => {
    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-03')
    expect(resultado.trimestreLabel).toBe('2025-T1')
  })

  it('competência abril (mes 04) → T2', async () => {
    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-04')
    expect(resultado.trimestreLabel).toBe('2025-T2')
  })

  it('competência junho (mes 06) → T2', async () => {
    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-06')
    expect(resultado.trimestreLabel).toBe('2025-T2')
  })

  it('competência julho (mes 07) → T3', async () => {
    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-07')
    expect(resultado.trimestreLabel).toBe('2025-T3')
  })

  it('competência outubro (mes 10) → T4', async () => {
    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-10')
    expect(resultado.trimestreLabel).toBe('2025-T4')
  })

  it('competência dezembro (mes 12) → T4', async () => {
    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12')
    expect(resultado.trimestreLabel).toBe('2025-T4')
  })
})

// ===========================================================================

describe('IrpjCsllLPService — percentuais de presunção por atividade', () => {
  it('serviços gerais: IRPJ 32%, CSLL 32%', async () => {
    // CNAE 6920601 = atividades de contabilidade → serviços
    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')
    expect(resultado.percentualPresuncaoIRPJ).toBe(32)
    expect(resultado.percentualPresuncaoCSLL).toBe(32)
  })

  it('comércio: IRPJ 8%, CSLL 12%', async () => {
    // CNAE 4711302 = supermercados → comércio
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA_COMERCIO)
    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')
    expect(resultado.percentualPresuncaoIRPJ).toBe(8)
    expect(resultado.percentualPresuncaoCSLL).toBe(12)
  })
})

// ===========================================================================

describe('IrpjCsllLPService — cálculo IRPJ sem adicional', () => {
  it('base IRPJ ≤ R$60.000 → sem adicional, irpjAdicional = 0', async () => {
    // Receita bruta 100.000, presunção 32% → base = 32.000 → IRPJ normal 4.800, adicional 0
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(makeDocs([100000]))

    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')

    expect(Number(resultado.receitaBrutaTrimestral)).toBe(100000)
    expect(Number(resultado.baseCalculoIRPJ)).toBe(32000)
    expect(Number(resultado.irpjNormal)).toBe(4800)
    expect(resultado.irpjAdicional.toString()).toBe('0')
    expect(Number(resultado.irpjTotal)).toBe(4800)
  })

  it('receita zero → todos valores zerados', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')

    expect(resultado.receitaBrutaTrimestral.toString()).toBe('0')
    expect(resultado.irpjTotal.toString()).toBe('0')
    expect(resultado.csllTotal.toString()).toBe('0')
    expect(resultado.totalDevido.toString()).toBe('0')
  })
})

// ===========================================================================

describe('IrpjCsllLPService — cálculo IRPJ com adicional', () => {
  it('base IRPJ > R$60.000 → adicional de 10% sobre o excedente', async () => {
    // Receita bruta 300.000 (serviços), presunção 32% → base = 96.000
    // IRPJ normal: 96.000 × 15% = 14.400
    // Adicional: (96.000 - 60.000) × 10% = 36.000 × 10% = 3.600
    // IRPJ total: 18.000
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(makeDocs([300000]))

    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')

    expect(Number(resultado.baseCalculoIRPJ)).toBe(96000)
    expect(Number(resultado.irpjNormal)).toBe(14400)
    expect(Number(resultado.irpjAdicional)).toBe(3600)
    expect(Number(resultado.irpjTotal)).toBe(18000)
  })

  it('CSLL calculada separadamente, não afetada pelo adicional IRPJ', async () => {
    // Receita bruta 300.000, presunção CSLL 32% → base = 96.000 × 9% = 8.640
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(makeDocs([300000]))

    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')

    expect(Number(resultado.baseCalculoCSLL)).toBe(96000)
    expect(Number(resultado.csllTotal)).toBe(8640)
  })

  it('totalDevido = irpjTotal + csllTotal', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(makeDocs([300000]))

    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')

    const esperado = new Decimal(resultado.irpjTotal).plus(resultado.csllTotal)
    expect(resultado.totalDevido.toString()).toBe(esperado.toString())
  })

  it('múltiplos documentos somados corretamente', async () => {
    // 3 documentos: 50.000 + 100.000 + 150.000 = 300.000
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(makeDocs([50000, 100000, 150000]))

    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')

    expect(resultado.receitaBrutaTrimestral.toString()).toBe('300000')
  })
})

// ===========================================================================

describe('IrpjCsllLPService — persistência', () => {
  it('persiste apuração IRPJ_LP no banco', async () => {
    const service = new IrpjCsllLPService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')

    const irpjUpsert = mockDb.apuracaoFiscal.upsert.mock.calls.find(
      (c: any) => c[0].where.tenantId_empresaId_competencia_tipo.tipo === 'IRPJ_LP'
    )
    expect(irpjUpsert).toBeDefined()
    expect(irpjUpsert![0].create.tenantId).toBe(TENANT_ID)
    expect(irpjUpsert![0].create.empresaId).toBe(EMPRESA_ID)
    expect(irpjUpsert![0].create.competencia).toBe('2025-T1')
    expect(irpjUpsert![0].create.status).toBe('CALCULADO')
  })

  it('persiste apuração CSLL_LP no banco', async () => {
    const service = new IrpjCsllLPService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')

    const csllUpsert = mockDb.apuracaoFiscal.upsert.mock.calls.find(
      (c: any) => c[0].where.tenantId_empresaId_competencia_tipo.tipo === 'CSLL_LP'
    )
    expect(csllUpsert).toBeDefined()
    expect(csllUpsert![0].create.competencia).toBe('2025-T1')
  })

  it('faz upsert com tenantId e empresaId corretos no where', async () => {
    const service = new IrpjCsllLPService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-07')

    for (const call of mockDb.apuracaoFiscal.upsert.mock.calls) {
      const where = call[0].where.tenantId_empresaId_competencia_tipo
      expect(where.tenantId).toBe(TENANT_ID)
      expect(where.empresaId).toBe(EMPRESA_ID)
      expect(where.competencia).toBe('2025-T3')
    }
  })

  it('busca documentos somente CONCILIADOS do trimestre correto', async () => {
    const service = new IrpjCsllLPService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-04')

    const findWhere = mockDb.documentoFiscal.findMany.mock.calls[0][0].where
    expect(findWhere.tenantId).toBe(TENANT_ID)
    expect(findWhere.empresaId).toBe(EMPRESA_ID)
    expect(findWhere.status).toBe('CONCILIADO')
    // T2: abril a junho
    expect(findWhere.dataCompetencia.gte.getMonth()).toBe(3) // abril = 3
    expect(findWhere.dataCompetencia.lte.getMonth()).toBe(5) // junho = 5
  })
})

// ===========================================================================

describe('IrpjCsllLPService — auditoria', () => {
  it('registra IRPJ_CSLL_LP_APURADO no audit', async () => {
    const service = new IrpjCsllLPService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('IRPJ_CSLL_LP_APURADO')
    expect(auditCall.tenantId).toBe(TENANT_ID)
    expect(auditCall.entidadeId).toBe(EMPRESA_ID)
  })

  it('audit estadoNovo contém valores calculados', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce(makeDocs([300000]))
    const service = new IrpjCsllLPService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-01')

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.estadoNovo.trimestreLabel).toBe('2025-T1')
    expect(Number(auditCall.estadoNovo.irpjTotal)).toBe(18000)
    expect(Number(auditCall.estadoNovo.csllTotal)).toBe(8640)
  })
})
