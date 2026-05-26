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

const mockSefazSp = {
  transmitirDeSTDA: vi.fn(),
  emitirGNRE: vi.fn(),
  emitirGNRELote: vi.fn(),
}

vi.mock('../ecac.portal.js', () => ({
  EcacPortal: vi.fn(() => mockEcac),
}))

vi.mock('../simples-nacional.portal.js', () => ({
  SimplesNacionalPortal: vi.fn(() => mockSimples),
}))

vi.mock('../sefaz-sp.portal.js', () => ({
  SefazSpPortal: vi.fn(() => mockSefazSp),
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

vi.mock('@saas-contabil/shared', () => ({
  Decimal: class MockDecimal {
    private v: string
    constructor(v: string | number) {
      this.v = String(v)
    }
    toFixed(n: number) {
      return parseFloat(this.v).toFixed(n)
    }
  },
  nowBR: vi.fn(() => new Date('2025-01-01T10:00:00Z')),
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
  mockSefazSp.transmitirDeSTDA.mockResolvedValue({
    protocolo: 'PROTO-001',
    recibo: 'DESTDA-SP-001',
    dataTransmissao: new Date(),
  })
  mockSefazSp.emitirGNRE.mockResolvedValue({
    numeroGuia: 'GNRE-001',
    uf: 'SP',
    codigoBarras: '12345.67890',
    vencimento: new Date(),
    pdfKey: 'gnre/sp.pdf',
  })
  mockSefazSp.emitirGNRELote.mockResolvedValue([])
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
    expect(mockEcac.consultarSituacaoFiscal).toHaveBeenCalledWith(
      't-1',
      'emp-1',
      '11111111000111',
      CRED_BUF
    )
  })

  it('ECAC:CERTIDAO → chama baixarCertidao com competencia', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('ECAC', 'CERTIDAO', { competencia: '2025-01' }), CRED_BUF)
    expect(mockEcac.baixarCertidao).toHaveBeenCalledWith(
      't-1',
      'emp-1',
      '11111111000111',
      CRED_BUF,
      '2025-01'
    )
  })

  it('ECAC:CERTIDAO sem competencia → passa string vazia', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('ECAC', 'CERTIDAO'), CRED_BUF)
    expect(mockEcac.baixarCertidao).toHaveBeenCalledWith(
      't-1',
      'emp-1',
      '11111111000111',
      CRED_BUF,
      ''
    )
  })

  it('SIMPLES_NACIONAL:TRANSMITIR_PGDAS → chama transmitirPGDAS', async () => {
    const dados = { receita: '10000' }
    const orch = new PortalOrchestrator()
    await orch.executar(
      makeJob('SIMPLES_NACIONAL', 'TRANSMITIR_PGDAS', { competencia: '2025-01', dados }),
      CRED_BUF
    )
    expect(mockSimples.transmitirPGDAS).toHaveBeenCalledWith(
      't-1',
      'emp-1',
      '11111111000111',
      '2025-01',
      dados
    )
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
    await expect(orch.executar(makeJob('ECAC', 'CONSULTA_SITUACAO'), CRED_BUF)).rejects.toThrow(
      'timeout'
    )
    const updateData = mockDb.portalJob.update.mock.calls[0][0].data
    expect(updateData.status).toBe('ERRO')
  })

  it('falha → propaga o erro original', async () => {
    mockEcac.consultarSituacaoFiscal.mockRejectedValueOnce(new Error('CAPTCHA falhou'))
    const orch = new PortalOrchestrator()
    await expect(orch.executar(makeJob('ECAC', 'CONSULTA_SITUACAO'), CRED_BUF)).rejects.toThrow(
      'CAPTCHA falhou'
    )
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

// ===========================================================================
// PortalOrchestrator — SEFAZ SP (DeSTDA + GNRE)
// ===========================================================================

describe('PortalOrchestrator — SEFAZ SP', () => {
  it('SEFAZ_SP:TRANSMITIR_DESTDA → chama transmitirDeSTDA com certBuffer e certSenha', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(
      makeJob('SEFAZ_SP', 'TRANSMITIR_DESTDA', {
        competencia: '2025-01',
        dados: { certSenha: 'senha123' },
      }),
      CRED_BUF
    )
    expect(mockSefazSp.transmitirDeSTDA).toHaveBeenCalledWith(
      't-1',
      'emp-1',
      '11111111000111',
      '2025-01',
      CRED_BUF,
      'senha123'
    )
  })

  it('SEFAZ_SP:TRANSMITIR_DESTDA sem senha → passa string vazia', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(
      makeJob('SEFAZ_SP', 'TRANSMITIR_DESTDA', { competencia: '2025-01' }),
      CRED_BUF
    )
    expect(mockSefazSp.transmitirDeSTDA).toHaveBeenCalledWith(
      't-1',
      'emp-1',
      '11111111000111',
      '2025-01',
      CRED_BUF,
      ''
    )
  })

  it('SEFAZ_SP:EMITIR_GNRE → chama emitirGNRE com uf, valor e codReceita', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(
      makeJob('SEFAZ_SP', 'EMITIR_GNRE', {
        competencia: '2025-01',
        dados: { uf: 'MG', valor: '1500.00', codReceita: '10008-0' },
      }),
      CRED_BUF
    )
    expect(mockSefazSp.emitirGNRE).toHaveBeenCalledWith(
      't-1',
      'emp-1',
      '11111111000111',
      '2025-01',
      'MG',
      expect.objectContaining({ toFixed: expect.any(Function) }),
      '10008-0'
    )
  })

  it('SEFAZ_SP:EMITIR_GNRE sem dados → usa defaults (SP, 0, 10008-0)', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(makeJob('SEFAZ_SP', 'EMITIR_GNRE', { competencia: '2025-01' }), CRED_BUF)
    expect(mockSefazSp.emitirGNRE).toHaveBeenCalledWith(
      't-1',
      'emp-1',
      '11111111000111',
      '2025-01',
      'SP',
      expect.objectContaining({ toFixed: expect.any(Function) }),
      '10008-0'
    )
  })

  it('SEFAZ_SP:EMITIR_GNRE_LOTE → chama emitirGNRELote com array mapeado', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(
      makeJob('SEFAZ_SP', 'EMITIR_GNRE_LOTE', {
        competencia: '2025-01',
        dados: {
          gnres: [
            { uf: 'SP', valor: '100.00', codReceita: '10008-0' },
            { uf: 'MG', valor: '200.00', codReceita: '10008-0' },
          ],
        },
      }),
      CRED_BUF
    )
    expect(mockSefazSp.emitirGNRELote).toHaveBeenCalledWith(
      't-1',
      'emp-1',
      '11111111000111',
      '2025-01',
      expect.arrayContaining([
        expect.objectContaining({ uf: 'SP' }),
        expect.objectContaining({ uf: 'MG' }),
      ])
    )
  })

  it('SEFAZ_SP:EMITIR_GNRE_LOTE sem dados → passa array vazio', async () => {
    const orch = new PortalOrchestrator()
    await orch.executar(
      makeJob('SEFAZ_SP', 'EMITIR_GNRE_LOTE', { competencia: '2025-01' }),
      CRED_BUF
    )
    expect(mockSefazSp.emitirGNRELote).toHaveBeenCalledWith(
      't-1',
      'emp-1',
      '11111111000111',
      '2025-01',
      []
    )
  })

  it('SEFAZ_SP falha → atualiza portalJob para ERRO', async () => {
    mockSefazSp.transmitirDeSTDA.mockRejectedValueOnce(new Error('SPED offline'))
    const orch = new PortalOrchestrator()
    await expect(
      orch.executar(makeJob('SEFAZ_SP', 'TRANSMITIR_DESTDA', { competencia: '2025-01' }), CRED_BUF)
    ).rejects.toThrow('SPED offline')
    const updateData = mockDb.portalJob.update.mock.calls[0][0].data
    expect(updateData.status).toBe('ERRO')
  })
})
