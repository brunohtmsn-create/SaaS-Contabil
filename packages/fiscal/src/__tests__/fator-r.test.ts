/**
 * Testes unitários — FatorRService
 *
 * Cobre:
 *  - Fórmula: Fator R = folha_12m / receita_bruta_12m × 100
 *  - Threshold: Fator R ≥ 28% → Anexo III; < 28% → Anexo V
 *  - Edge cases: receita = 0, folha = 0, exatamente no limite
 *  - Alíquotas efetivas por faixa de RBT12 (Anexo III e V)
 *  - Recomendação de planejamento tributário
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Singleton de mock do DB — sempre retorna o mesmo objeto
// ---------------------------------------------------------------------------

const mockEmpresa = {
  id: 'emp-1',
  cnpj: '12345678000195',
  razaoSocial: 'Empresa Teste Ltda',
  regime: 'SIMPLES_NACIONAL',
}

const mockDb = {
  empresaCliente: {
    findFirst: vi.fn().mockResolvedValue(mockEmpresa),
  },
  documentoFiscal: {
    aggregate: vi.fn(),
  },
  lancamentoContabil: {
    findMany: vi.fn(),
  },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { FatorRService } from '../fator-r.service.js'

// ---------------------------------------------------------------------------
// Reset dos mocks entre testes
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findFirst.mockResolvedValue(mockEmpresa)
  mockDb.documentoFiscal.aggregate.mockResolvedValue({ _sum: { valorTotal: null } })
  mockDb.lancamentoContabil.findMany.mockResolvedValue([])
})

// ---------------------------------------------------------------------------
// Helper: calcula o Fator R de forma pura (sem DB)
// ---------------------------------------------------------------------------

function calcularFatorRPuro(
  folha12m: Decimal,
  receitaBruta12m: Decimal
): { fatorR: Decimal; anexo: 'III' | 'V' } {
  const fatorR = receitaBruta12m.gt(0) ? folha12m.div(receitaBruta12m).times(100) : new Decimal(0)
  const anexo: 'III' | 'V' = fatorR.gte(28) ? 'III' : 'V'
  return { fatorR, anexo }
}

// ---------------------------------------------------------------------------
// Testes da fórmula pura
// ---------------------------------------------------------------------------

describe('FatorR — fórmula pura (folha / receita_bruta × 100)', () => {
  it('folha R$280k / RB R$1M → Fator R = 28%', () => {
    const { fatorR } = calcularFatorRPuro(new Decimal(280000), new Decimal(1000000))
    expect(fatorR.toFixed(2)).toBe('28.00')
  })

  it('folha R$280k / RB R$1M → Anexo III (fatorR ≥ 28)', () => {
    const { anexo } = calcularFatorRPuro(new Decimal(280000), new Decimal(1000000))
    expect(anexo).toBe('III')
  })

  it('folha R$270k / RB R$1M → Fator R = 27%', () => {
    const { fatorR } = calcularFatorRPuro(new Decimal(270000), new Decimal(1000000))
    expect(fatorR.toFixed(2)).toBe('27.00')
  })

  it('folha R$270k / RB R$1M → Anexo V (fatorR < 28)', () => {
    const { anexo } = calcularFatorRPuro(new Decimal(270000), new Decimal(1000000))
    expect(anexo).toBe('V')
  })

  it('folha R$0 / RB R$1M → Fator R = 0%', () => {
    const { fatorR } = calcularFatorRPuro(new Decimal(0), new Decimal(1000000))
    expect(fatorR.toFixed(2)).toBe('0.00')
  })

  it('folha R$0 / RB R$1M → Anexo V', () => {
    const { anexo } = calcularFatorRPuro(new Decimal(0), new Decimal(1000000))
    expect(anexo).toBe('V')
  })

  it('receita = 0 → Fator R = 0 (evita divisão por zero)', () => {
    const { fatorR } = calcularFatorRPuro(new Decimal(100000), new Decimal(0))
    expect(fatorR.toFixed(2)).toBe('0.00')
  })

  it('receita = 0 → Anexo V por padrão', () => {
    const { anexo } = calcularFatorRPuro(new Decimal(100000), new Decimal(0))
    expect(anexo).toBe('V')
  })

  it('Fator R exatamente 28% → Anexo III (limite inclusivo)', () => {
    const { fatorR, anexo } = calcularFatorRPuro(new Decimal(28), new Decimal(100))
    expect(fatorR.toFixed(2)).toBe('28.00')
    expect(anexo).toBe('III')
  })

  it('Fator R 27.99% → Anexo V (abaixo do limiar)', () => {
    const { fatorR, anexo } = calcularFatorRPuro(new Decimal(2799), new Decimal(10000))
    expect(fatorR.toFixed(2)).toBe('27.99')
    expect(anexo).toBe('V')
  })

  it('Fator R 28.01% → Anexo III (acima do limiar)', () => {
    const { fatorR, anexo } = calcularFatorRPuro(new Decimal(2801), new Decimal(10000))
    expect(fatorR.toFixed(2)).toBe('28.01')
    expect(anexo).toBe('III')
  })

  it('Fator R 50% → Anexo III', () => {
    const { fatorR, anexo } = calcularFatorRPuro(new Decimal(500000), new Decimal(1000000))
    expect(fatorR.toFixed(2)).toBe('50.00')
    expect(anexo).toBe('III')
  })

  it('Valores decimais: folha R$123.456,78 / RB R$500.000 ≈ 24.69%', () => {
    const folha = new Decimal('123456.78')
    const rb = new Decimal('500000')
    const { fatorR, anexo } = calcularFatorRPuro(folha, rb)
    expect(fatorR.toDecimalPlaces(2).toFixed(2)).toBe('24.69')
    expect(anexo).toBe('V')
  })
})

// ---------------------------------------------------------------------------
// Testes via FatorRService com mock do DB
// ---------------------------------------------------------------------------

describe('FatorRService — calcular() com mock do DB', () => {
  it('RB 12m = R$1M, sem lancamentos de folha → Fator R = 0%', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: '1000000' },
    })

    const service = new FatorRService()
    const resultado = await service.calcular('tenant-1', 'emp-1', '2025-01')

    expect(resultado.fatorR).toBe('0.00')
    expect(resultado.anexo).toBe('V')
  })

  it('RB 12m = R$1M, folha R$280k via lancamentos → Fator R = 28%, Anexo III', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: '1000000' },
    })
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      { partidas: [{ conta: '6.1.1', valor: '280000', tipo: 'DEBITO' }] },
    ])

    const service = new FatorRService()
    const resultado = await service.calcular('tenant-1', 'emp-1', '2025-01')

    expect(resultado.fatorR).toBe('28.00')
    expect(resultado.anexo).toBe('III')
  })

  it('RB 12m = null (sem documentos) → Fator R = 0%', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: null },
    })

    const service = new FatorRService()
    const resultado = await service.calcular('tenant-1', 'emp-2', '2025-01')

    expect(resultado.fatorR).toBe('0.00')
    expect(resultado.anexo).toBe('V')
  })

  it('calcular() retorna cnpj e razaoSocial da empresa', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: '500000' },
    })

    const service = new FatorRService()
    const resultado = await service.calcular('tenant-1', 'emp-1', '2025-01')

    expect(resultado.cnpj).toBe('12345678000195')
    expect(resultado.razaoSocial).toBe('Empresa Teste Ltda')
  })

  it('calcular() retorna folha12meses e receita12meses como strings', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: '1000000' },
    })
    mockDb.lancamentoContabil.findMany.mockResolvedValueOnce([
      { partidas: [{ conta: '6.1.1', valor: '280000', tipo: 'DEBITO' }] },
    ])

    const service = new FatorRService()
    const resultado = await service.calcular('tenant-1', 'emp-1', '2025-01')

    expect(resultado.receita12meses).toBe('1000000.00')
    expect(resultado.folha12meses).toBe('280000.00')
  })

  it('calcular() retorna aliquotaAnexoIII e aliquotaAnexoV não-zero para RBT12 > 0', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: '500000' },
    })

    const service = new FatorRService()
    const resultado = await service.calcular('tenant-1', 'emp-1', '2025-01')

    expect(parseFloat(resultado.aliquotaAnexoIII)).toBeGreaterThan(0)
    expect(parseFloat(resultado.aliquotaAnexoV)).toBeGreaterThan(0)
    // Anexo III sempre menor ou igual ao Anexo V
    expect(parseFloat(resultado.aliquotaAnexoIII)).toBeLessThanOrEqual(
      parseFloat(resultado.aliquotaAnexoV)
    )
  })

  it('calcular() retorna recomendacao não vazia', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: '500000' },
    })

    const service = new FatorRService()
    const resultado = await service.calcular('tenant-1', 'emp-1', '2025-01')

    expect(resultado.recomendacao.length).toBeGreaterThan(10)
  })

  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findFirst.mockResolvedValueOnce(null)

    const service = new FatorRService()
    await expect(service.calcular('tenant-1', 'emp-inexistente', '2025-01')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('calcular() chama aggregate uma vez e agrega valorTotal', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: '500000' },
    })

    const service = new FatorRService()
    await service.calcular('tenant-1', 'emp-3', '2025-01')

    expect(mockDb.documentoFiscal.aggregate).toHaveBeenCalledTimes(1)
    const callArgs = mockDb.documentoFiscal.aggregate.mock.calls[0][0]
    expect(callArgs._sum.valorTotal).toBe(true)
  })

  it('calcular() filtra por tenantId e empresaId corretos', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: '200000' },
    })

    const service = new FatorRService()
    await service.calcular('tenant-abc', 'emp-xyz', '2025-01')

    const callArgs = mockDb.documentoFiscal.aggregate.mock.calls[0][0]
    expect(callArgs.where.tenantId).toBe('tenant-abc')
    expect(callArgs.where.empresaId).toBe('emp-xyz')
  })

  it('calcular() filtra apenas documentos com status CONCILIADO', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: '200000' },
    })

    const service = new FatorRService()
    await service.calcular('tenant-1', 'emp-4', '2025-01')

    const callArgs = mockDb.documentoFiscal.aggregate.mock.calls[0][0]
    expect(callArgs.where.status).toBe('CONCILIADO')
  })

  it('calcular() filtra apenas saídas e prestações de serviço', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: '200000' },
    })

    const service = new FatorRService()
    await service.calcular('tenant-1', 'emp-5', '2025-01')

    const callArgs = mockDb.documentoFiscal.aggregate.mock.calls[0][0]
    expect(callArgs.where.direcao).toEqual({ in: ['SAIDA', 'PRESTACAO'] })
    expect(callArgs.where.tipo).toEqual({ in: ['NFE', 'NFCE', 'NFSE_EMITIDA'] })
  })
})

// ---------------------------------------------------------------------------
// Casos de negócio documentados
// ---------------------------------------------------------------------------

describe('FatorR — casos de negócio', () => {
  it('Empresa de serviços com folha alta migra para Anexo III (tributação menor)', () => {
    const folha = new Decimal(300000)
    const rb = new Decimal(1000000)
    const { fatorR, anexo } = calcularFatorRPuro(folha, rb)
    expect(fatorR.gte(28)).toBe(true)
    expect(anexo).toBe('III')
  })

  it('Empresa de serviços com folha baixa fica no Anexo V (tributação maior)', () => {
    const folha = new Decimal(200000)
    const rb = new Decimal(1000000)
    const { fatorR, anexo } = calcularFatorRPuro(folha, rb)
    expect(fatorR.lt(28)).toBe(true)
    expect(anexo).toBe('V')
  })

  it('Fator R é calculado sobre janela de 12 meses de receita bruta', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: '1200000' },
    })

    const service = new FatorRService()
    await service.calcular('tenant-1', 'emp-6', '2025-01')

    const callArgs = mockDb.documentoFiscal.aggregate.mock.calls[0][0]
    expect(callArgs.where.dataCompetencia).toBeDefined()
    expect(callArgs.where.dataCompetencia.gte).toBeInstanceOf(Date)
    expect(callArgs.where.dataCompetencia.lte).toBeInstanceOf(Date)
    const diasDiferenca = Math.floor(
      (callArgs.where.dataCompetencia.lte.getTime() -
        callArgs.where.dataCompetencia.gte.getTime()) /
        (1000 * 60 * 60 * 24)
    )
    expect(diasDiferenca).toBeGreaterThan(300)
    expect(diasDiferenca).toBeLessThan(400)
  })

  it('Anexo III alíquota menor que Anexo V nas faixas de menor receita (até R$3M)', async () => {
    // Nas primeiras 5 faixas de RBT12, o Anexo III é menos oneroso que o V
    for (const receita of ['120000', '300000', '600000', '1500000', '3000000']) {
      mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({ _sum: { valorTotal: receita } })
      const service = new FatorRService()
      const r = await service.calcular('tenant-1', 'emp-1', '2025-01')
      expect(parseFloat(r.aliquotaAnexoIII)).toBeLessThanOrEqual(parseFloat(r.aliquotaAnexoV))
    }
  })
})
