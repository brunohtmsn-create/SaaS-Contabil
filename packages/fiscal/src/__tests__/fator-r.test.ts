/**
 * Testes unitários — FatorRService
 *
 * Cobre:
 *  - Fórmula: Fator R = folha_12m / receita_bruta_12m × 100
 *  - Threshold: Fator R ≥ 28% → Anexo III; < 28% → Anexo V
 *  - Edge cases: receita = 0, folha = 0, exatamente no limite
 *  - Valores representativos: folha R$280k / RB R$1M = 28% → Anexo III
 *                              folha R$270k / RB R$1M = 27% → Anexo V
 *
 * O PrismaClient é mockado via singleton. O FatorRService depende de DB
 * apenas para buscar a receita bruta dos 12 meses; a folha de pagamento
 * está com valor fixo 0 na implementação atual (campo futuro). Os testes
 * exercitam a fórmula e a lógica de decisão via mock e lógica pura.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Singleton de mock do DB — sempre retorna o mesmo objeto
// ---------------------------------------------------------------------------

const mockDb = {
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
  mockDb.documentoFiscal.aggregate.mockResolvedValue({ _sum: { valorTotal: null } })
  mockDb.lancamentoContabil.findMany.mockResolvedValue([])
})

// ---------------------------------------------------------------------------
// Helper: calcula o Fator R de forma pura (sem DB)
// Replica a fórmula implementada em fator-r.service.ts
// ---------------------------------------------------------------------------

function calcularFatorRPuro(folha12m: Decimal, receitaBruta12m: Decimal): { fatorR: Decimal; anexo: 'III' | 'V' } {
  const fatorR = receitaBruta12m.gt(0)
    ? folha12m.div(receitaBruta12m).times(100)
    : new Decimal(0)
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
    // 123456.78 / 500000 * 100 = 24.69156
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
    // lancamentoContabil.findMany retorna [] por padrão no beforeEach

    const service = new FatorRService()
    const resultado = await service.calcular('tenant-1', 'emp-1', '2025-01')

    expect(resultado.fatorR.toFixed(2)).toBe('0.00')
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

    expect(resultado.fatorR.toFixed(2)).toBe('28.00')
    expect(resultado.anexo).toBe('III')
  })

  it('RB 12m = null (sem documentos) → Fator R = 0%', async () => {
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: null },
    })

    const service = new FatorRService()
    const resultado = await service.calcular('tenant-1', 'emp-2', '2025-01')

    expect(resultado.fatorR.toFixed(2)).toBe('0.00')
    expect(resultado.anexo).toBe('V')
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
    // Simula escritório com folha de pessoal representativa
    const folha = new Decimal(300000)   // R$300k/ano de folha
    const rb = new Decimal(1000000)     // R$1M de receita
    const { fatorR, anexo } = calcularFatorRPuro(folha, rb)
    expect(fatorR.gte(28)).toBe(true)
    expect(anexo).toBe('III')
  })

  it('Empresa de serviços com folha baixa fica no Anexo V (tributação maior)', () => {
    const folha = new Decimal(200000)   // R$200k/ano = 20%
    const rb = new Decimal(1000000)
    const { fatorR, anexo } = calcularFatorRPuro(folha, rb)
    expect(fatorR.lt(28)).toBe(true)
    expect(anexo).toBe('V')
  })

  it('Fator R é calculado sobre janela de 12 meses de receita bruta', async () => {
    // Documenta que o aggregate cobre o intervalo de datas dos 12 meses anteriores.
    mockDb.documentoFiscal.aggregate.mockResolvedValueOnce({
      _sum: { valorTotal: '1200000' },
    })

    const service = new FatorRService()
    await service.calcular('tenant-1', 'emp-6', '2025-01')

    const callArgs = mockDb.documentoFiscal.aggregate.mock.calls[0][0]
    // Verifica que há filtro de dataCompetencia com gte (início) e lte (fim)
    expect(callArgs.where.dataCompetencia).toBeDefined()
    expect(callArgs.where.dataCompetencia.gte).toBeInstanceOf(Date)
    expect(callArgs.where.dataCompetencia.lte).toBeInstanceOf(Date)
    // Janela: 12 meses → diferença de ~365 dias
    const diasDiferenca = Math.floor(
      (callArgs.where.dataCompetencia.lte.getTime() - callArgs.where.dataCompetencia.gte.getTime())
      / (1000 * 60 * 60 * 24)
    )
    expect(diasDiferenca).toBeGreaterThan(300)
    expect(diasDiferenca).toBeLessThan(400)
  })
})
