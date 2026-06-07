/**
 * Testes unitários — ConciliacaoBancariaService
 *
 * Cobre:
 *  - conciliar() sem transações → não faz nenhum update
 *  - Match por valor exato dentro de tolerância de 2 dias
 *  - Match por valor com tolerância de R$0.02 (centavos)
 *  - Sem match quando diferença de valor > R$0.02
 *  - Sem match quando diferença de dias > 2
 *  - Empresa não encontrada → lança erro
 *  - Transações já CONCILIADA não entram na busca (filtro do DB mockado)
 *  - tenantId em todas as queries (CLAUDE.md §8)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  transacaoBancaria: { findMany: vi.fn(), update: vi.fn() },
  documentoFiscal: { findMany: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => ({
    registrar: vi.fn(),
  })),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    parsePeriodo: vi.fn(() => ({
      inicio: new Date('2025-05-01'),
      fim: new Date('2025-05-31'),
    })),
  }
})

import { ConciliacaoBancariaService } from '../conciliacao-bancaria.service.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-conc'
const EMPRESA_ID = 'emp-conc'
const COMPETENCIA = '2025-05'
const EMPRESA = { id: EMPRESA_ID, cnpj: '11222333000181', razaoSocial: 'Empresa Conc Ltda' }

function makeTransacao(id: string, valor: string, data: string, status = 'NAO_CONCILIADA') {
  return {
    id,
    tenantId: TENANT_ID,
    empresaId: EMPRESA_ID,
    valor: new Decimal(valor),
    data: new Date(data),
    descricao: 'PIX RECEBIDO',
    status,
    documentoId: null,
  } as any
}

function makeDoc(id: string, valorTotal: string, dataEmissao: string) {
  return {
    id,
    tenantId: TENANT_ID,
    empresaId: EMPRESA_ID,
    valorTotal: new Decimal(valorTotal),
    dataEmissao: new Date(dataEmissao),
    status: 'CONCILIADO',
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA)
  mockDb.transacaoBancaria.findMany.mockResolvedValue([])
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.transacaoBancaria.update.mockResolvedValue({})
})

// ===========================================================================

describe('ConciliacaoBancariaService — empresa não encontrada', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new ConciliacaoBancariaService()
    await expect(service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)).rejects.toThrow(
      'Empresa não encontrada'
    )
  })
})

describe('ConciliacaoBancariaService — sem transações', () => {
  it('não faz update quando não há transações pendentes', async () => {
    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)
    expect(mockDb.transacaoBancaria.update).not.toHaveBeenCalled()
  })

  it('consulta transações com tenantId e status NAO_CONCILIADA', async () => {
    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const { where } = mockDb.transacaoBancaria.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
    expect(where.status).toBe('NAO_CONCILIADA')
  })

  it('consulta documentos com status CONCILIADO', async () => {
    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    const { where } = mockDb.documentoFiscal.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.status).toBe('CONCILIADO')
  })
})

describe('ConciliacaoBancariaService — matching', () => {
  it('match exato (valor e data iguais) → atualiza transação para CONCILIADA', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([
      makeTransacao('tx-1', '1500.00', '2025-05-10'),
    ])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc('doc-1', '1500.00', '2025-05-10'),
    ])

    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.transacaoBancaria.update).toHaveBeenCalledOnce()
    const { data } = mockDb.transacaoBancaria.update.mock.calls[0][0]
    expect(data.status).toBe('CONCILIADA')
    expect(data.documentoId).toBe('doc-1')
  })

  it('tolerância de valor R$0.01 → faz match', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([
      makeTransacao('tx-2', '1500.01', '2025-05-10'),
    ])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc('doc-2', '1500.00', '2025-05-10'),
    ])

    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.transacaoBancaria.update).toHaveBeenCalledOnce()
  })

  it('tolerância de valor R$0.02 (máximo) → faz match', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([
      makeTransacao('tx-3', '1500.02', '2025-05-10'),
    ])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc('doc-3', '1500.00', '2025-05-10'),
    ])

    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.transacaoBancaria.update).toHaveBeenCalledOnce()
  })

  it('diferença de valor R$0.03 → sem match', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([
      makeTransacao('tx-4', '1500.03', '2025-05-10'),
    ])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc('doc-4', '1500.00', '2025-05-10'),
    ])

    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.transacaoBancaria.update).not.toHaveBeenCalled()
  })

  it('diferença de 2 dias → faz match', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([
      makeTransacao('tx-5', '800.00', '2025-05-12'), // 2 dias depois
    ])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc('doc-5', '800.00', '2025-05-10'),
    ])

    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.transacaoBancaria.update).toHaveBeenCalledOnce()
  })

  it('diferença de 3 dias → sem match', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([
      makeTransacao('tx-6', '800.00', '2025-05-13'), // 3 dias depois
    ])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc('doc-6', '800.00', '2025-05-10'),
    ])

    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.transacaoBancaria.update).not.toHaveBeenCalled()
  })

  it('múltiplas transações — cada uma é conciliada independentemente', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([
      makeTransacao('tx-a', '1000.00', '2025-05-05'),
      makeTransacao('tx-b', '2000.00', '2025-05-15'),
      makeTransacao('tx-c', '9999.99', '2025-05-20'), // sem match (valor diferente)
    ])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc('doc-a', '1000.00', '2025-05-05'),
      makeDoc('doc-b', '2000.00', '2025-05-15'),
    ])

    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.transacaoBancaria.update).toHaveBeenCalledTimes(2)
  })

  it('sem documentos disponíveis → nenhuma transação conciliada', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([
      makeTransacao('tx-x', '500.00', '2025-05-10'),
    ])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([])

    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.transacaoBancaria.update).not.toHaveBeenCalled()
  })

  it('múltiplos docs com mesmo valor → primeiro match vence (short-circuit)', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([
      makeTransacao('tx-sc', '700.00', '2025-05-10'),
    ])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc('doc-first', '700.00', '2025-05-10'),
      makeDoc('doc-second', '700.00', '2025-05-10'),
    ])

    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.transacaoBancaria.update).toHaveBeenCalledOnce()
    const { data } = mockDb.transacaoBancaria.update.mock.calls[0][0]
    expect(data.documentoId).toBe('doc-first')
  })

  it('data da transação anterior à do doc (diff negativa) → abs() torna positivo e faz match', async () => {
    mockDb.transacaoBancaria.findMany.mockResolvedValueOnce([
      makeTransacao('tx-before', '600.00', '2025-05-08'), // 2 dias ANTES do doc
    ])
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc('doc-after', '600.00', '2025-05-10'),
    ])

    const service = new ConciliacaoBancariaService()
    await service.conciliar(TENANT_ID, EMPRESA_ID, COMPETENCIA)

    expect(mockDb.transacaoBancaria.update).toHaveBeenCalledOnce()
  })
})
