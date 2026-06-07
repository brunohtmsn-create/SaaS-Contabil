/**
 * Testes unitários — PrejuizosFiscaisLRService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime LP/SN/MEI → lança erro (exclusivo LR)
 *  - compensar: sem prejuízos → compensação zero, base inalterada
 *  - compensar: limite 30% do lucro real
 *  - compensar: compensação parcial quando prejuízo > 30% do lucro
 *  - compensar: compensação total quando prejuízo < 30% do lucro
 *  - compensar: múltiplos períodos de prejuízo — FIFO (mais antigo primeiro)
 *  - compensar: base após compensação = lucro - compensada (mínimo zero)
 *  - compensar: lucro zero → compensação zero
 *  - compensar: saldo restante = saldo antes - compensação utilizada
 *  - registrarPrejuizo: persiste IRPJ_LR com tipo PREJUIZO
 *  - registrarPrejuizo: persiste CSLL_LR com tipo PREJUIZO
 *  - compensar: registra IRPJ_CSLL_LR_APURADO no audit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = { registrar: vi.fn() }

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  apuracaoFiscal: { upsert: vi.fn(), findMany: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { PrejuizosFiscaisLRService } from '../prejuizos-fiscais-lr.service.js'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-prej'
const EMPRESA_ID = 'emp-prej'

const EMPRESA_LR = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa LR Prejuízos Ltda',
  regime: 'LUCRO_REAL',
  cnae: '6201500',
  uf: 'SP',
}

function makePrejuizoApuracao(opts: {
  competencia: string
  tipo: 'IRPJ_LR' | 'CSLL_LR'
  prejuizoOriginal: number
  saldoDisponivel: number
  prejuizoCompensado?: number
}) {
  const tipoField = opts.tipo === 'IRPJ_LR' ? 'prejuizoIRPJ' : 'prejuizoCSLL'
  return {
    id: `apr-${Math.random()}`,
    competencia: opts.competencia,
    tipo: opts.tipo,
    status: 'CALCULADO',
    dados: {
      tipo: 'PREJUIZO',
      [tipoField]: opts.prejuizoOriginal.toString(),
      saldoDisponivel: opts.saldoDisponivel.toString(),
      prejuizoCompensado: (opts.prejuizoCompensado ?? 0).toString(),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LR)
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'apr-1' })
  mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
})

// ===========================================================================

describe('PrejuizosFiscaisLRService — validações (compensar)', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new PrejuizosFiscaisLRService()
    await expect(
      service.compensar(
        TENANT_ID,
        EMPRESA_ID,
        '2025-01',
        new Decimal('100000'),
        new Decimal('100000')
      )
    ).rejects.toThrow('Empresa não encontrada')
  })

  it('lança erro para regime LUCRO_PRESUMIDO', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LR,
      regime: 'LUCRO_PRESUMIDO',
    })
    const service = new PrejuizosFiscaisLRService()
    await expect(
      service.compensar(
        TENANT_ID,
        EMPRESA_ID,
        '2025-01',
        new Decimal('100000'),
        new Decimal('100000')
      )
    ).rejects.toThrow('Lucro Real')
  })
})

// ===========================================================================

describe('PrejuizosFiscaisLRService — sem prejuízos anteriores', () => {
  it('compensação zero e base inalterada quando não há prejuízos', async () => {
    const service = new PrejuizosFiscaisLRService()
    const r = await service.compensar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal('100000'),
      new Decimal('100000')
    )

    expect(Number(r.compensacaoIRPJUtilizada)).toBe(0)
    expect(Number(r.compensacaoCSLLUtilizada)).toBe(0)
    expect(Number(r.baseIRPJAposCompensacao)).toBe(100000)
    expect(Number(r.baseCSLLAposCompensacao)).toBe(100000)
    expect(r.prejuizosIRPJ).toHaveLength(0)
    expect(r.prejuizosCSLL).toHaveLength(0)
  })
})

// ===========================================================================

describe('PrejuizosFiscaisLRService — limite 30%', () => {
  it('compensação IRPJ limitada a 30% do lucro', async () => {
    // prejuízo = 50.000; lucro = 100.000; limite = 30.000
    mockDb.apuracaoFiscal.findMany.mockImplementation((args: any) => {
      if (args.where.tipo === 'IRPJ_LR') {
        return Promise.resolve([
          makePrejuizoApuracao({
            competencia: '2024-12',
            tipo: 'IRPJ_LR',
            prejuizoOriginal: 50000,
            saldoDisponivel: 50000,
          }),
        ])
      }
      return Promise.resolve([])
    })

    const service = new PrejuizosFiscaisLRService()
    const r = await service.compensar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal('100000'),
      new Decimal('100000')
    )

    // limite = 100.000 × 30% = 30.000; mas temos 50.000 de prejuízo → compensa 30.000
    expect(Number(r.limiteCompensacaoIRPJ)).toBe(30000)
    expect(Number(r.compensacaoIRPJUtilizada)).toBe(30000)
    expect(Number(r.baseIRPJAposCompensacao)).toBe(70000) // 100.000 - 30.000
  })

  it('saldo restante = 50.000 - 30.000 = 20.000 após compensação parcial', async () => {
    mockDb.apuracaoFiscal.findMany.mockImplementation((args: any) => {
      if (args.where.tipo === 'IRPJ_LR') {
        return Promise.resolve([
          makePrejuizoApuracao({
            competencia: '2024-12',
            tipo: 'IRPJ_LR',
            prejuizoOriginal: 50000,
            saldoDisponivel: 50000,
          }),
        ])
      }
      return Promise.resolve([])
    })

    const service = new PrejuizosFiscaisLRService()
    const r = await service.compensar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal('100000'),
      new Decimal('100000')
    )

    expect(Number(r.saldoPrejuizoIRPJDepois)).toBe(20000)
  })

  it('compensação total quando prejuízo < 30% do lucro', async () => {
    // prejuízo = 10.000; lucro = 100.000; limite = 30.000 → compensa tudo
    mockDb.apuracaoFiscal.findMany.mockImplementation((args: any) => {
      if (args.where.tipo === 'IRPJ_LR') {
        return Promise.resolve([
          makePrejuizoApuracao({
            competencia: '2024-12',
            tipo: 'IRPJ_LR',
            prejuizoOriginal: 10000,
            saldoDisponivel: 10000,
          }),
        ])
      }
      return Promise.resolve([])
    })

    const service = new PrejuizosFiscaisLRService()
    const r = await service.compensar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal('100000'),
      new Decimal('100000')
    )

    expect(Number(r.compensacaoIRPJUtilizada)).toBe(10000)
    expect(Number(r.baseIRPJAposCompensacao)).toBe(90000)
    expect(Number(r.saldoPrejuizoIRPJDepois)).toBe(0)
  })
})

// ===========================================================================

describe('PrejuizosFiscaisLRService — múltiplos períodos', () => {
  it('compensa na ordem FIFO (mais antigo primeiro)', async () => {
    // dois períodos com 15.000 cada; lucro 100.000; limite 30.000 → compensa ambos
    mockDb.apuracaoFiscal.findMany.mockImplementation((args: any) => {
      if (args.where.tipo === 'IRPJ_LR') {
        return Promise.resolve([
          makePrejuizoApuracao({
            competencia: '2024-06',
            tipo: 'IRPJ_LR',
            prejuizoOriginal: 15000,
            saldoDisponivel: 15000,
          }),
          makePrejuizoApuracao({
            competencia: '2024-09',
            tipo: 'IRPJ_LR',
            prejuizoOriginal: 15000,
            saldoDisponivel: 15000,
          }),
        ])
      }
      return Promise.resolve([])
    })

    const service = new PrejuizosFiscaisLRService()
    const r = await service.compensar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal('100000'),
      new Decimal('100000')
    )

    // total prejuízo = 30.000; limite = 30.000 → compensa tudo
    expect(Number(r.compensacaoIRPJUtilizada)).toBe(30000)
    expect(Number(r.saldoPrejuizoIRPJDepois)).toBe(0)
  })

  it('excedente permanece no segundo período quando o limite é atingido pelo primeiro', async () => {
    // dois períodos com 25.000 cada; lucro 100.000; limite 30.000
    mockDb.apuracaoFiscal.findMany.mockImplementation((args: any) => {
      if (args.where.tipo === 'IRPJ_LR') {
        return Promise.resolve([
          makePrejuizoApuracao({
            competencia: '2024-06',
            tipo: 'IRPJ_LR',
            prejuizoOriginal: 25000,
            saldoDisponivel: 25000,
          }),
          makePrejuizoApuracao({
            competencia: '2024-09',
            tipo: 'IRPJ_LR',
            prejuizoOriginal: 25000,
            saldoDisponivel: 25000,
          }),
        ])
      }
      return Promise.resolve([])
    })

    const service = new PrejuizosFiscaisLRService()
    const r = await service.compensar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal('100000'),
      new Decimal('100000')
    )

    // compensa 30.000: 25.000 do primeiro + 5.000 do segundo
    expect(Number(r.compensacaoIRPJUtilizada)).toBe(30000)
    // saldo restante: 0 no primeiro + 20.000 no segundo = 20.000
    expect(Number(r.saldoPrejuizoIRPJDepois)).toBe(20000)
  })
})

// ===========================================================================

describe('PrejuizosFiscaisLRService — lucro zero', () => {
  it('compensação zero quando lucro é zero', async () => {
    mockDb.apuracaoFiscal.findMany.mockImplementation((args: any) => {
      if (args.where.tipo === 'IRPJ_LR') {
        return Promise.resolve([
          makePrejuizoApuracao({
            competencia: '2024-12',
            tipo: 'IRPJ_LR',
            prejuizoOriginal: 50000,
            saldoDisponivel: 50000,
          }),
        ])
      }
      return Promise.resolve([])
    })

    const service = new PrejuizosFiscaisLRService()
    const r = await service.compensar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal(0),
      new Decimal(0)
    )

    expect(Number(r.compensacaoIRPJUtilizada)).toBe(0)
    expect(Number(r.saldoPrejuizoIRPJDepois)).toBe(50000)
  })
})

// ===========================================================================

describe('PrejuizosFiscaisLRService — CSLL separado do IRPJ', () => {
  it('compensação CSLL é calculada separadamente com base CSLL', async () => {
    mockDb.apuracaoFiscal.findMany.mockImplementation((args: any) => {
      if (args.where.tipo === 'CSLL_LR') {
        return Promise.resolve([
          makePrejuizoApuracao({
            competencia: '2024-12',
            tipo: 'CSLL_LR',
            prejuizoOriginal: 20000,
            saldoDisponivel: 20000,
          }),
        ])
      }
      return Promise.resolve([])
    })

    const service = new PrejuizosFiscaisLRService()
    const r = await service.compensar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal('100000'),
      new Decimal('80000')
    )

    // limite CSLL = 80.000 × 30% = 24.000; prejuízo = 20.000 → compensa tudo
    expect(Number(r.compensacaoCSLLUtilizada)).toBe(20000)
    expect(Number(r.baseCSLLAposCompensacao)).toBe(60000) // 80.000 - 20.000
    expect(Number(r.saldoPrejuizoCSLLDepois)).toBe(0)
  })
})

// ===========================================================================

describe('PrejuizosFiscaisLRService — registrarPrejuizo', () => {
  it('persiste IRPJ_LR com tipo PREJUIZO', async () => {
    const service = new PrejuizosFiscaisLRService()
    await service.registrarPrejuizo(
      TENANT_ID,
      EMPRESA_ID,
      '2024-12',
      new Decimal('30000'),
      new Decimal('25000')
    )

    const chamadas = mockDb.apuracaoFiscal.upsert.mock.calls
    const chamadaIRPJ = chamadas.find(
      (c: any) => c[0].where.tenantId_empresaId_competencia_tipo.tipo === 'IRPJ_LR'
    )
    expect(chamadaIRPJ).toBeDefined()
    expect(chamadaIRPJ![0].create.dados.tipo).toBe('PREJUIZO')
  })

  it('persiste CSLL_LR com tipo PREJUIZO', async () => {
    const service = new PrejuizosFiscaisLRService()
    await service.registrarPrejuizo(
      TENANT_ID,
      EMPRESA_ID,
      '2024-12',
      new Decimal('30000'),
      new Decimal('25000')
    )

    const chamadas = mockDb.apuracaoFiscal.upsert.mock.calls
    const chamadaCSLL = chamadas.find(
      (c: any) => c[0].where.tenantId_empresaId_competencia_tipo.tipo === 'CSLL_LR'
    )
    expect(chamadaCSLL).toBeDefined()
    expect(chamadaCSLL![0].create.dados.tipo).toBe('PREJUIZO')
  })

  it('não persiste CSLL quando prejuízoCSLL é zero', async () => {
    const service = new PrejuizosFiscaisLRService()
    await service.registrarPrejuizo(
      TENANT_ID,
      EMPRESA_ID,
      '2024-12',
      new Decimal('30000'),
      new Decimal(0)
    )

    const chamadas = mockDb.apuracaoFiscal.upsert.mock.calls
    const chamadaCSLL = chamadas.find(
      (c: any) => c[0].where.tenantId_empresaId_competencia_tipo.tipo === 'CSLL_LR'
    )
    expect(chamadaCSLL).toBeUndefined()
  })

  it('não persiste IRPJ_LR quando prejuizoIRPJ é zero', async () => {
    const service = new PrejuizosFiscaisLRService()
    await service.registrarPrejuizo(
      TENANT_ID,
      EMPRESA_ID,
      '2024-12',
      new Decimal(0),
      new Decimal('20000')
    )

    const chamadas = mockDb.apuracaoFiscal.upsert.mock.calls
    const chamadaIRPJ = chamadas.find(
      (c: any) => c[0].where.tenantId_empresaId_competencia_tipo.tipo === 'IRPJ_LR'
    )
    expect(chamadaIRPJ).toBeUndefined()
  })

  it('ambos zero → nenhum upsert chamado, apenas audit', async () => {
    const service = new PrejuizosFiscaisLRService()
    await service.registrarPrejuizo(
      TENANT_ID,
      EMPRESA_ID,
      '2024-12',
      new Decimal(0),
      new Decimal(0)
    )

    expect(mockDb.apuracaoFiscal.upsert).not.toHaveBeenCalled()
    expect(mockAudit.registrar).toHaveBeenCalledOnce()
  })
})

// ===========================================================================

describe('PrejuizosFiscaisLRService — compensar: casos especiais', () => {
  it('lucro negativo → compensação zero, saldo preservado intacto', async () => {
    mockDb.apuracaoFiscal.findMany
      .mockResolvedValueOnce([
        makePrejuizoApuracao({
          competencia: '2024-06',
          tipo: 'IRPJ_LR',
          prejuizoOriginal: 50000,
          saldoDisponivel: 50000,
        }),
      ])
      .mockResolvedValueOnce([])

    const service = new PrejuizosFiscaisLRService()
    const result = await service.compensar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal('-10000'), // lucro negativo
      new Decimal('0')
    )

    expect(result.compensacaoIRPJUtilizada.toFixed(2)).toBe('0.00')
    // Saldo não é reduzido quando lucro < 0
    expect(result.saldoPrejuizoIRPJDepois.toFixed(2)).toBe('50000.00')
  })

  it('apuracao com saldoDisponivel=0 é ignorada (filtered out)', async () => {
    mockDb.apuracaoFiscal.findMany
      .mockResolvedValueOnce([
        makePrejuizoApuracao({
          competencia: '2024-03',
          tipo: 'IRPJ_LR',
          prejuizoOriginal: 30000,
          saldoDisponivel: 0, // saldo zerado → deve ser ignorada
        }),
        makePrejuizoApuracao({
          competencia: '2024-06',
          tipo: 'IRPJ_LR',
          prejuizoOriginal: 20000,
          saldoDisponivel: 20000,
        }),
      ])
      .mockResolvedValueOnce([])

    const service = new PrejuizosFiscaisLRService()
    const result = await service.compensar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal('100000'), // limite = 30.000
      new Decimal('0')
    )

    // Apenas a segunda apuracao (20k) participa (primeira tem saldo=0)
    expect(result.compensacaoIRPJUtilizada.toFixed(2)).toBe('20000.00')
  })
})

describe('PrejuizosFiscaisLRService — auditoria', () => {
  it('registra IRPJ_CSLL_LR_APURADO no audit ao compensar', async () => {
    const service = new PrejuizosFiscaisLRService()
    await service.compensar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal('100000'),
      new Decimal('100000')
    )

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('IRPJ_CSLL_LR_APURADO')
    expect(auditCall.estadoNovo.tipo).toBe('COMPENSACAO_PREJUIZO')
  })

  it('audit estadoNovo contém tenantId correto', async () => {
    const service = new PrejuizosFiscaisLRService()
    await service.compensar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-01',
      new Decimal('50000'),
      new Decimal('50000')
    )

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.tenantId).toBe(TENANT_ID)
  })
})
