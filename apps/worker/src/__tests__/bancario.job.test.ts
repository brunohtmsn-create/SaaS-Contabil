/**
 * Testes unitários — bancarioJob
 *
 * Cobre:
 *  - modo EMPRESA: sincroniza Open Finance, concilia bancário e registra auditoria
 *  - modo EMPRESA: skip quando empresa não encontrada
 *  - modo BATCH_TENANT: processa todas as empresas ativas do tenant
 *  - modo BATCH_TENANT: usa Promise.allSettled (erros parciais não param o lote)
 *  - modo BATCH_TENANT: loga ok e erros ao final
 *  - modo BATCH_GLOBAL: processa todos os tenants ativos
 *  - modo BATCH_GLOBAL: usa competência do mês atual via formatCompetencia(nowBR())
 *  - modo BATCH_GLOBAL: loga por tenant e ao final
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockDb, mockOpenFinance, mockBancaria, mockAudit } = vi.hoisted(() => ({
  mockDb: {
    empresaCliente: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    tenant: {
      findMany: vi.fn(),
    },
  },
  mockOpenFinance: { sincronizarContas: vi.fn() },
  mockBancaria: { conciliar: vi.fn() },
  mockAudit: { registrar: vi.fn() },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/contabil', () => ({
  OpenFinanceService: vi.fn(() => mockOpenFinance),
  ConciliacaoBancariaService: vi.fn(() => mockBancaria),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn(() => mockAudit),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    nowBR: vi.fn(() => new Date('2025-05-01T00:00:00.000Z')),
    formatCompetencia: vi.fn(() => '2025-05'),
  }
})

import { bancarioJob } from '../jobs/bancario.job.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-banc'
const EMPRESA_ID = 'emp-banc'
const CNPJ = '11222333000181'
const COMP = '2025-05'

function makeJob(data: Record<string, unknown>, id = 'job-001') {
  return {
    id,
    data,
    log: vi.fn().mockResolvedValue(undefined),
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockOpenFinance.sincronizarContas.mockResolvedValue(undefined)
  mockBancaria.conciliar.mockResolvedValue(undefined)
  mockAudit.registrar.mockResolvedValue(undefined)
})

// ===========================================================================
// modo EMPRESA
// ===========================================================================

describe('bancarioJob — modo EMPRESA', () => {
  it('chama sincronizarContas e conciliar com tenantId, empresaId e competencia', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ cnpj: CNPJ })

    const job = makeJob({
      modo: 'EMPRESA',
      tenantId: TENANT_ID,
      empresaId: EMPRESA_ID,
      competencia: COMP,
    })
    await bancarioJob(job)

    expect(mockOpenFinance.sincronizarContas).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID)
    expect(mockBancaria.conciliar).toHaveBeenCalledWith(TENANT_ID, EMPRESA_ID, COMP)
  })

  it('registra auditoria CONCILIACAO_BANCARIA após processar', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ cnpj: CNPJ })

    const job = makeJob({
      modo: 'EMPRESA',
      tenantId: TENANT_ID,
      empresaId: EMPRESA_ID,
      competencia: COMP,
    })
    await bancarioJob(job)

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const call = mockAudit.registrar.mock.calls[0][0]
    expect(call.evento).toBe('CONCILIACAO_BANCARIA')
    expect(call.tenantId).toBe(TENANT_ID)
    expect(call.cnpj).toBe(CNPJ)
    expect(call.estadoNovo.competencia).toBe(COMP)
  })

  it('skip (sem erro) quando empresa não encontrada', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)

    const job = makeJob({
      modo: 'EMPRESA',
      tenantId: TENANT_ID,
      empresaId: EMPRESA_ID,
      competencia: COMP,
    })
    await bancarioJob(job)

    expect(mockOpenFinance.sincronizarContas).not.toHaveBeenCalled()
    expect(mockAudit.registrar).not.toHaveBeenCalled()
  })

  it('auditoria inclui jobId e modo no estadoNovo', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ cnpj: CNPJ })

    const job = makeJob(
      { modo: 'EMPRESA', tenantId: TENANT_ID, empresaId: EMPRESA_ID, competencia: COMP },
      'job-xyz'
    )
    await bancarioJob(job)

    const call = mockAudit.registrar.mock.calls[0][0]
    expect(call.estadoNovo.jobId).toBe('job-xyz')
    expect(call.estadoNovo.modo).toBe('EMPRESA')
  })
})

// ===========================================================================
// modo BATCH_TENANT
// ===========================================================================

describe('bancarioJob — modo BATCH_TENANT', () => {
  it('busca empresas ativas do tenant com tenantId e ativa=true', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([])

    const job = makeJob({ modo: 'BATCH_TENANT', tenantId: TENANT_ID, competencia: COMP })
    await bancarioJob(job)

    const { where } = mockDb.empresaCliente.findMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.ativa).toBe(true)
  })

  it('processa todas as empresas do lote', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-1', cnpj: '11111111000111' },
      { id: 'emp-2', cnpj: '22222222000122' },
    ])
    mockDb.empresaCliente.findUnique
      .mockResolvedValueOnce({ cnpj: '11111111000111' })
      .mockResolvedValueOnce({ cnpj: '22222222000122' })

    const job = makeJob({ modo: 'BATCH_TENANT', tenantId: TENANT_ID, competencia: COMP })
    await bancarioJob(job)

    expect(mockOpenFinance.sincronizarContas).toHaveBeenCalledTimes(2)
    expect(mockAudit.registrar).toHaveBeenCalledTimes(2)
  })

  it('erro em uma empresa não impede as demais (Promise.allSettled)', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-ok', cnpj: '11111111000111' },
      { id: 'emp-fail', cnpj: '99999999000199' },
    ])
    mockDb.empresaCliente.findUnique
      .mockResolvedValueOnce({ cnpj: '11111111000111' })
      .mockResolvedValueOnce({ cnpj: '99999999000199' })

    mockOpenFinance.sincronizarContas
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('timeout'))

    const job = makeJob({ modo: 'BATCH_TENANT', tenantId: TENANT_ID, competencia: COMP })
    await expect(bancarioJob(job)).resolves.not.toThrow()
  })

  it('loga contagem de ok e erros ao final', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([{ id: 'emp-1', cnpj: '11111111000111' }])
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ cnpj: '11111111000111' })

    const job = makeJob({ modo: 'BATCH_TENANT', tenantId: TENANT_ID, competencia: COMP })
    await bancarioJob(job)

    const logCalls = job.log.mock.calls.map((c: string[]) => c[0])
    const finalLog = logCalls.find((l: string) => l.includes('concluído'))
    expect(finalLog).toBeTruthy()
    expect(finalLog).toMatch(/ok=1/)
    expect(finalLog).toMatch(/erros=0/)
  })

  it('erro em empresa → contagem ok=1 erros=1 no log final', async () => {
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([
      { id: 'emp-ok', cnpj: '11111111000111' },
      { id: 'emp-fail', cnpj: '99999999000199' },
    ])
    mockDb.empresaCliente.findUnique
      .mockResolvedValueOnce({ cnpj: '11111111000111' })
      .mockResolvedValueOnce({ cnpj: '99999999000199' })

    mockOpenFinance.sincronizarContas
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('timeout'))

    const job = makeJob({ modo: 'BATCH_TENANT', tenantId: TENANT_ID, competencia: COMP })
    await bancarioJob(job)

    const logCalls = job.log.mock.calls.map((c: string[]) => c[0])
    const finalLog = logCalls.find((l: string) => l.includes('concluído'))
    expect(finalLog).toMatch(/ok=1/)
    expect(finalLog).toMatch(/erros=1/)
  })
})

// ===========================================================================
// modo BATCH_GLOBAL
// ===========================================================================

describe('bancarioJob — modo BATCH_GLOBAL', () => {
  it('busca tenants ativos', async () => {
    mockDb.tenant.findMany.mockResolvedValueOnce([])

    const job = makeJob({ modo: 'BATCH_GLOBAL' })
    await bancarioJob(job)

    expect(mockDb.tenant.findMany).toHaveBeenCalledWith({
      where: { ativo: true },
      select: { id: true, subdominio: true },
    })
  })

  it('usa competência do mês atual via formatCompetencia(nowBR())', async () => {
    mockDb.tenant.findMany.mockResolvedValueOnce([{ id: 't-1', subdominio: 'acme' }])
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([{ id: EMPRESA_ID, cnpj: CNPJ }])
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ cnpj: CNPJ })

    const job = makeJob({ modo: 'BATCH_GLOBAL' })
    await bancarioJob(job)

    expect(mockBancaria.conciliar).toHaveBeenCalledWith('t-1', EMPRESA_ID, '2025-05')
  })

  it('sem tenants → não processa empresas', async () => {
    mockDb.tenant.findMany.mockResolvedValueOnce([])

    const job = makeJob({ modo: 'BATCH_GLOBAL' })
    await bancarioJob(job)

    expect(mockDb.empresaCliente.findMany).not.toHaveBeenCalled()
    expect(mockOpenFinance.sincronizarContas).not.toHaveBeenCalled()
  })

  it('loga por tenant e loga BATCH_GLOBAL concluído', async () => {
    mockDb.tenant.findMany.mockResolvedValueOnce([{ id: 't-1', subdominio: 'escritorio-acme' }])
    mockDb.empresaCliente.findMany.mockResolvedValueOnce([{ id: EMPRESA_ID, cnpj: CNPJ }])
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ cnpj: CNPJ })

    const job = makeJob({ modo: 'BATCH_GLOBAL' })
    await bancarioJob(job)

    const logCalls = job.log.mock.calls.map((c: string[]) => c[0])
    expect(logCalls.some((l: string) => l.includes('escritorio-acme'))).toBe(true)
    expect(logCalls.some((l: string) => l.includes('BATCH_GLOBAL concluído'))).toBe(true)
  })

  it('dois tenants → processa cada um com suas empresas', async () => {
    mockDb.tenant.findMany.mockResolvedValueOnce([
      { id: 't-1', subdominio: 'acme' },
      { id: 't-2', subdominio: 'xpto' },
    ])
    mockDb.empresaCliente.findMany
      .mockResolvedValueOnce([{ id: 'emp-t1', cnpj: '11111111000111' }])
      .mockResolvedValueOnce([{ id: 'emp-t2', cnpj: '22222222000122' }])
    mockDb.empresaCliente.findUnique
      .mockResolvedValueOnce({ cnpj: '11111111000111' })
      .mockResolvedValueOnce({ cnpj: '22222222000122' })

    const job = makeJob({ modo: 'BATCH_GLOBAL' })
    await bancarioJob(job)

    expect(mockOpenFinance.sincronizarContas).toHaveBeenCalledTimes(2)
    expect(mockOpenFinance.sincronizarContas).toHaveBeenCalledWith('t-1', 'emp-t1')
    expect(mockOpenFinance.sincronizarContas).toHaveBeenCalledWith('t-2', 'emp-t2')
  })
})
