/**
 * Testes unitários — PortalOrchestrator
 *
 * Cobre:
 *  executar():
 *   - ECAC:CONSULTA_SITUACAO → chama ecac.consultarSituacaoFiscal()
 *   - ECAC:CERTIDAO → chama ecac.baixarCertidao()
 *   - SIMPLES_NACIONAL:TRANSMITIR_PGDAS → chama simplesnacional.transmitirPGDAS()
 *   - operação desconhecida → lança erro com mensagem descritiva
 *   - sucesso → cria job com status EM_EXECUCAO e atualiza para CONCLUIDO
 *   - falha → atualiza portalJob para status ERRO e relança o erro
 *   - cria portalJob com tenantId, empresaId, cnpj e credencialId corretos
 *   - prioridade corretamente propagada
 *   - competencia propagada para baixarCertidao
 *   - dados propagados para transmitirPGDAS
 *
 * EcacPortal, SimplesNacionalPortal e PrismaClient são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (antes dos imports do serviço)
// ---------------------------------------------------------------------------

const mockEcac = {
  consultarSituacaoFiscal: vi.fn(),
  baixarCertidao: vi.fn(),
}

const mockSimples = {
  transmitirPGDAS: vi.fn(),
}

vi.mock('../ecac.portal.js', () => ({
  EcacPortal: vi.fn(() => mockEcac),
}))

vi.mock('../simples-nacional.portal.js', () => ({
  SimplesNacionalPortal: vi.fn(() => mockSimples),
}))

const mockDb = {
  portalJob: {
    create: vi.fn(),
    update: vi.fn(),
  },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { PortalOrchestrator } from '../portal-orchestrator.js'

// ---------------------------------------------------------------------------
// Reset entre testes
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.portalJob.create.mockResolvedValue({ id: 'job-db-1' })
  mockDb.portalJob.update.mockResolvedValue({})
  mockEcac.consultarSituacaoFiscal.mockResolvedValue({ situacao: 'REGULAR', pendencias: [] })
  mockEcac.baixarCertidao.mockResolvedValue('portais/certidao-2025-01.pdf')
  mockSimples.transmitirPGDAS.mockResolvedValue('PGDAS-RECIBO-001')
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJob(portal: string, operacao: string, extra?: object) {
  return {
    tenantId: 't-1',
    empresaId: 'emp-1',
    cnpj: '11111111000111',
    credencialId: 'cred-1',
    portal,
    operacao,
    prioridade: 2 as const,
    ...extra,
  }
}

const CRED_BUF = Buffer.from('fake-cert')

// ===========================================================================
// PortalOrchestrator — roteamento
// ===========================================================================

describe('PortalOrchestrator — roteamento de operações', () => {
  it('ECAC:CONSULTA_SITUACAO → chama consultarSituacaoFiscal', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('ECAC', 'CONSULTA_SITUACAO'), CRED_BUF)
    expect(mockEcac.consultarSituacaoFiscal).toHaveBeenCalledTimes(1)
    expect(mockEcac.consultarSituacaoFiscal).toHaveBeenCalledWith('t-1', 'emp-1', '11111111000111', CRED_BUF)
  })

  it('ECAC:CERTIDAO → chama baixarCertidao com competencia', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('ECAC', 'CERTIDAO', { competencia: '2025-01' }), CRED_BUF)
    expect(mockEcac.baixarCertidao).toHaveBeenCalledWith('t-1', 'emp-1', '11111111000111', CRED_BUF, '2025-01')
  })

  it('ECAC:CERTIDAO sem competencia → passa string vazia', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('ECAC', 'CERTIDAO'), CRED_BUF)
    expect(mockEcac.baixarCertidao).toHaveBeenCalledWith('t-1', 'emp-1', '11111111000111', CRED_BUF, '')
  })

  it('SIMPLES_NACIONAL:TRANSMITIR_PGDAS → chama transmitirPGDAS', async () => {
    const dados = { receita: '10000' }
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('SIMPLES_NACIONAL', 'TRANSMITIR_PGDAS', { competencia: '2025-01', dados }), CRED_BUF)
    expect(mockSimples.transmitirPGDAS).toHaveBeenCalledWith('t-1', 'emp-1', '11111111000111', '2025-01', dados)
  })

  it('operação desconhecida → lança erro com nome da operação', async () => {
    const orch = new PortalOrchestrator()
    await expect(orch.executar(makeJob('ECAC', 'OPERACAO_INEXISTENTE'), CRED_BUF)).rejects.toThrow(
      'ECAC:OPERACAO_INEXISTENTE'
    )
  })

  it('portal desconhecido → lança erro', async () => {
    const orch = new PortalOrchestrator()
    await expect(orch.executar(makeJob('PORTAL_FANTASMA', 'QUALQUER'), CRED_BUF)).rejects.toThrow()
  })
})

// ===========================================================================
// PortalOrchestrator — persistência no banco
// ===========================================================================

describe('PortalOrchestrator — persistência portalJob', () => {
  it('sucesso → cria job com status EM_EXECUCAO', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('ECAC', 'CONSULTA_SITUACAO'), CRED_BUF)
    const createData = mockDb.portalJob.create.mock.calls[0][0].data
    expect(createData.status).toBe('EM_EXECUCAO')
  })

  it('sucesso → atualiza job para CONCLUIDO', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('ECAC', 'CONSULTA_SITUACAO'), CRED_BUF)
    const updateData = mockDb.portalJob.update.mock.calls[0][0].data
    expect(updateData.status).toBe('CONCLUIDO')
  })

  it('falha → atualiza job para ERRO', async () => {
    mockEcac.consultarSituacaoFiscal.mockRejectedValueOnce(new Error('timeout'))
    const orch = new PortalOrchestrator()
    await expect(orch.executar(makeJob('ECAC', 'CONSULTA_SITUACAO'), CRED_BUF)).rejects.toThrow('timeout')
    const updateData = mockDb.portalJob.update.mock.calls[0][0].data
    expect(updateData.status).toBe('ERRO')
  })

  it('falha → propaga o erro original', async () => {
    mockEcac.consultarSituacaoFiscal.mockRejectedValueOnce(new Error('CAPTCHA falhou'))
    const orch = new PortalOrchestrator()
    await expect(orch.executar(makeJob('ECAC', 'CONSULTA_SITUACAO'), CRED_BUF)).rejects.toThrow('CAPTCHA falhou')
  })

  it('cria job com tenantId e empresaId corretos', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('ECAC', 'CONSULTA_SITUACAO'), CRED_BUF)
    const createData = mockDb.portalJob.create.mock.calls[0][0].data
    expect(createData.tenantId).toBe('t-1')
    expect(createData.empresaId).toBe('emp-1')
    expect(createData.cnpj).toBe('11111111000111')
  })

  it('cria job com credencialId correto', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('ECAC', 'CONSULTA_SITUACAO'), CRED_BUF)
    const createData = mockDb.portalJob.create.mock.calls[0][0].data
    expect(createData.credencialId).toBe('cred-1')
  })

  it('cria job com prioridade propagada', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar({ ...makeJob('ECAC', 'CONSULTA_SITUACAO'), prioridade: 1 }, CRED_BUF)
    const createData = mockDb.portalJob.create.mock.calls[0][0].data
    expect(createData.prioridade).toBe(1)
  })

  it('sucesso → resultado é armazenado no update', async () => {
    mockEcac.consultarSituacaoFiscal.mockResolvedValueOnce({ situacao: 'REGULAR', pendencias: [] })
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('ECAC', 'CONSULTA_SITUACAO'), CRED_BUF)
    const updateData = mockDb.portalJob.update.mock.calls[0][0].data
    expect(updateData.resultado).toMatchObject({ situacao: 'REGULAR' })
  })

  it('update usa o id retornado pelo create', async () => {
    mockDb.portalJob.create.mockResolvedValueOnce({ id: 'job-xyz' })
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('ECAC', 'CONSULTA_SITUACAO'), CRED_BUF)
    const updateWhere = mockDb.portalJob.update.mock.calls[0][0].where
    expect(updateWhere.id).toBe('job-xyz')
  })
})
