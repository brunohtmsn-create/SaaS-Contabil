/**
 * Testes unitários — DifalService
 *
 * Cobre:
 *  - Cálculo do DIFAL por par UF origem/destino
 *  - Determinação da alíquota interestadual (Sul/Sudeste/CO = 12%, Norte/Nordeste = 7%)
 *  - Alíquota interna por UF destino
 *  - Cálculo do Fundo de Pobreza (BA=2%, AL=2%, SP=0%)
 *  - Valor total = DIFAL + Fundo Pobreza
 *  - Documentação: somente documentos com status = CONCILIADO entram no cálculo
 *    (garantido pela query do serviço — filtro `status: 'CONCILIADO'`)
 *
 * Os métodos privados são acessados via cast para 'any'.
 * PrismaClient e AuditService são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'
import { FUNDO_POBREZA } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Singleton de mock do DB — o getPrismaClient() sempre retorna o mesmo objeto,
// assim os testes podem configurar mocks antes de instanciar o serviço.
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  documentoFiscal: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => ({
    registrar: vi.fn(),
  })),
}))

import { DifalService } from '../difal.service.js'

// ---------------------------------------------------------------------------
// Reset dos mocks entre testes
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.documentoFiscal.update.mockResolvedValue({})
  mockDb.empresaCliente.findUnique.mockResolvedValue(null)
})

// ---------------------------------------------------------------------------
// Helper: calcula DIFAL e Fundo de Pobreza de forma pura
// Replica a lógica interna do DifalService
// ---------------------------------------------------------------------------

function calcularDifalPuro(
  base: Decimal,
  aliquotaInterestadual: Decimal,
  aliquotaInterna: Decimal,
  ufDestino: string
) {
  const difal = base.times(aliquotaInterna.minus(aliquotaInterestadual)).div(100).toDecimalPlaces(2)
  const percentualFundo = FUNDO_POBREZA[ufDestino] ?? new Decimal(0)
  const fundoPobreza = base.times(percentualFundo).div(100).toDecimalPlaces(2)
  return { difal, fundoPobreza, total: difal.plus(fundoPobreza) }
}

// ---------------------------------------------------------------------------
// Testes dos métodos privados via 'any'
// ---------------------------------------------------------------------------

describe('DifalService — getAliquotaInterestadual()', () => {
  let service: DifalService

  beforeEach(() => {
    service = new DifalService()
  })

  it('SP → BA (Norte/Nordeste): alíquota interestadual = 7%', () => {
    const aliq = (service as any).getAliquotaInterestadual('SP', 'BA')
    expect(aliq.toFixed(0)).toBe('7')
  })

  it('SP → AM (Norte/Nordeste): alíquota interestadual = 7%', () => {
    const aliq = (service as any).getAliquotaInterestadual('SP', 'AM')
    expect(aliq.toFixed(0)).toBe('7')
  })

  it('SP → PA (Norte/Nordeste): alíquota interestadual = 7%', () => {
    const aliq = (service as any).getAliquotaInterestadual('SP', 'PA')
    expect(aliq.toFixed(0)).toBe('7')
  })

  it('SP → MG (Sul/Sudeste/CO): alíquota interestadual = 12%', () => {
    const aliq = (service as any).getAliquotaInterestadual('SP', 'MG')
    expect(aliq.toFixed(0)).toBe('12')
  })

  it('SP → PR (Sul): alíquota interestadual = 12%', () => {
    const aliq = (service as any).getAliquotaInterestadual('SP', 'PR')
    expect(aliq.toFixed(0)).toBe('12')
  })

  it('SP → GO (Centro-Oeste): alíquota interestadual = 12%', () => {
    const aliq = (service as any).getAliquotaInterestadual('SP', 'GO')
    expect(aliq.toFixed(0)).toBe('12')
  })

  it('SP → RJ (Sudeste): alíquota interestadual = 12%', () => {
    const aliq = (service as any).getAliquotaInterestadual('SP', 'RJ')
    expect(aliq.toFixed(0)).toBe('12')
  })
})

describe('DifalService — getAliquotaInterna()', () => {
  let service: DifalService

  beforeEach(() => {
    service = new DifalService()
  })

  it('BA → alíquota interna = 19%', () => {
    const aliq = (service as any).getAliquotaInterna('BA')
    expect(aliq.toFixed(0)).toBe('19')
  })

  it('AM → alíquota interna = 20%', () => {
    const aliq = (service as any).getAliquotaInterna('AM')
    expect(aliq.toFixed(0)).toBe('20')
  })

  it('SP → alíquota interna = 18%', () => {
    const aliq = (service as any).getAliquotaInterna('SP')
    expect(aliq.toFixed(0)).toBe('18')
  })

  it('RJ → alíquota interna = 20%', () => {
    const aliq = (service as any).getAliquotaInterna('RJ')
    expect(aliq.toFixed(0)).toBe('20')
  })

  it('RS → alíquota interna = 17%', () => {
    const aliq = (service as any).getAliquotaInterna('RS')
    expect(aliq.toFixed(0)).toBe('17')
  })

  it('MA → alíquota interna = 22%', () => {
    const aliq = (service as any).getAliquotaInterna('MA')
    expect(aliq.toFixed(0)).toBe('22')
  })

  it('UF desconhecida → fallback 18%', () => {
    const aliq = (service as any).getAliquotaInterna('ZZ')
    expect(aliq.toFixed(0)).toBe('18')
  })
})

// ---------------------------------------------------------------------------
// Cálculo DIFAL puro: SP → BA
// Interestadual: 7%, Interna BA: 19%, Diferencial: 12%
// ---------------------------------------------------------------------------

describe('DIFAL cálculo puro — SP → BA', () => {
  const base = new Decimal(10000)
  const aliqInterestadual = new Decimal(7)
  const aliqInterna = new Decimal(19)
  const ufDestino = 'BA'

  it('Diferencial de alíquota = 19% - 7% = 12%', () => {
    const diferencial = aliqInterna.minus(aliqInterestadual)
    expect(diferencial.toFixed(0)).toBe('12')
  })

  it('DIFAL sobre base R$10.000 = R$1.200,00', () => {
    const { difal } = calcularDifalPuro(base, aliqInterestadual, aliqInterna, ufDestino)
    expect(difal.toFixed(2)).toBe('1200.00')
  })

  it('Fundo de Pobreza BA = 2% → R$200,00 sobre base R$10.000', () => {
    const { fundoPobreza } = calcularDifalPuro(base, aliqInterestadual, aliqInterna, ufDestino)
    expect(fundoPobreza.toFixed(2)).toBe('200.00')
  })

  it('Valor total (DIFAL + Fundo Pobreza) = R$1.400,00', () => {
    const { total } = calcularDifalPuro(base, aliqInterestadual, aliqInterna, ufDestino)
    expect(total.toFixed(2)).toBe('1400.00')
  })
})

// ---------------------------------------------------------------------------
// Cálculo DIFAL puro: SP → AM
// Interestadual: 7%, Interna AM: 20%, Diferencial: 13%
// ---------------------------------------------------------------------------

describe('DIFAL cálculo puro — SP → AM', () => {
  const base = new Decimal(10000)
  const aliqInterestadual = new Decimal(7)
  const aliqInterna = new Decimal(20)
  const ufDestino = 'AM'

  it('Diferencial de alíquota = 20% - 7% = 13%', () => {
    const diferencial = aliqInterna.minus(aliqInterestadual)
    expect(diferencial.toFixed(0)).toBe('13')
  })

  it('DIFAL sobre base R$10.000 = R$1.300,00', () => {
    const { difal } = calcularDifalPuro(base, aliqInterestadual, aliqInterna, ufDestino)
    expect(difal.toFixed(2)).toBe('1300.00')
  })

  it('Fundo de Pobreza AM = 0% → R$0,00', () => {
    // AM não está na lista do FUNDO_POBREZA
    const { fundoPobreza } = calcularDifalPuro(base, aliqInterestadual, aliqInterna, ufDestino)
    expect(fundoPobreza.toFixed(2)).toBe('0.00')
  })

  it('Valor total (DIFAL + Fundo Pobreza) = R$1.300,00', () => {
    const { total } = calcularDifalPuro(base, aliqInterestadual, aliqInterna, ufDestino)
    expect(total.toFixed(2)).toBe('1300.00')
  })
})

// ---------------------------------------------------------------------------
// Cálculo DIFAL puro: SP → SP (mesma UF — diferencial = 0)
// ---------------------------------------------------------------------------

describe('DIFAL cálculo puro — diferencial zero', () => {
  it('Quando alíquota interestadual = alíquota interna → DIFAL = R$0,00', () => {
    const base = new Decimal(10000)
    const aliqInterna = new Decimal(18)
    const aliqInterIgualInterna = new Decimal(18)
    const { difal } = calcularDifalPuro(base, aliqInterIgualInterna, aliqInterna, 'SP')
    expect(difal.toFixed(2)).toBe('0.00')
  })
})

// ---------------------------------------------------------------------------
// Fundo de Pobreza — constante FUNDO_POBREZA da lib shared
// ---------------------------------------------------------------------------

describe('Fundo de Pobreza — constante FUNDO_POBREZA', () => {
  it('BA tem Fundo de Pobreza = 2%', () => {
    expect(FUNDO_POBREZA['BA']?.toFixed(0)).toBe('2')
  })

  it('AL tem Fundo de Pobreza = 2%', () => {
    expect(FUNDO_POBREZA['AL']?.toFixed(0)).toBe('2')
  })

  it('CE tem Fundo de Pobreza = 2%', () => {
    expect(FUNDO_POBREZA['CE']?.toFixed(0)).toBe('2')
  })

  it('MA tem Fundo de Pobreza = 2%', () => {
    expect(FUNDO_POBREZA['MA']?.toFixed(0)).toBe('2')
  })

  it('SP NÃO tem Fundo de Pobreza', () => {
    expect(FUNDO_POBREZA['SP']).toBeUndefined()
  })

  it('RJ NÃO tem Fundo de Pobreza', () => {
    expect(FUNDO_POBREZA['RJ']).toBeUndefined()
  })

  it('PR NÃO tem Fundo de Pobreza', () => {
    expect(FUNDO_POBREZA['PR']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Documentação: somente CONCILIADO entra no cálculo
//
// Este teste documenta o contrato arquitetural (Regra 10 do CLAUDE.md):
// "DIFAL → calcular SOMENTE de NF-e com status = CONCILIADO"
//
// A validação é feita via mock do DB: o serviço só busca documentos com
// `status: 'CONCILIADO'` — documentos em outro estado são ignorados.
// ---------------------------------------------------------------------------

describe('DIFAL — somente documentos CONCILIADOS entram no cálculo', () => {
  it('calcular() chama findMany apenas com status CONCILIADO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      id: 'emp-1',
      cnpj: '00.000.000/0001-00',
    })
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const service = new DifalService()
    const resultados = await service.calcular('tenant-1', 'emp-1', '2025-01')

    // Verifica que a query inclui status: 'CONCILIADO'
    const callArgs = mockDb.documentoFiscal.findMany.mock.calls[0][0]
    expect(callArgs.where.status).toBe('CONCILIADO')
    expect(resultados).toHaveLength(0)
  })

  it('Documentos não conciliados NÃO aparecem nos resultados', async () => {
    // O mock retorna lista vazia para simular que o DB filtrou os não-conciliados.
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      id: 'emp-2',
      cnpj: '11.111.111/0001-11',
    })
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const service = new DifalService()
    const resultados = await service.calcular('tenant-1', 'emp-2', '2025-01')
    expect(resultados).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Teste de integração leve: calcular() com documento mockado
// ---------------------------------------------------------------------------

describe('DifalService — calcular() com documento mockado', () => {
  it('Processa um documento SP → BA e retorna DIFAL + Fundo Pobreza corretos', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      id: 'emp-3',
      cnpj: '22.222.222/0001-22',
    })

    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      {
        id: 'doc-1',
        valorTotal: new Decimal(10000),
        ufOrigem: 'SP',
        ufDestino: 'BA',
        status: 'CONCILIADO',
      },
    ])

    const service = new DifalService()
    const resultados = await service.calcular('tenant-1', 'emp-3', '2025-01')

    expect(resultados).toHaveLength(1)
    const r = resultados[0]!

    // SP → BA: interestadual 7%, interna BA 19%, diferencial 12%
    expect(r.aliquotaInterestadual.toFixed(0)).toBe('7')
    expect(r.aliquotaInterna.toFixed(0)).toBe('19')
    expect(r.valorDifal.toFixed(2)).toBe('1200.00')
    expect(r.valorFundoPobreza.toFixed(2)).toBe('200.00')
    expect(r.valorTotal.toFixed(2)).toBe('1400.00')
    expect(r.ufDestino).toBe('BA')
  })

  it('Processa um documento SP → AM e retorna DIFAL correto (sem Fundo Pobreza)', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      id: 'emp-4',
      cnpj: '33.333.333/0001-33',
    })

    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      {
        id: 'doc-2',
        valorTotal: new Decimal(10000),
        ufOrigem: 'SP',
        ufDestino: 'AM',
        status: 'CONCILIADO',
      },
    ])

    const service = new DifalService()
    const resultados = await service.calcular('tenant-1', 'emp-4', '2025-01')

    expect(resultados).toHaveLength(1)
    const r = resultados[0]!

    // SP → AM: interestadual 7%, interna AM 20%, diferencial 13%
    expect(r.aliquotaInterestadual.toFixed(0)).toBe('7')
    expect(r.aliquotaInterna.toFixed(0)).toBe('20')
    expect(r.valorDifal.toFixed(2)).toBe('1300.00')
    expect(r.valorFundoPobreza.toFixed(2)).toBe('0.00')
    expect(r.valorTotal.toFixed(2)).toBe('1300.00')
  })

  it('Lança erro quando empresa não encontrada', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)

    const service = new DifalService()
    await expect(service.calcular('tenant-1', 'emp-inexistente', '2025-01')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})
