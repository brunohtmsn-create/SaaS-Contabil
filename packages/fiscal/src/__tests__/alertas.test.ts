/**
 * Testes unitários — AlertasVencimentosService
 *
 * Cobre:
 *  verificarProximosVencimentos():
 *   - sem obrigações pendentes na janela → retorna array vazio e não cria alertas
 *   - obrigação pendente SEM alerta existente → cria alerta VENCIMENTO_OBRIGACAO
 *   - obrigação pendente COM alerta já criado (não lido) → não duplica alerta
 *   - alerta criado contém tipo, competência, vencimento, diasRestantes e CNPJ
 *   - dias restantes calculado corretamente (arredondamento para cima)
 *   - inclui tenantId no filtro de obrigações
 *
 *  marcarComoEnviado():
 *   - alerta não encontrado → lança erro
 *   - alerta encontrado → atualiza lido=true e registra audit trail
 *   - valida tenantId no findFirst (segurança multi-tenant)
 *
 * PrismaClient e AuditService são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (devem vir ANTES dos imports do serviço)
// ---------------------------------------------------------------------------

const mockDb = {
  obrigacao: { findMany: vi.fn() },
  alerta: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
}

const mockAudit = { registrar: vi.fn().mockResolvedValue(undefined) }

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

// nowBR() deve retornar data fixa; addDays deve funcionar normalmente
const BASE_DATE = new Date('2025-01-10T12:00:00.000Z')

vi.mock('@saas-contabil/shared', () => ({
  nowBR: vi.fn(() => BASE_DATE),
  addDays: vi.fn((date: Date, days: number) => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    return d
  }),
}))

import { AlertasVencimentosService } from '../alertas-vencimentos.service.js'

// ---------------------------------------------------------------------------
// Reset entre testes
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.alerta.create.mockResolvedValue({
    id: 'alerta-1',
    tipo: 'VENCIMENTO_OBRIGACAO',
    mensagem: 'mock',
    dados: {},
    lido: false,
  })
  mockDb.alerta.findFirst.mockResolvedValue(null)
  mockDb.alerta.update.mockResolvedValue({ id: 'alerta-1', lido: true })
  mockDb.obrigacao.findMany.mockResolvedValue([])
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const empresa = { cnpj: '11111111000111', razaoSocial: 'Acme LTDA' }

function makeObrigacao(id: string, vencimentoDias: number) {
  const venc = new Date(BASE_DATE)
  venc.setDate(venc.getDate() + vencimentoDias)
  return {
    id,
    tipo: 'DAS',
    competencia: '2025-01',
    empresaId: 'emp-1',
    vencimento: venc,
    empresa,
  }
}

// ===========================================================================
// verificarProximosVencimentos()
// ===========================================================================

describe('AlertasVencimentosService — verificarProximosVencimentos()', () => {
  it('sem obrigações pendentes → retorna array vazio', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([])
    const service = new AlertasVencimentosService()
    const result = await service.verificarProximosVencimentos('t-1', 7)
    expect(result).toHaveLength(0)
    expect(mockDb.alerta.create).not.toHaveBeenCalled()
  })

  it('obrigação pendente sem alerta existente → cria alerta', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([makeObrigacao('ob-1', 5)])
    mockDb.alerta.findFirst.mockResolvedValueOnce(null)
    mockDb.alerta.create.mockResolvedValueOnce({
      id: 'al-1',
      tipo: 'VENCIMENTO_OBRIGACAO',
      mensagem: 'DAS vence em 5 dias',
      dados: {},
      lido: false,
    })

    const service = new AlertasVencimentosService()
    const result = await service.verificarProximosVencimentos('t-1', 7)

    expect(result).toHaveLength(1)
    expect(mockDb.alerta.create).toHaveBeenCalledTimes(1)
  })

  it('obrigação pendente com alerta já criado → não duplica', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([makeObrigacao('ob-1', 3)])
    mockDb.alerta.findFirst.mockResolvedValueOnce({ id: 'alerta-existente', lido: false })

    const service = new AlertasVencimentosService()
    const result = await service.verificarProximosVencimentos('t-1', 7)

    expect(result).toHaveLength(0)
    expect(mockDb.alerta.create).not.toHaveBeenCalled()
  })

  it('alerta criado tem tipo VENCIMENTO_OBRIGACAO', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([makeObrigacao('ob-1', 3)])
    mockDb.alerta.findFirst.mockResolvedValueOnce(null)

    const service = new AlertasVencimentosService()
    await service.verificarProximosVencimentos('t-1', 7)

    const createData = mockDb.alerta.create.mock.calls[0][0].data
    expect(createData.tipo).toBe('VENCIMENTO_OBRIGACAO')
  })

  it('alerta criado contém diasRestantes corretos nos dados', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([makeObrigacao('ob-1', 5)])
    mockDb.alerta.findFirst.mockResolvedValueOnce(null)

    const service = new AlertasVencimentosService()
    await service.verificarProximosVencimentos('t-1', 7)

    const dados = mockDb.alerta.create.mock.calls[0][0].data.dados
    expect(dados.diasRestantes).toBe(5)
  })

  it('alerta criado contém obrigacaoId, tipo e cnpj nos dados', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([makeObrigacao('ob-abc', 2)])
    mockDb.alerta.findFirst.mockResolvedValueOnce(null)

    const service = new AlertasVencimentosService()
    await service.verificarProximosVencimentos('t-1', 7)

    const dados = mockDb.alerta.create.mock.calls[0][0].data.dados
    expect(dados.obrigacaoId).toBe('ob-abc')
    expect(dados.tipo).toBe('DAS')
    expect(dados.cnpj).toBe('11111111000111')
  })

  it('query de obrigações inclui tenantId', async () => {
    const service = new AlertasVencimentosService()
    await service.verificarProximosVencimentos('t-xyz', 7)

    const whereQuery = mockDb.obrigacao.findMany.mock.calls[0][0].where
    expect(whereQuery.tenantId).toBe('t-xyz')
  })

  it('query filtra apenas PENDENTE e ATRASADA', async () => {
    const service = new AlertasVencimentosService()
    await service.verificarProximosVencimentos('t-1', 7)

    const whereQuery = mockDb.obrigacao.findMany.mock.calls[0][0].where
    expect(whereQuery.status.in).toContain('PENDENTE')
    expect(whereQuery.status.in).toContain('ATRASADA')
  })

  it('2 obrigações sem alerta → cria 2 alertas', async () => {
    mockDb.obrigacao.findMany.mockResolvedValueOnce([
      makeObrigacao('ob-1', 3),
      makeObrigacao('ob-2', 6),
    ])
    mockDb.alerta.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const service = new AlertasVencimentosService()
    const result = await service.verificarProximosVencimentos('t-1', 7)

    expect(result).toHaveLength(2)
    expect(mockDb.alerta.create).toHaveBeenCalledTimes(2)
  })
})

// ===========================================================================
// marcarComoEnviado()
// ===========================================================================

describe('AlertasVencimentosService — marcarComoEnviado()', () => {
  it('alerta não encontrado → lança erro', async () => {
    mockDb.alerta.findFirst.mockResolvedValueOnce(null)
    const service = new AlertasVencimentosService()
    await expect(service.marcarComoEnviado('al-x', 't-1')).rejects.toThrow('al-x')
  })

  it('alerta encontrado → atualiza lido=true', async () => {
    mockDb.alerta.findFirst.mockResolvedValueOnce({
      id: 'al-1',
      tipo: 'VENCIMENTO_OBRIGACAO',
      dados: { cnpj: '11111111000111' },
    })

    const service = new AlertasVencimentosService()
    await service.marcarComoEnviado('al-1', 't-1')

    expect(mockDb.alerta.update).toHaveBeenCalledWith({
      where: { id: 'al-1' },
      data: { lido: true },
    })
  })

  it('após marcar enviado → registra evento ALERTA_MARCADO_ENVIADO no audit', async () => {
    mockDb.alerta.findFirst.mockResolvedValueOnce({
      id: 'al-1',
      tipo: 'VENCIMENTO_OBRIGACAO',
      dados: { cnpj: '11111111000111' },
    })

    const service = new AlertasVencimentosService()
    await service.marcarComoEnviado('al-1', 't-1')

    expect(mockAudit.registrar).toHaveBeenCalledTimes(1)
    expect(mockAudit.registrar.mock.calls[0][0].evento).toBe('ALERTA_MARCADO_ENVIADO')
  })

  it('validação de tenantId no findFirst', async () => {
    mockDb.alerta.findFirst.mockResolvedValueOnce(null)
    const service = new AlertasVencimentosService()
    try {
      await service.marcarComoEnviado('al-1', 't-abc')
    } catch {}
    const findFirstArgs = mockDb.alerta.findFirst.mock.calls[0][0]
    expect(findFirstArgs.where.tenantId).toBe('t-abc')
  })
})
