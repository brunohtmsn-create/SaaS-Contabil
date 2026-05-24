/**
 * Testes unitários — monitoramentoDiario
 *
 * Cobre:
 *  - Busca todos os tenants ativos
 *  - Para cada tenant: chama alertasService.verificarProximosVencimentos(tenantId, 7)
 *  - Para cada alerta retornado: chama notificacao.notificarTenant()
 *  - Sem tenants → nenhuma notificação
 *  - Tenant sem alertas → nenhuma notificação para aquele tenant
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted garante que as referências estejam disponíveis quando
// vi.mock (que é hoisted) executar as factories.
// ---------------------------------------------------------------------------

const { mockDb, mockAlertasService, mockNotificacao } = vi.hoisted(() => ({
  mockDb: { tenant: { findMany: vi.fn() } },
  mockAlertasService: { verificarProximosVencimentos: vi.fn() },
  mockNotificacao: { notificarTenant: vi.fn().mockResolvedValue(undefined) },
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

import { monitoramentoDiario } from '../jobs/monitoramento.job.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockAlerta1 = { id: 'alert-1', mensagem: 'DAS vence em 5 dias' }
const mockAlerta2 = { id: 'alert-2', mensagem: 'EFD-Reinf vence em 3 dias' }

function makeJob() {
  return { log: vi.fn().mockResolvedValue(undefined) } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockAlertasService.verificarProximosVencimentos.mockResolvedValue([])
  mockNotificacao.notificarTenant.mockResolvedValue(undefined)
})

describe('monitoramentoDiario', () => {
  it('busca tenants com ativo=true', async () => {
    mockDb.tenant.findMany.mockResolvedValue([])
    await monitoramentoDiario(makeJob())
    expect(mockDb.tenant.findMany).toHaveBeenCalledWith({ where: { ativo: true } })
  })

  it('sem tenants → nenhuma verificação de alertas', async () => {
    mockDb.tenant.findMany.mockResolvedValue([])
    await monitoramentoDiario(makeJob())
    expect(mockAlertasService.verificarProximosVencimentos).not.toHaveBeenCalled()
  })

  it('um tenant → chama verificarProximosVencimentos com tenantId e 7 dias', async () => {
    mockDb.tenant.findMany.mockResolvedValue([{ id: 't-1', subdominio: 'acme' }])
    await monitoramentoDiario(makeJob())
    expect(mockAlertasService.verificarProximosVencimentos).toHaveBeenCalledWith('t-1', 7)
  })

  it('tenant com alertas → notifica para cada alerta', async () => {
    mockDb.tenant.findMany.mockResolvedValue([{ id: 't-1', subdominio: 'acme' }])
    mockAlertasService.verificarProximosVencimentos.mockResolvedValue([mockAlerta1, mockAlerta2])
    await monitoramentoDiario(makeJob())
    expect(mockNotificacao.notificarTenant).toHaveBeenCalledTimes(2)
    expect(mockNotificacao.notificarTenant).toHaveBeenCalledWith('t-1', 'VENCIMENTO_PROXIMO', {
      alertaId: 'alert-1',
      mensagem: 'DAS vence em 5 dias',
    })
    expect(mockNotificacao.notificarTenant).toHaveBeenCalledWith('t-1', 'VENCIMENTO_PROXIMO', {
      alertaId: 'alert-2',
      mensagem: 'EFD-Reinf vence em 3 dias',
    })
  })

  it('tenant sem alertas → não notifica', async () => {
    mockDb.tenant.findMany.mockResolvedValue([{ id: 't-1', subdominio: 'acme' }])
    mockAlertasService.verificarProximosVencimentos.mockResolvedValue([])
    await monitoramentoDiario(makeJob())
    expect(mockNotificacao.notificarTenant).not.toHaveBeenCalled()
  })

  it('dois tenants → processa ambos independentemente', async () => {
    mockDb.tenant.findMany.mockResolvedValue([
      { id: 't-1', subdominio: 'acme' },
      { id: 't-2', subdominio: 'xpto' },
    ])
    mockAlertasService.verificarProximosVencimentos
      .mockResolvedValueOnce([mockAlerta1])
      .mockResolvedValueOnce([])
    await monitoramentoDiario(makeJob())
    expect(mockAlertasService.verificarProximosVencimentos).toHaveBeenCalledTimes(2)
    expect(mockNotificacao.notificarTenant).toHaveBeenCalledTimes(1)
    expect(mockNotificacao.notificarTenant.mock.calls[0][0]).toBe('t-1')
  })
})
