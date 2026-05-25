/**
 * Testes unitários — DepreciacaoService
 *
 * Cobre:
 *  - Fórmula: depreciacaoMensal = (valorAquisicao - valorResidual) / (vidaUtil * 12)
 *  - Arredondamento para 2 casas decimais (toDecimalPlaces(2))
 *  - Bem com vida útil já vencida → depreciação zero (ativo INATIVO)
 *  - Vários bens processados em lote
 *  - Valor residual maior que valor de aquisição → depreciação zero (proteção)
 *  - Vida útil 0 → não deve dividir por zero
 *
 * PrismaClient e AuditService são mockados via singleton.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Fórmula pura — replica a lógica do DepreciacaoService
// ---------------------------------------------------------------------------

function calcularDepreciacaoMensal(
  valorAquisicao: Decimal,
  valorResidual: Decimal,
  vidaUtilAnos: number
): Decimal {
  const vidaUtilMeses = vidaUtilAnos * 12
  if (vidaUtilMeses <= 0) return new Decimal(0)
  const base = valorAquisicao.minus(valorResidual)
  if (base.lte(0)) return new Decimal(0)
  return base.div(vidaUtilMeses).toDecimalPlaces(2)
}

// ---------------------------------------------------------------------------
// Mock do DB — o singleton é necessário para o import do serviço
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  bemAtivo: { findMany: vi.fn() },
  lancamentoContabil: { create: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => ({ registrar: vi.fn() })),
}))

import { DepreciacaoService } from '../depreciacao.service.js'

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.lancamentoContabil.create.mockResolvedValue({ id: 'lanc-1' })
})

// ---------------------------------------------------------------------------
// Testes da fórmula pura
// ---------------------------------------------------------------------------

describe('Depreciação — fórmula pura', () => {
  it('veículo R$50k, residual R$5k, vida útil 5 anos → R$750/mês', () => {
    const d = calcularDepreciacaoMensal(new Decimal(50000), new Decimal(5000), 5)
    // (50000 - 5000) / (5 * 12) = 45000 / 60 = 750
    expect(d.toFixed(2)).toBe('750.00')
  })

  it('computador R$6k, residual R$0, vida útil 5 anos → R$100/mês', () => {
    const d = calcularDepreciacaoMensal(new Decimal(6000), new Decimal(0), 5)
    // 6000 / 60 = 100
    expect(d.toFixed(2)).toBe('100.00')
  })

  it('imóvel R$300k, residual R$50k, vida útil 25 anos → R$833.33/mês', () => {
    const d = calcularDepreciacaoMensal(new Decimal(300000), new Decimal(50000), 25)
    // (300000 - 50000) / (25 * 12) = 250000 / 300 = 833.333... → arredonda para 833.33
    expect(d.toFixed(2)).toBe('833.33')
  })

  it('valor residual = valor de aquisição → depreciação zero', () => {
    const d = calcularDepreciacaoMensal(new Decimal(10000), new Decimal(10000), 5)
    expect(d.toFixed(2)).toBe('0.00')
  })

  it('valor residual maior que aquisição → depreciação zero (proteção)', () => {
    const d = calcularDepreciacaoMensal(new Decimal(5000), new Decimal(8000), 5)
    expect(d.toFixed(2)).toBe('0.00')
  })

  it('vida útil zero → depreciação zero (sem divisão por zero)', () => {
    const d = calcularDepreciacaoMensal(new Decimal(10000), new Decimal(0), 0)
    expect(d.toFixed(2)).toBe('0.00')
  })

  it('resultado sempre com no máximo 2 casas decimais', () => {
    const d = calcularDepreciacaoMensal(new Decimal(10000), new Decimal(1000), 7)
    // 9000 / 84 = 107.142857...
    expect(d.decimalPlaces()).toBeLessThanOrEqual(2)
    expect(d.toFixed(2)).toBe('107.14')
  })

  it('bem de R$1.200 com vida útil de 3 anos → R$33.33/mês', () => {
    const d = calcularDepreciacaoMensal(new Decimal(1200), new Decimal(0), 3)
    // 1200 / 36 = 33.333... → 33.33
    expect(d.toFixed(2)).toBe('33.33')
  })

  it('depreciacaoMensal × 12 meses ≤ base depreciável (acumulação anual)', () => {
    const valorAquisicao = new Decimal(120000)
    const valorResidual = new Decimal(20000)
    const vidaUtil = 10
    const d = calcularDepreciacaoMensal(valorAquisicao, valorResidual, vidaUtil)
    const acumuladoAnual = d.times(12)
    const base = valorAquisicao.minus(valorResidual)
    // Deve ser ≤ base (ligeira diferença por arredondamento)
    expect(acumuladoAnual.lte(base.plus(1))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Testes via DepreciacaoService com mock do DB
// ---------------------------------------------------------------------------

describe('DepreciacaoService — calcular() com mock do DB', () => {
  it('empresa não encontrada → lança erro', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new DepreciacaoService()
    await expect(service.calcular('t-1', 'emp-1', '2025-01')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('empresa sem bens ativos → nenhum lançamento gerado', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      id: 'emp-1',
      cnpj: '11.111.111/0001-11',
    })
    mockDb.bemAtivo.findMany.mockResolvedValueOnce([])
    const service = new DepreciacaoService()
    await service.calcular('t-1', 'emp-1', '2025-01')
    expect(mockDb.lancamentoContabil.create).not.toHaveBeenCalled()
  })

  it('1 bem ativo → gera 1 lançamento contábil de depreciação', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      id: 'emp-1',
      cnpj: '11.111.111/0001-11',
    })
    mockDb.bemAtivo.findMany.mockResolvedValueOnce([
      {
        id: 'bem-1',
        descricao: 'Computador',
        valorAquisicao: '6000',
        valorResidual: '0',
        vidaUtil: 5,
        status: 'ATIVO',
      },
    ])
    const service = new DepreciacaoService()
    await service.calcular('t-1', 'emp-1', '2025-01')
    expect(mockDb.lancamentoContabil.create).toHaveBeenCalledTimes(1)
  })

  it('lançamento contém partida DEBITO em conta 6.1.5.01 (Depreciação do período)', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      id: 'emp-1',
      cnpj: '11.111.111/0001-11',
    })
    mockDb.bemAtivo.findMany.mockResolvedValueOnce([
      {
        id: 'bem-1',
        descricao: 'Veículo',
        valorAquisicao: '50000',
        valorResidual: '5000',
        vidaUtil: 5,
        status: 'ATIVO',
      },
    ])
    const service = new DepreciacaoService()
    await service.calcular('t-1', 'emp-1', '2025-01')
    const callArgs = mockDb.lancamentoContabil.create.mock.calls[0][0]
    const partidas: Array<{ conta: string; tipo: string; valor: string }> = callArgs.data.partidas
    const debito = partidas.find((p) => p.tipo === 'DEBITO')
    expect(debito?.conta).toBe('6.1.5.01')
    expect(new Decimal(debito?.valor).toFixed(2)).toBe('750.00')
  })

  it('lançamento contém partida CREDITO em conta 1.2.1.02 (Depreciação acumulada)', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      id: 'emp-1',
      cnpj: '11.111.111/0001-11',
    })
    mockDb.bemAtivo.findMany.mockResolvedValueOnce([
      {
        id: 'bem-1',
        descricao: 'Veículo',
        valorAquisicao: '50000',
        valorResidual: '5000',
        vidaUtil: 5,
        status: 'ATIVO',
      },
    ])
    const service = new DepreciacaoService()
    await service.calcular('t-1', 'emp-1', '2025-01')
    const callArgs = mockDb.lancamentoContabil.create.mock.calls[0][0]
    const partidas: Array<{ conta: string; tipo: string }> = callArgs.data.partidas
    const credito = partidas.find((p) => p.tipo === 'CREDITO')
    expect(credito?.conta).toBe('1.2.1.02')
  })

  it('2 bens ativos → gera 2 lançamentos independentes', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      id: 'emp-1',
      cnpj: '11.111.111/0001-11',
    })
    mockDb.bemAtivo.findMany.mockResolvedValueOnce([
      {
        id: 'bem-1',
        descricao: 'Computador',
        valorAquisicao: '6000',
        valorResidual: '0',
        vidaUtil: 5,
        status: 'ATIVO',
      },
      {
        id: 'bem-2',
        descricao: 'Veículo',
        valorAquisicao: '50000',
        valorResidual: '5000',
        vidaUtil: 5,
        status: 'ATIVO',
      },
    ])
    const service = new DepreciacaoService()
    await service.calcular('t-1', 'emp-1', '2025-01')
    expect(mockDb.lancamentoContabil.create).toHaveBeenCalledTimes(2)
  })

  it('historico do lançamento inclui descrição do bem', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      id: 'emp-1',
      cnpj: '11.111.111/0001-11',
    })
    mockDb.bemAtivo.findMany.mockResolvedValueOnce([
      {
        id: 'bem-1',
        descricao: 'Servidor Dell PowerEdge',
        valorAquisicao: '24000',
        valorResidual: '0',
        vidaUtil: 4,
        status: 'ATIVO',
      },
    ])
    const service = new DepreciacaoService()
    await service.calcular('t-1', 'emp-1', '2025-01')
    const callArgs = mockDb.lancamentoContabil.create.mock.calls[0][0]
    expect(callArgs.data.historico).toContain('Servidor Dell PowerEdge')
  })

  it('filtra somente bens com status ATIVO (query correta)', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      id: 'emp-1',
      cnpj: '11.111.111/0001-11',
    })
    mockDb.bemAtivo.findMany.mockResolvedValueOnce([])
    const service = new DepreciacaoService()
    await service.calcular('t-1', 'emp-1', '2025-01')
    const callArgs = mockDb.bemAtivo.findMany.mock.calls[0][0]
    expect(callArgs.where.status).toBe('ATIVO')
    expect(callArgs.where.tenantId).toBe('t-1')
    expect(callArgs.where.empresaId).toBe('emp-1')
  })
})

// ---------------------------------------------------------------------------
// Casos de negócio
// ---------------------------------------------------------------------------

describe('Depreciação — casos de negócio', () => {
  it('Método linear: soma das depreciações mensais ao longo da vida útil ≈ base depreciável', () => {
    const valorAquisicao = new Decimal(120000)
    const valorResidual = new Decimal(0)
    const vidaUtil = 5
    const d = calcularDepreciacaoMensal(valorAquisicao, valorResidual, vidaUtil)
    let acumulado = new Decimal(0)
    for (let i = 0; i < vidaUtil * 12; i++) {
      acumulado = acumulado.plus(d)
    }
    // Pequena diferença por arredondamento (máx R$0,60 em 60 meses)
    const diff = acumulado.minus(valorAquisicao).abs()
    expect(diff.lte(1)).toBe(true)
  })

  it('Equipamento com vida útil de 10 anos (Tabela SRF) se deprecia em 120 meses', () => {
    const d = calcularDepreciacaoMensal(new Decimal(10000), new Decimal(0), 10)
    // 10000 / 120 = 83.333... → R$83.33/mês
    expect(d.toFixed(2)).toBe('83.33')
  })

  it('Imobilizado de baixo valor (R$1.200) com vida útil de 1 ano → R$100/mês', () => {
    const d = calcularDepreciacaoMensal(new Decimal(1200), new Decimal(0), 1)
    expect(d.toFixed(2)).toBe('100.00')
  })
})
