/**
 * Testes unitários — LALURService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime LP → lança erro
 *  - sem adições/exclusões/compensações → lucro real = lucro líquido
 *  - adições aumentam a base
 *  - exclusões reduzem a base
 *  - múltiplas adições somadas corretamente
 *  - múltiplas exclusões somadas corretamente
 *  - compensação FIFO de prejuízos (limite 30%)
 *  - sem prejuízos → compensações vazias
 *  - lucro negativo → compensação zerada, prejuízos mantidos
 *  - saldo remanescente de prejuízos calculado corretamente
 *  - limite 30% bloqueia compensação excessiva
 *  - lucroReal nunca negativo (clamp a zero)
 *  - baseCSLL = lucroReal
 *  - persiste com tipo IRPJ_LR e tipo=LALUR nos dados
 *  - registra IRPJ_CSLL_LR_APURADO no audit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = { registrar: vi.fn() }

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  apuracaoFiscal: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { LALURService } from '../lalur.service.js'
import type { ItemAdicao, ItemExclusao } from '../lalur.service.js'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-lalur'
const EMPRESA_ID = 'emp-lalur'

const EMPRESA_LR = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa LALUR Ltda',
  regime: 'LUCRO_REAL',
}

const EMPRESA_LP = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa LP Ltda',
  regime: 'LUCRO_PRESUMIDO',
}

function addItem(descricao: string, valor: number): ItemAdicao {
  return { descricao, valor: new Decimal(valor) }
}

function excItem(descricao: string, valor: number): ItemExclusao {
  return { descricao, valor: new Decimal(valor) }
}

function makePrejuizo(competencia: string, valor: number) {
  return {
    competencia,
    tipo: 'IRPJ_LR',
    dados: {
      tipo: 'PREJUIZO',
      valorPrejuizo: String(valor),
      saldoRemanescente: String(valor),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LR)
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'lalur-1' })
  mockDb.apuracaoFiscal.findMany.mockResolvedValue([])
})

// ===========================================================================

describe('LALURService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new LALURService()
    await expect(
      service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('100000'))
    ).rejects.toThrow('Empresa não encontrada')
  })

  it('lança erro para regime LP', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(EMPRESA_LP)
    const service = new LALURService()
    await expect(
      service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('100000'))
    ).rejects.toThrow('somente para Lucro Real')
  })
})

// ===========================================================================

describe('LALURService — sem ajustes', () => {
  it('lucro real = lucro líquido quando sem adições/exclusões/compensações', async () => {
    const service = new LALURService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('200000'))

    expect(Number(r.lucroReal)).toBe(200000)
    expect(Number(r.totalAdicoes)).toBe(0)
    expect(Number(r.totalExclusoes)).toBe(0)
    expect(Number(r.totalCompensacoes)).toBe(0)
  })
})

// ===========================================================================

describe('LALURService — adições', () => {
  it('uma adição aumenta o lucro real', async () => {
    const service = new LALURService()
    // Lucro = 200.000 + adição 50.000 = 250.000
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('200000'), [
      addItem('Provisão não dedutível', 50000),
    ])

    expect(Number(r.totalAdicoes)).toBe(50000)
    expect(Number(r.lucroReal)).toBe(250000)
  })

  it('múltiplas adições somadas corretamente', async () => {
    const service = new LALURService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('100000'), [
      addItem('Provisão multa', 10000),
      addItem('Despesa não dedutível', 15000),
      addItem('Brindes e doações', 5000),
    ])

    expect(Number(r.totalAdicoes)).toBe(30000)
    expect(Number(r.lucroReal)).toBe(130000)
  })
})

// ===========================================================================

describe('LALURService — exclusões', () => {
  it('uma exclusão reduz o lucro real', async () => {
    const service = new LALURService()
    // Lucro = 200.000 - exclusão 30.000 = 170.000
    const r = await service.apurar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-12',
      new Decimal('200000'),
      [],
      [excItem('Receita de dividendos', 30000)]
    )

    expect(Number(r.totalExclusoes)).toBe(30000)
    expect(Number(r.lucroReal)).toBe(170000)
  })

  it('múltiplas exclusões somadas corretamente', async () => {
    const service = new LALURService()
    const r = await service.apurar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-12',
      new Decimal('300000'),
      [],
      [excItem('Dividendos', 50000), excItem('TJLP', 20000)]
    )

    expect(Number(r.totalExclusoes)).toBe(70000)
    expect(Number(r.lucroReal)).toBe(230000)
  })
})

// ===========================================================================

describe('LALURService — compensação de prejuízos', () => {
  it('sem prejuízos → compensações vazias', async () => {
    const service = new LALURService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('100000'))

    expect(r.compensacoes).toHaveLength(0)
    expect(Number(r.totalCompensacoes)).toBe(0)
  })

  it('compensa até 30% do lucro ajustado', async () => {
    // Lucro = 100.000; prejuízo = 50.000
    // limite = 30% × 100.000 = 30.000 → compensa 30.000 (não os 50.000 inteiros)
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([makePrejuizo('2024-12', 50000)])

    const service = new LALURService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('100000'))

    expect(Number(r.totalCompensacoes)).toBe(30000)
    expect(Number(r.lucroReal)).toBe(70000)
    expect(r.compensacoes).toHaveLength(1)
    expect(Number(r.compensacoes[0]!.valorUtilizado)).toBe(30000)
    expect(Number(r.saldoPrejuizosRemanescentes)).toBe(20000) // 50.000 - 30.000
  })

  it('compensa prejuízo inteiro se cabe no limite', async () => {
    // Lucro = 200.000; prejuízo = 10.000; limite = 60.000 → compensa os 10.000 inteiros
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([makePrejuizo('2024-12', 10000)])

    const service = new LALURService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('200000'))

    expect(Number(r.totalCompensacoes)).toBe(10000)
    expect(Number(r.lucroReal)).toBe(190000)
    expect(Number(r.saldoPrejuizosRemanescentes)).toBe(0)
  })

  it('FIFO — consome períodos mais antigos primeiro', async () => {
    // Lucro = 50.000; limite = 15.000
    // Dois prejuízos: 2023 = 8.000; 2024 = 20.000
    // FIFO: consome 8.000 de 2023 e 7.000 de 2024 (total = 15.000)
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([
      makePrejuizo('2023-12', 8000),
      makePrejuizo('2024-12', 20000),
    ])

    const service = new LALURService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('50000'))

    expect(Number(r.totalCompensacoes)).toBe(15000) // 30% × 50.000
    expect(r.compensacoes[0]!.competenciaOrigem).toBe('2023-12')
    expect(Number(r.compensacoes[0]!.valorUtilizado)).toBe(8000)
    expect(r.compensacoes[1]!.competenciaOrigem).toBe('2024-12')
    expect(Number(r.compensacoes[1]!.valorUtilizado)).toBe(7000)
    expect(Number(r.saldoPrejuizosRemanescentes)).toBe(13000) // 0 + 13.000
  })

  it('lucro negativo → compensação zerada, prejuízos mantidos', async () => {
    mockDb.apuracaoFiscal.findMany.mockResolvedValueOnce([makePrejuizo('2024-12', 30000)])

    const service = new LALURService()
    const r = await service.apurar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-12',
      new Decimal('-50000') // Lucro negativo
    )

    expect(Number(r.totalCompensacoes)).toBe(0)
    expect(r.compensacoes).toHaveLength(0)
    expect(Number(r.saldoPrejuizosRemanescentes)).toBe(30000)
  })

  it('lucroReal nunca negativo', async () => {
    const service = new LALURService()
    // Adições zero, exclusões grandes → lucroAjustado negativo
    const r = await service.apurar(
      TENANT_ID,
      EMPRESA_ID,
      '2025-12',
      new Decimal('10000'),
      [],
      [excItem('Grande exclusão', 50000)]
    )

    expect(Number(r.lucroReal)).toBe(0)
  })
})

// ===========================================================================

describe('LALURService — baseCSLL', () => {
  it('baseCSLL = lucroReal', async () => {
    const service = new LALURService()
    const r = await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('100000'))
    expect(r.baseCSLL.equals(r.lucroReal)).toBe(true)
  })
})

// ===========================================================================

describe('LALURService — persistência e auditoria', () => {
  it('persiste com tipo IRPJ_LR e dados.tipo = LALUR', async () => {
    const service = new LALURService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('100000'))

    const call = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(call[0].where.tenantId_empresaId_competencia_tipo.tipo).toBe('IRPJ_LR')
    expect(call[0].create.dados.tipo).toBe('LALUR')
  })

  it('registra evento IRPJ_CSLL_LR_APURADO no audit', async () => {
    const service = new LALURService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('100000'))

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('IRPJ_CSLL_LR_APURADO')
    expect(auditCall.estadoNovo.tipo).toBe('LALUR')
  })

  it('audit tenantId correto', async () => {
    const service = new LALURService()
    await service.apurar(TENANT_ID, EMPRESA_ID, '2025-12', new Decimal('100000'))
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.tenantId).toBe(TENANT_ID)
  })
})
