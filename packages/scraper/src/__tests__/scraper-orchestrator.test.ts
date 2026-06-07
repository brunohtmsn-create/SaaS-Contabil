/**
 * Testes unitários — ScraperOrchestrator
 *
 * Cobre:
 *  capturarTodos():
 *   - NF-e, NFC-e e NFS-e retornados corretamente
 *   - NFS-e separadas em emitidas/tomadas por tipo
 *   - falha de NF-e → retorna array vazio (Promise.allSettled)
 *   - falha de NFC-e → retorna array vazio
 *   - falha de NFS-e → retorna arrays vazios
 *   - autentica os três adapters antes de buscar
 *
 *  capturarNFSePrefeitura():
 *   - IBGE registrado → chama adapter correto
 *   - IBGE desconhecido → lança erro com IBGEs disponíveis
 *   - falha em fetchEmitidas → retorna emitidas vazia, tomadas intactas
 *   - falha em fetchTomadas → retorna tomadas vazia, emitidas intactas
 *
 *  healthCheckPrefeituras():
 *   - todos disponíveis → mapa com todos true
 *   - um adapter lança erro → mapa com false para aquele IBGE
 *
 * Os adapters Playwright são substituídos por mocks via vi.mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'
import type { DocumentoRaw } from '../interfaces/base.js'

// ---------------------------------------------------------------------------
// Mocks dos adapters (devem preceder os imports do módulo testado)
// ---------------------------------------------------------------------------

const makeAdapter = () => ({
  authenticate: vi.fn().mockResolvedValue({ cookies: 'mock', expiresAt: new Date() }),
  fetch: vi.fn().mockResolvedValue([]),
  fetchEmitidas: vi.fn().mockResolvedValue([]),
  fetchTomadas: vi.fn().mockResolvedValue([]),
  downloadXML: vi.fn().mockResolvedValue('<xml/>'),
  downloadPDF: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  healthCheck: vi.fn().mockResolvedValue(true),
})

const mockNFe = makeAdapter()
const mockNFCe = makeAdapter()
const mockNFSe = makeAdapter()
const mockPref3550308 = makeAdapter()
const mockPref3304557 = makeAdapter()
const mockPref3106200 = makeAdapter()

vi.mock('../adapters/nfe-sefaz.adapter.js', () => ({
  NFeSefazAdapter: vi.fn().mockImplementation(() => mockNFe),
}))
vi.mock('../adapters/nfce-sefaz.adapter.js', () => ({
  NFCeSefazAdapter: vi.fn().mockImplementation(() => mockNFCe),
}))
vi.mock('../adapters/nfse-portal-nacional.adapter.js', () => ({
  NFSePortalNacionalAdapter: vi.fn().mockImplementation(() => mockNFSe),
}))
vi.mock('../adapters/prefeitura-3550308.adapter.js', () => ({
  Prefeitura3550308Adapter: vi.fn().mockImplementation(() => mockPref3550308),
}))
vi.mock('../adapters/prefeitura-3304557.adapter.js', () => ({
  Prefeitura3304557Adapter: vi.fn().mockImplementation(() => mockPref3304557),
}))
vi.mock('../adapters/prefeitura-3106200.adapter.js', () => ({
  Prefeitura3106200Adapter: vi.fn().mockImplementation(() => mockPref3106200),
}))

vi.mock('@saas-contabil/shared', () => ({
  parsePeriodo: vi.fn((comp: string) => ({
    inicio: new Date('2025-01-01'),
    fim: new Date('2025-01-31'),
    competencia: comp,
  })),
  formatDate: vi.fn((d: Date) => d.toISOString().slice(0, 10)),
  nowBR: vi.fn(() => new Date()),
}))

// Impede que adapters não mockados puxem @saas-contabil/storage
// → @saas-contabil/database → @prisma/client (não gerado no CI)
vi.mock('@saas-contabil/storage', () => ({
  StorageService: vi.fn().mockImplementation(() => ({
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    exists: vi.fn().mockResolvedValue(false),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
  S3KeyBuilder: {
    erroScreenshot: vi.fn((_cnpj: string, _ctx: string) => 'mock/error-screenshot.png'),
    nfseXml: vi.fn(() => 'mock/nfse.xml'),
    nfsePdf: vi.fn(() => 'mock/nfse.pdf'),
  },
}))

import { ScraperOrchestrator } from '../scraper-orchestrator.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CNPJ = '11111111000111'
const COMPETENCIA = '2025-01'
const CREDENCIAL = { id: 'cred-1', data: Buffer.from('cert'), tipo: 'CERTIFICADO_A1' }

function makeDoc(tipo: string, numero: string): DocumentoRaw {
  return {
    tipo,
    numero,
    dataEmissao: new Date('2025-01-15'),
    cnpjEmitente: '22222222000122',
    nomeEmitente: 'Fornecedor LTDA',
    cnpjDestinatario: CNPJ,
    valorTotal: new Decimal('1500'),
    fonte: 'SEFAZ_FEDERAL',
  }
}

// ---------------------------------------------------------------------------
// Reset entre testes
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  // Restaura defaults
  mockNFe.authenticate.mockResolvedValue({ cookies: 'mock', expiresAt: new Date() })
  mockNFe.fetch.mockResolvedValue([])
  mockNFCe.authenticate.mockResolvedValue({ cookies: 'mock', expiresAt: new Date() })
  mockNFCe.fetch.mockResolvedValue([])
  mockNFSe.authenticate.mockResolvedValue({ cookies: 'mock', expiresAt: new Date() })
  mockNFSe.fetch.mockResolvedValue([])
  mockPref3550308.authenticate.mockResolvedValue({ cookies: 'mock', expiresAt: new Date() })
  mockPref3550308.fetchEmitidas.mockResolvedValue([])
  mockPref3550308.fetchTomadas.mockResolvedValue([])
  mockPref3550308.healthCheck.mockResolvedValue(true)
  mockPref3304557.healthCheck.mockResolvedValue(true)
  mockPref3106200.healthCheck.mockResolvedValue(true)
})

// ===========================================================================
// capturarTodos()
// ===========================================================================

describe('ScraperOrchestrator — capturarTodos()', () => {
  it('retorna NF-e, NFC-e e NFS-e separados', async () => {
    mockNFe.fetch.mockResolvedValueOnce([makeDoc('NFE', 'NF-001')])
    mockNFCe.fetch.mockResolvedValueOnce([makeDoc('NFCE', 'NFC-001')])
    mockNFSe.fetch.mockResolvedValueOnce([
      makeDoc('NFSE_EMITIDA', 'NFSe-001'),
      makeDoc('NFSE_TOMADA', 'NFSe-002'),
    ])

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarTodos(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(result.nfe).toHaveLength(1)
    expect(result.nfce).toHaveLength(1)
    expect(result.nfseEmitidas).toHaveLength(1)
    expect(result.nfseTomadas).toHaveLength(1)
  })

  it('NFS-e emitidas e tomadas são separadas por tipo corretamente', async () => {
    mockNFSe.fetch.mockResolvedValueOnce([
      makeDoc('NFSE_EMITIDA', '1'),
      makeDoc('NFSE_EMITIDA', '2'),
      makeDoc('NFSE_TOMADA', '3'),
    ])

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarTodos(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(result.nfseEmitidas).toHaveLength(2)
    expect(result.nfseTomadas).toHaveLength(1)
  })

  it('falha no adapter NF-e → retorna nfe vazio, demais preservados', async () => {
    mockNFe.fetch.mockRejectedValueOnce(new Error('SEFAZ indisponível'))
    mockNFCe.fetch.mockResolvedValueOnce([makeDoc('NFCE', 'NFC-001')])

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarTodos(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(result.nfe).toHaveLength(0)
    expect(result.nfce).toHaveLength(1)
  })

  it('falha no adapter NFC-e → retorna nfce vazio, nfe preservado', async () => {
    mockNFe.fetch.mockResolvedValueOnce([makeDoc('NFE', 'NF-001')])
    mockNFCe.fetch.mockRejectedValueOnce(new Error('Timeout'))

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarTodos(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(result.nfce).toHaveLength(0)
    expect(result.nfe).toHaveLength(1)
  })

  it('falha no Portal Nacional NFS-e → retorna emitidas e tomadas vazias', async () => {
    mockNFSe.fetch.mockRejectedValueOnce(new Error('Portal Nacional offline'))

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarTodos(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(result.nfseEmitidas).toHaveLength(0)
    expect(result.nfseTomadas).toHaveLength(0)
  })

  it('autentica NF-e, NFC-e e NFS-e antes de buscar', async () => {
    const orch = new ScraperOrchestrator()
    await orch.capturarTodos(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(mockNFe.authenticate).toHaveBeenCalledWith(CREDENCIAL)
    expect(mockNFCe.authenticate).toHaveBeenCalledWith(CREDENCIAL)
    expect(mockNFSe.authenticate).toHaveBeenCalledWith(CREDENCIAL)
  })

  it('todos os adapters falham → retorna todos arrays vazios', async () => {
    mockNFe.fetch.mockRejectedValueOnce(new Error('erro'))
    mockNFCe.fetch.mockRejectedValueOnce(new Error('erro'))
    mockNFSe.fetch.mockRejectedValueOnce(new Error('erro'))

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarTodos(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(result.nfe).toHaveLength(0)
    expect(result.nfce).toHaveLength(0)
    expect(result.nfseEmitidas).toHaveLength(0)
    expect(result.nfseTomadas).toHaveLength(0)
  })
})

// ===========================================================================
// capturarNFSePrefeitura()
// ===========================================================================

describe('ScraperOrchestrator — capturarNFSePrefeitura()', () => {
  it('IBGE registrado (3550308) → chama adapter correto', async () => {
    mockPref3550308.fetchEmitidas.mockResolvedValueOnce([makeDoc('NFSE_EMITIDA', 'E-1')])
    mockPref3550308.fetchTomadas.mockResolvedValueOnce([makeDoc('NFSE_TOMADA', 'T-1')])

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarNFSePrefeitura(CNPJ, COMPETENCIA, '3550308', CREDENCIAL)

    expect(result.emitidas).toHaveLength(1)
    expect(result.tomadas).toHaveLength(1)
    expect(mockPref3550308.authenticate).toHaveBeenCalledWith(CREDENCIAL)
  })

  it('IBGE não registrado → lança erro com IBGEs disponíveis na mensagem', async () => {
    const orch = new ScraperOrchestrator()
    await expect(
      orch.capturarNFSePrefeitura(CNPJ, COMPETENCIA, '9999999', CREDENCIAL)
    ).rejects.toThrow('9999999')
  })

  it('fetchEmitidas falha → emitidas vazia, tomadas intactas', async () => {
    mockPref3550308.fetchEmitidas.mockRejectedValueOnce(new Error('Portal timeout'))
    mockPref3550308.fetchTomadas.mockResolvedValueOnce([makeDoc('NFSE_TOMADA', 'T-1')])

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarNFSePrefeitura(CNPJ, COMPETENCIA, '3550308', CREDENCIAL)

    expect(result.emitidas).toHaveLength(0)
    expect(result.tomadas).toHaveLength(1)
  })

  it('fetchTomadas falha → tomadas vazia, emitidas intactas', async () => {
    mockPref3550308.fetchEmitidas.mockResolvedValueOnce([makeDoc('NFSE_EMITIDA', 'E-1')])
    mockPref3550308.fetchTomadas.mockRejectedValueOnce(new Error('CAPTCHA'))

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarNFSePrefeitura(CNPJ, COMPETENCIA, '3550308', CREDENCIAL)

    expect(result.emitidas).toHaveLength(1)
    expect(result.tomadas).toHaveLength(0)
  })

  it('IBGE 3304557 (Rio de Janeiro) também está registrado', async () => {
    const orch = new ScraperOrchestrator()
    await expect(
      orch.capturarNFSePrefeitura(CNPJ, COMPETENCIA, '3304557', CREDENCIAL)
    ).resolves.toBeDefined()
  })

  it('IBGE 3106200 (Belo Horizonte) também está registrado', async () => {
    const orch = new ScraperOrchestrator()
    await expect(
      orch.capturarNFSePrefeitura(CNPJ, COMPETENCIA, '3106200', CREDENCIAL)
    ).resolves.toBeDefined()
  })
})

// ===========================================================================
// healthCheckPrefeituras()
// ===========================================================================

describe('ScraperOrchestrator — healthCheckPrefeituras()', () => {
  it('todos disponíveis → mapa com todos os IBGEs como true', async () => {
    const orch = new ScraperOrchestrator()
    const result = await orch.healthCheckPrefeituras()

    expect(result.get('3550308')).toBe(true)
    expect(result.get('3304557')).toBe(true)
    expect(result.get('3106200')).toBe(true)
  })

  it('adapter lança erro → mapa com false para aquele IBGE', async () => {
    mockPref3550308.healthCheck.mockRejectedValueOnce(new Error('Site fora do ar'))

    const orch = new ScraperOrchestrator()
    const result = await orch.healthCheckPrefeituras()

    expect(result.get('3550308')).toBe(false)
    expect(result.get('3304557')).toBe(true)
  })

  it('retorna mapa com uma entrada por prefeitura registrada', async () => {
    const orch = new ScraperOrchestrator()
    const result = await orch.healthCheckPrefeituras()

    expect(result.size).toBe(31)
  })

  it('adapter retorna false → mapa preserva false', async () => {
    mockPref3304557.healthCheck.mockResolvedValueOnce(false)

    const orch = new ScraperOrchestrator()
    const result = await orch.healthCheckPrefeituras()

    expect(result.get('3304557')).toBe(false)
  })
})

// ===========================================================================
// capturarNFe() e capturarNFCe() — métodos individuais
// ===========================================================================

describe('ScraperOrchestrator — capturarNFe() e capturarNFCe()', () => {
  it('capturarNFe() autentica e busca apenas NF-e', async () => {
    mockNFe.fetch.mockResolvedValueOnce([makeDoc('NFE', 'NF-001')])

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarNFe(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(result).toHaveLength(1)
    expect(mockNFe.authenticate).toHaveBeenCalledTimes(1)
    expect(mockNFCe.authenticate).not.toHaveBeenCalled()
  })

  it('capturarNFCe() autentica e busca apenas NFC-e', async () => {
    mockNFCe.fetch.mockResolvedValueOnce([makeDoc('NFCE', 'NFC-001')])

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarNFCe(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(result).toHaveLength(1)
    expect(mockNFCe.authenticate).toHaveBeenCalledTimes(1)
    expect(mockNFe.authenticate).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// capturarNFSe() — Portal Nacional
// ===========================================================================

describe('ScraperOrchestrator — capturarNFSe()', () => {
  it('autentica no Portal Nacional e retorna emitidas e tomadas', async () => {
    mockNFSe.fetchEmitidas.mockResolvedValueOnce([makeDoc('NFSE_EMITIDA', 'SN-001')])
    mockNFSe.fetchTomadas.mockResolvedValueOnce([makeDoc('NFSE_TOMADA', 'SN-T-001')])

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarNFSe(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(result.emitidas).toHaveLength(1)
    expect(result.tomadas).toHaveLength(1)
    expect(mockNFSe.authenticate).toHaveBeenCalledOnce()
  })

  it('passa credencial correta para authenticate', async () => {
    const orch = new ScraperOrchestrator()
    await orch.capturarNFSe(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(mockNFSe.authenticate).toHaveBeenCalledWith(CREDENCIAL)
  })

  it('busca emitidas e tomadas independentemente', async () => {
    mockNFSe.fetchEmitidas.mockResolvedValueOnce([
      makeDoc('NFSE_EMITIDA', 'E-001'),
      makeDoc('NFSE_EMITIDA', 'E-002'),
    ])
    mockNFSe.fetchTomadas.mockResolvedValueOnce([makeDoc('NFSE_TOMADA', 'T-001')])

    const orch = new ScraperOrchestrator()
    const result = await orch.capturarNFSe(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(result.emitidas).toHaveLength(2)
    expect(result.tomadas).toHaveLength(1)
  })

  it('não autentica adapters NF-e ou NFC-e', async () => {
    const orch = new ScraperOrchestrator()
    await orch.capturarNFSe(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(mockNFe.authenticate).not.toHaveBeenCalled()
    expect(mockNFCe.authenticate).not.toHaveBeenCalled()
  })

  it('sem NFS-e emitidas ou tomadas → retorna arrays vazios', async () => {
    const orch = new ScraperOrchestrator()
    const result = await orch.capturarNFSe(CNPJ, COMPETENCIA, CREDENCIAL)

    expect(result.emitidas).toHaveLength(0)
    expect(result.tomadas).toHaveLength(0)
  })
})
