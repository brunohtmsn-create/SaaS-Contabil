/**
 * Testes unitários — portalJob
 *
 * Cobre:
 *  - Recupera credencial via CredentialService.retrieve()
 *  - Chama PortalOrchestrator.executar() com os parâmetros corretos
 *  - Propaga dados do job (portal, operacao, prioridade, competencia, dados)
 *  - Erro em credService.retrieve → propaga o erro
 *  - Erro em orchestrator.executar → propaga o erro
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCred = { id: 'cred-1', data: Buffer.from('cert-data') }
const mockCredService = { retrieve: vi.fn().mockResolvedValue(mockCred) }
const mockOrchestrator = { executar: vi.fn().mockResolvedValue({ status: 'ok' }) }

vi.mock('@saas-contabil/credentials', () => ({
  CredentialService: vi.fn(() => mockCredService),
}))

vi.mock('@saas-contabil/portals', () => ({
  PortalOrchestrator: vi.fn(() => mockOrchestrator),
}))

import { portalJob } from '../jobs/portal.job.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(extra?: object) {
  return {
    data: {
      tenantId: 't-1',
      empresaId: 'emp-1',
      cnpj: '11111111000111',
      portal: 'ECAC',
      operacao: 'CONSULTA_SITUACAO',
      credencialId: 'cred-1',
      prioridade: 2,
      ...extra,
    },
  } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => vi.clearAllMocks())

describe('portalJob', () => {
  it('recupera credencial com credencialId e tenantId corretos', async () => {
    await portalJob(makeJob())
    expect(mockCredService.retrieve).toHaveBeenCalledWith('cred-1', 't-1')
  })

  it('chama orchestrator.executar com os dados do job', async () => {
    await portalJob(makeJob())
    expect(mockOrchestrator.executar).toHaveBeenCalledOnce()
    const [jobArg, credBuf] = mockOrchestrator.executar.mock.calls[0]
    expect(jobArg.tenantId).toBe('t-1')
    expect(jobArg.empresaId).toBe('emp-1')
    expect(jobArg.cnpj).toBe('11111111000111')
    expect(jobArg.portal).toBe('ECAC')
    expect(jobArg.operacao).toBe('CONSULTA_SITUACAO')
    expect(credBuf).toBe(mockCred.data)
  })

  it('propaga competencia para o orchestrator', async () => {
    await portalJob(makeJob({ competencia: '2025-01' }))
    const [jobArg] = mockOrchestrator.executar.mock.calls[0]
    expect(jobArg.competencia).toBe('2025-01')
  })

  it('propaga dados para o orchestrator', async () => {
    const dados = { receita: '50000' }
    await portalJob(makeJob({ dados }))
    const [jobArg] = mockOrchestrator.executar.mock.calls[0]
    expect(jobArg.dados).toEqual(dados)
  })

  it('propaga prioridade corretamente', async () => {
    await portalJob(makeJob({ prioridade: 1 }))
    const [jobArg] = mockOrchestrator.executar.mock.calls[0]
    expect(jobArg.prioridade).toBe(1)
  })

  it('erro em retrieve → propaga sem chamar orchestrator', async () => {
    mockCredService.retrieve.mockRejectedValueOnce(new Error('Credencial vencida'))
    await expect(portalJob(makeJob())).rejects.toThrow('Credencial vencida')
    expect(mockOrchestrator.executar).not.toHaveBeenCalled()
  })

  it('erro em orchestrator.executar → propaga o erro', async () => {
    mockOrchestrator.executar.mockRejectedValueOnce(new Error('CAPTCHA falhou'))
    await expect(portalJob(makeJob())).rejects.toThrow('CAPTCHA falhou')
  })
})
