/**
 * Testes unitários — scraperJob
 *
 * Cobre:
 *  - NFE → chama orchestrator.capturarNFe()
 *  - NFCE → chama orchestrator.capturarNFCe()
 *  - NFSE → chama orchestrator.capturarNFSe() e combina emitidas + tomadas
 *  - TODOS → chama orchestrator.capturarTodos() e combina todos os arrays
 *  - Cada documento capturado é passado para normalizer.normalizar()
 *  - Erro em retrieve → não chama orchestrator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const FAKE_CRED = { id: 'cred-1', data: Buffer.from('cert') }
const mockCredService = { retrieve: vi.fn().mockResolvedValue(FAKE_CRED) }
const mockNormalizer = { normalizar: vi.fn().mockResolvedValue(true) }
const mockOrchestrator = {
  capturarNFe: vi.fn().mockResolvedValue([{ id: 'nfe-1' }, { id: 'nfe-2' }]),
  capturarNFCe: vi.fn().mockResolvedValue([{ id: 'nfce-1' }]),
  capturarNFSe: vi.fn().mockResolvedValue({
    emitidas: [{ id: 'nfse-e-1' }],
    tomadas: [{ id: 'nfse-t-1' }, { id: 'nfse-t-2' }],
  }),
  capturarTodos: vi.fn().mockResolvedValue({
    nfe: [{ id: 'nfe-t' }],
    nfce: [{ id: 'nfce-t' }],
    nfseEmitidas: [{ id: 'nfse-e-t' }],
    nfseTomadas: [{ id: 'nfse-tomada-t' }],
  }),
}

vi.mock('@saas-contabil/credentials', () => ({
  CredentialService: vi.fn(() => mockCredService),
}))
vi.mock('@saas-contabil/normalizer', () => ({
  NormalizerService: vi.fn(() => mockNormalizer),
}))
vi.mock('@saas-contabil/scraper', () => ({
  ScraperOrchestrator: vi.fn(() => mockOrchestrator),
}))

import { scraperJob } from '../jobs/scraper.job.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(tipo: string) {
  return {
    data: {
      tenantId: 't-1',
      empresaId: 'emp-1',
      cnpj: '11111111000111',
      competencia: '2025-01',
      credencialId: 'cred-1',
      tipo,
    },
    log: vi.fn().mockResolvedValue(undefined),
  } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => vi.clearAllMocks())

describe('scraperJob — roteamento', () => {
  it('NFE → chama capturarNFe com cnpj, competencia e credencial', async () => {
    const job = makeJob('NFE')
    await scraperJob(job)
    expect(mockOrchestrator.capturarNFe).toHaveBeenCalledWith('11111111000111', '2025-01', FAKE_CRED)
    expect(mockOrchestrator.capturarNFCe).not.toHaveBeenCalled()
  })

  it('NFCE → chama capturarNFCe', async () => {
    await scraperJob(makeJob('NFCE'))
    expect(mockOrchestrator.capturarNFCe).toHaveBeenCalledWith('11111111000111', '2025-01', FAKE_CRED)
  })

  it('NFSE → chama capturarNFSe e combina emitidas + tomadas', async () => {
    await scraperJob(makeJob('NFSE'))
    expect(mockOrchestrator.capturarNFSe).toHaveBeenCalledOnce()
    // 3 documentos no total (1 emitida + 2 tomadas)
    expect(mockNormalizer.normalizar).toHaveBeenCalledTimes(3)
  })

  it('TODOS → chama capturarTodos e combina todos os arrays', async () => {
    await scraperJob(makeJob('TODOS'))
    expect(mockOrchestrator.capturarTodos).toHaveBeenCalledOnce()
    // 4 documentos total
    expect(mockNormalizer.normalizar).toHaveBeenCalledTimes(4)
  })
})

describe('scraperJob — normalização', () => {
  it('NFE — normaliza cada documento capturado com tenantId e empresaId', async () => {
    await scraperJob(makeJob('NFE'))
    // 2 NF-e capturadas
    expect(mockNormalizer.normalizar).toHaveBeenCalledTimes(2)
    for (const call of mockNormalizer.normalizar.mock.calls) {
      expect(call[1]).toBe('t-1')
      expect(call[2]).toBe('emp-1')
    }
  })

  it('normalizar retorna null (duplicata) → ainda continua para o próximo', async () => {
    mockNormalizer.normalizar
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(true)
    const job = makeJob('NFE')
    await expect(scraperJob(job)).resolves.not.toThrow()
    expect(mockNormalizer.normalizar).toHaveBeenCalledTimes(2)
  })
})

describe('scraperJob — erros', () => {
  it('erro em retrieve → não chama orchestrator', async () => {
    mockCredService.retrieve.mockRejectedValueOnce(new Error('Credencial revogada'))
    await expect(scraperJob(makeJob('NFE'))).rejects.toThrow('Credencial revogada')
    expect(mockOrchestrator.capturarNFe).not.toHaveBeenCalled()
  })

  it('erro em capturarNFe → propaga o erro', async () => {
    mockOrchestrator.capturarNFe.mockRejectedValueOnce(new Error('Timeout SEFAZ'))
    await expect(scraperJob(makeJob('NFE'))).rejects.toThrow('Timeout SEFAZ')
  })
})
