/**
 * Testes unitários — monitoramentoDiario
 *
 * Cobre:
 *  - Busca todos os tenants ativos
 *  - Verifica vencimentos de obrigações (7 dias) e notifica
 *  - Atualiza status de credenciais vencidas
 *  - Cria alertas para credenciais vencendo (30 dias)
 *  - Cria alertas para documentos PENDENTE_REVISAO >48h
 *  - Cria alertas de PGDAS pendente (dias 15–19)
 *  - Sem tenants → nenhuma ação
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockDb, mockAlertasService, mockNotificacao, mockCredService } = vi.hoisted(() => ({
  mockDb: {
    tenant: { findMany: vi.fn() },
    alerta: { findFirst: vi.fn(), create: vi.fn() },
    documentoFiscal: { count: vi.fn() },
    apuracaoFiscal: { count: vi.fn() },
  },
  mockAlertasService: { verificarProximosVencimentos: vi.fn() },
  mockNotificacao: { notificarTenant: vi.fn() },
  mockCredService: {
    updateExpiredStatuses: vi.fn(),
    checkExpiring: vi.fn(),
  },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/fiscal', () => ({
  AlertasVencimentosService: vi.fn(() => mockAlertasService),
}))

vi.mock('@saas-contabil/notifications', () => ({
  NotificationService: vi.fn(() => mockNotificacao),
}))

vi.mock('@saas-contabil/credentials', () => ({
  CredentialService: vi.fn(() => mockCredService),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    nowBR: vi.fn(() => new Date('2025-06-17T12:00:00Z')),
    addDays: vi.fn((date: Date, n: number) => {
      const d = new Date(date)
      d.setDate(d.getDate() + n)
      return d
    }),
  }
})

import { monitoramentoDiario } from '../jobs/monitoramento.job.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_1 = { id: 't-1', subdominio: 'acme' }
const TENANT_2 = { id: 't-2', subdominio: 'xpto' }

const mockAlerta1 = { id: 'alert-1', mensagem: 'DAS vence em 5 dias' }
const mockAlerta2 = { id: 'alert-2', mensagem: 'EFD-Reinf vence em 3 dias' }

const CRED_VENCENDO = {
  id: 'cred-1',
  empresaId: 'emp-1',
  tipo: 'CERTIFICADO_A1',
  cnpj: '12345678000195',
  validade: new Date('2025-07-10'),
}

function makeJob() {
  return { log: vi.fn().mockResolvedValue(undefined) } as any
}

// ---------------------------------------------------------------------------
// Default mocks reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockAlertasService.verificarProximosVencimentos.mockResolvedValue([])
  mockNotificacao.notificarTenant.mockResolvedValue(undefined)
  mockCredService.updateExpiredStatuses.mockResolvedValue(0)
  mockCredService.checkExpiring.mockResolvedValue([])
  mockDb.alerta.findFirst.mockResolvedValue(null)
  mockDb.alerta.create.mockResolvedValue({ id: 'new-alerta' })
  mockDb.documentoFiscal.count.mockResolvedValue(0)
  mockDb.apuracaoFiscal.count.mockResolvedValue(0)
})

// ===========================================================================
// Verificação de tenants
// ===========================================================================

describe('monitoramentoDiario — tenants', () => {
  it('busca tenants com ativo=true', async () => {
    mockDb.tenant.findMany.mockResolvedValue([])
    await monitoramentoDiario(makeJob())
    expect(mockDb.tenant.findMany).toHaveBeenCalledWith({ where: { ativo: true } })
  })

  it('sem tenants → nenhuma verificação de alertas', async () => {
    mockDb.tenant.findMany.mockResolvedValue([])
    await monitoramentoDiario(makeJob())
    expect(mockAlertasService.verificarProximosVencimentos).not.toHaveBeenCalled()
    expect(mockCredService.updateExpiredStatuses).not.toHaveBeenCalled()
  })

  it('dois tenants → processa ambos', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1, TENANT_2])
    await monitoramentoDiario(makeJob())
    expect(mockAlertasService.verificarProximosVencimentos).toHaveBeenCalledTimes(2)
  })
})

// ===========================================================================
// Vencimentos de obrigações
// ===========================================================================

describe('monitoramentoDiario — vencimentos', () => {
  it('chama verificarProximosVencimentos com tenantId e 7 dias', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    await monitoramentoDiario(makeJob())
    expect(mockAlertasService.verificarProximosVencimentos).toHaveBeenCalledWith('t-1', 7)
  })

  it('notifica para cada alerta de vencimento criado', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    mockAlertasService.verificarProximosVencimentos.mockResolvedValue([mockAlerta1, mockAlerta2])

    await monitoramentoDiario(makeJob())

    expect(mockNotificacao.notificarTenant).toHaveBeenCalledWith('t-1', 'VENCIMENTO_PROXIMO', {
      alertaId: 'alert-1',
      mensagem: 'DAS vence em 5 dias',
    })
    expect(mockNotificacao.notificarTenant).toHaveBeenCalledWith('t-1', 'VENCIMENTO_PROXIMO', {
      alertaId: 'alert-2',
      mensagem: 'EFD-Reinf vence em 3 dias',
    })
  })

  it('tenant sem alertas → não chama notificarTenant para vencimentos', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    mockAlertasService.verificarProximosVencimentos.mockResolvedValue([])
    await monitoramentoDiario(makeJob())
    expect(mockNotificacao.notificarTenant).not.toHaveBeenCalledWith(
      't-1',
      'VENCIMENTO_PROXIMO',
      expect.anything()
    )
  })
})

// ===========================================================================
// Credenciais vencidas / vencendo
// ===========================================================================

describe('monitoramentoDiario — credenciais', () => {
  it('chama updateExpiredStatuses para cada tenant', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    await monitoramentoDiario(makeJob())
    expect(mockCredService.updateExpiredStatuses).toHaveBeenCalledWith('t-1')
  })

  it('chama checkExpiring com 30 dias de antecedência', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    await monitoramentoDiario(makeJob())
    expect(mockCredService.checkExpiring).toHaveBeenCalledWith('t-1', 30)
  })

  it('credencial vencendo sem alerta existente → cria alerta', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    mockCredService.checkExpiring.mockResolvedValue([CRED_VENCENDO])
    mockDb.alerta.findFirst.mockResolvedValue(null)

    await monitoramentoDiario(makeJob())

    expect(mockDb.alerta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipo: 'CREDENCIAL_VENCENDO',
          tenantId: 't-1',
          empresaId: 'emp-1',
        }),
      })
    )
  })

  it('alerta de credencial já existente → não cria duplicata', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    mockCredService.checkExpiring.mockResolvedValue([CRED_VENCENDO])
    mockDb.alerta.findFirst.mockResolvedValue({ id: 'alerta-existente' })

    await monitoramentoDiario(makeJob())

    // create não deve ter sido chamado para credencial (apenas alertas de outras categorias)
    const createCalls = mockDb.alerta.create.mock.calls.filter(
      (call: any) => call[0]?.data?.tipo === 'CREDENCIAL_VENCENDO'
    )
    expect(createCalls).toHaveLength(0)
  })

  it('sem credenciais vencendo → não cria alertas de credencial', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    mockCredService.checkExpiring.mockResolvedValue([])
    await monitoramentoDiario(makeJob())
    const createCalls = mockDb.alerta.create.mock.calls.filter(
      (call: any) => call[0]?.data?.tipo === 'CREDENCIAL_VENCENDO'
    )
    expect(createCalls).toHaveLength(0)
  })
})

// ===========================================================================
// Documentos pendentes de revisão >48h
// ===========================================================================

describe('monitoramentoDiario — documentos pendentes', () => {
  it('sem documentos pendentes → não cria alerta', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    mockDb.documentoFiscal.count.mockResolvedValue(0)
    await monitoramentoDiario(makeJob())
    const createCalls = mockDb.alerta.create.mock.calls.filter(
      (call: any) => call[0]?.data?.tipo === 'DIVERGENCIA_CONCILIACAO'
    )
    expect(createCalls).toHaveLength(0)
  })

  it('documentos pendentes >48h sem alerta existente → cria alerta', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    mockDb.documentoFiscal.count.mockResolvedValue(5)
    mockDb.alerta.findFirst.mockResolvedValue(null)

    await monitoramentoDiario(makeJob())

    const createCall = mockDb.alerta.create.mock.calls.find(
      (call: any) =>
        call[0]?.data?.tipo === 'DIVERGENCIA_CONCILIACAO' &&
        call[0]?.data?.dados?.tipo === 'DOCUMENTOS_PENDENTES_48H'
    )
    expect(createCall).toBeDefined()
    expect(createCall[0].data.mensagem).toContain('5')
  })
})

// ===========================================================================
// PGDAS pendente (dias 15–19)
// ===========================================================================

describe('monitoramentoDiario — PGDAS pendente', () => {
  it('dia 17 com PGDAS não transmitidos → cria alerta', async () => {
    // nowBR é mockado para 2025-06-17 (dia 17) — dentro da janela 15-19
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    mockDb.apuracaoFiscal.count.mockResolvedValue(3)
    mockDb.alerta.findFirst.mockResolvedValue(null)

    await monitoramentoDiario(makeJob())

    const pgdasCall = mockDb.alerta.create.mock.calls.find(
      (call: any) => call[0]?.data?.tipo === 'PGDAS_PENDENTE'
    )
    expect(pgdasCall).toBeDefined()
    expect(pgdasCall[0].data.mensagem).toContain('3')
  })

  it('alerta PGDAS já existente → não duplica', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    mockDb.apuracaoFiscal.count.mockResolvedValue(3)
    mockDb.alerta.findFirst.mockResolvedValue({ id: 'pgdas-alerta-existente' })

    await monitoramentoDiario(makeJob())

    const pgdasCalls = mockDb.alerta.create.mock.calls.filter(
      (call: any) => call[0]?.data?.tipo === 'PGDAS_PENDENTE'
    )
    expect(pgdasCalls).toHaveLength(0)
  })

  it('sem PGDAS pendentes → não cria alerta', async () => {
    mockDb.tenant.findMany.mockResolvedValue([TENANT_1])
    mockDb.apuracaoFiscal.count.mockResolvedValue(0)

    await monitoramentoDiario(makeJob())

    const pgdasCalls = mockDb.alerta.create.mock.calls.filter(
      (call: any) => call[0]?.data?.tipo === 'PGDAS_PENDENTE'
    )
    expect(pgdasCalls).toHaveLength(0)
  })
})
