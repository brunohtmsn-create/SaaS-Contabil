/**
 * Testes unitários — NFSePortalNacionalAdapter
 *
 * Cobre:
 *  - authenticate(): retorna session com token e expiresAt no futuro
 *  - fetchEmitidas(): chama axios.get com params corretos (cnpjPrestador, datas)
 *  - fetchEmitidas(): retorna documentos mapeados com tipo NFSE_EMITIDA
 *  - fetchEmitidas(): em erro de axios → retorna array vazio (silently)
 *  - fetchTomadas(): chama axios.get com params corretos (cnpjTomador, datas)
 *  - fetchTomadas(): retorna documentos mapeados com tipo NFSE_TOMADA
 *  - fetchTomadas(): em erro de axios → retorna array vazio (silently)
 *  - fetch(): concatena emitidas + tomadas
 *  - mapResponse (via fetchEmitidas): NFSE_EMITIDA seta cnpjEmitente = cnpj
 *  - mapResponse (via fetchTomadas): NFSE_TOMADA seta cnpjDestinatario = cnpj
 *  - mapResponse: data não-array → retorna []
 *  - mapResponse: valorTotal é Decimal
 *  - mapResponse: numero convertido para string
 *  - mapResponse: fonte sempre 'PORTAL_NACIONAL_NFSE'
 *  - downloadXML(): retorna xmlContent do documento
 *  - downloadPDF(): retorna Buffer vazio
 *  - healthCheck(): axios ok → true
 *  - healthCheck(): axios falha → false
 *
 * axios é mockado via vi.mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockAxiosGet, mockAxiosPost } = vi.hoisted(() => ({
  mockAxiosGet: vi.fn(),
  mockAxiosPost: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    get: mockAxiosGet,
    post: mockAxiosPost,
  },
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return { ...actual }
})

import { NFSePortalNacionalAdapter } from '../adapters/nfse-portal-nacional.adapter.js'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CNPJ = '11222333000181'
const PERIODO = {
  inicio: new Date('2025-05-01T00:00:00Z'),
  fim: new Date('2025-05-31T23:59:59Z'),
}
const CRED = { cnpj: CNPJ, token: 'jwt-test' }

const NFSE_ITEM = {
  numero: 1001,
  dataEmissao: '2025-05-15',
  cnpjPrestador: CNPJ,
  nomePrestador: 'Acme Serviços LTDA',
  cnpjTomador: '99888777000166',
  valorTotal: '1500.00',
  ibgePrestador: '3550308',
  xml: '<xml>content</xml>',
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ===========================================================================
// authenticate
// ===========================================================================

describe('NFSePortalNacionalAdapter.authenticate()', () => {
  it('retorna session com token e expiresAt no futuro', async () => {
    const adapter = new NFSePortalNacionalAdapter()
    const before = Date.now()

    const session = await adapter.authenticate(CRED as any)

    expect(session.token).toBeTruthy()
    expect(session.expiresAt.getTime()).toBeGreaterThan(before)
  })

  it('expiresAt está aproximadamente 2 horas à frente', async () => {
    const adapter = new NFSePortalNacionalAdapter()
    const session = await adapter.authenticate(CRED as any)

    const diffMs = session.expiresAt.getTime() - Date.now()
    const twoHoursMs = 2 * 60 * 60 * 1000
    expect(diffMs).toBeGreaterThan(twoHoursMs - 5000)
    expect(diffMs).toBeLessThan(twoHoursMs + 5000)
  })
})

// ===========================================================================
// fetchEmitidas
// ===========================================================================

describe('NFSePortalNacionalAdapter.fetchEmitidas()', () => {
  it('chama axios.get com cnpjPrestador e datas formatadas', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: [NFSE_ITEM] })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    await adapter.fetchEmitidas(CNPJ, PERIODO)

    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/api/nfse/emitidas'),
      expect.objectContaining({
        params: expect.objectContaining({
          cnpjPrestador: CNPJ,
          dataInicio: '2025-05-01',
          dataFim: '2025-05-31',
        }),
      })
    )
  })

  it('retorna documentos mapeados com tipo NFSE_EMITIDA', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: [NFSE_ITEM] })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchEmitidas(CNPJ, PERIODO)

    expect(docs).toHaveLength(1)
    expect(docs[0].tipo).toBe('NFSE_EMITIDA')
    expect(docs[0].fonte).toBe('PORTAL_NACIONAL_NFSE')
  })

  it('NFSE_EMITIDA: cnpjEmitente = cnpj do prestador (parâmetro)', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: [NFSE_ITEM] })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchEmitidas(CNPJ, PERIODO)

    expect(docs[0].cnpjEmitente).toBe(CNPJ)
  })

  it('em erro de axios → retorna array vazio silenciosamente', async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error('network error'))
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchEmitidas(CNPJ, PERIODO)

    expect(docs).toEqual([])
  })

  it('resposta não-array → retorna []', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: null })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchEmitidas(CNPJ, PERIODO)

    expect(docs).toEqual([])
  })
})

// ===========================================================================
// fetchTomadas
// ===========================================================================

describe('NFSePortalNacionalAdapter.fetchTomadas()', () => {
  it('chama axios.get com cnpjTomador e datas formatadas', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: [NFSE_ITEM] })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    await adapter.fetchTomadas(CNPJ, PERIODO)

    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/api/nfse/tomadas'),
      expect.objectContaining({
        params: expect.objectContaining({
          cnpjTomador: CNPJ,
        }),
      })
    )
  })

  it('retorna documentos mapeados com tipo NFSE_TOMADA', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: [NFSE_ITEM] })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchTomadas(CNPJ, PERIODO)

    expect(docs).toHaveLength(1)
    expect(docs[0].tipo).toBe('NFSE_TOMADA')
  })

  it('NFSE_TOMADA: cnpjDestinatario = cnpj do tomador (parâmetro)', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: [NFSE_ITEM] })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchTomadas(CNPJ, PERIODO)

    expect(docs[0].cnpjDestinatario).toBe(CNPJ)
  })

  it('em erro de axios → retorna array vazio silenciosamente', async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error('timeout'))
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchTomadas(CNPJ, PERIODO)

    expect(docs).toEqual([])
  })
})

// ===========================================================================
// fetch (emitidas + tomadas)
// ===========================================================================

describe('NFSePortalNacionalAdapter.fetch()', () => {
  it('concatena emitidas e tomadas em um único array', async () => {
    // emitidas request
    mockAxiosGet.mockResolvedValueOnce({ data: [NFSE_ITEM] })
    // tomadas request
    mockAxiosGet.mockResolvedValueOnce({ data: [{ ...NFSE_ITEM, numero: 2002 }] })

    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetch(CNPJ, PERIODO)

    expect(docs).toHaveLength(2)
    expect(docs[0].tipo).toBe('NFSE_EMITIDA')
    expect(docs[1].tipo).toBe('NFSE_TOMADA')
  })

  it('emitidas com erro → concatena só tomadas', async () => {
    mockAxiosGet
      .mockRejectedValueOnce(new Error('fail emitidas'))
      .mockResolvedValueOnce({ data: [NFSE_ITEM] })

    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetch(CNPJ, PERIODO)

    expect(docs).toHaveLength(1)
    expect(docs[0].tipo).toBe('NFSE_TOMADA')
  })

  it('ambas com erro → retorna array vazio', async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error('fail')).mockRejectedValueOnce(new Error('fail'))

    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetch(CNPJ, PERIODO)

    expect(docs).toEqual([])
  })
})

// ===========================================================================
// mapResponse field mapping
// ===========================================================================

describe('NFSePortalNacionalAdapter — mapeamento de campos', () => {
  it('valorTotal é Decimal', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: [NFSE_ITEM] })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchEmitidas(CNPJ, PERIODO)

    expect(docs[0].valorTotal).toBeInstanceOf(Decimal)
    expect(docs[0].valorTotal.toFixed(2)).toBe('1500.00')
  })

  it('numero é convertido para string', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: [{ ...NFSE_ITEM, numero: 9876 }] })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchEmitidas(CNPJ, PERIODO)

    expect(typeof docs[0].numero).toBe('string')
    expect(docs[0].numero).toBe('9876')
  })

  it('fonte é sempre PORTAL_NACIONAL_NFSE', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: [NFSE_ITEM] })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchEmitidas(CNPJ, PERIODO)

    expect(docs[0].fonte).toBe('PORTAL_NACIONAL_NFSE')
  })

  it('xmlContent passado adiante', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: [NFSE_ITEM] })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchEmitidas(CNPJ, PERIODO)

    expect(docs[0].xmlContent).toBe('<xml>content</xml>')
  })

  it('municipioIBGE mapeado de ibgePrestador', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: [NFSE_ITEM] })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchEmitidas(CNPJ, PERIODO)

    expect(docs[0].municipioIBGE).toBe('3550308')
  })

  it('valorTotal ausente → Decimal(0)', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: [{ ...NFSE_ITEM, valorTotal: undefined }],
    })
    const adapter = new NFSePortalNacionalAdapter()
    await adapter.authenticate(CRED as any)

    const docs = await adapter.fetchEmitidas(CNPJ, PERIODO)

    expect(docs[0].valorTotal.toFixed(2)).toBe('0.00')
  })
})

// ===========================================================================
// downloadXML / downloadPDF
// ===========================================================================

describe('NFSePortalNacionalAdapter.downloadXML()', () => {
  it('retorna xmlContent do documento', async () => {
    const adapter = new NFSePortalNacionalAdapter()
    const xml = await adapter.downloadXML({ xmlContent: '<xml>test</xml>' } as any)
    expect(xml).toBe('<xml>test</xml>')
  })

  it('documento sem xmlContent → retorna string vazia', async () => {
    const adapter = new NFSePortalNacionalAdapter()
    const xml = await adapter.downloadXML({} as any)
    expect(xml).toBe('')
  })
})

describe('NFSePortalNacionalAdapter.downloadPDF()', () => {
  it('retorna Buffer vazio', async () => {
    const adapter = new NFSePortalNacionalAdapter()
    const pdf = await adapter.downloadPDF({} as any)
    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.length).toBe(0)
  })
})

// ===========================================================================
// healthCheck
// ===========================================================================

describe('NFSePortalNacionalAdapter.healthCheck()', () => {
  it('axios ok → retorna true', async () => {
    mockAxiosGet.mockResolvedValueOnce({ status: 200 })
    const adapter = new NFSePortalNacionalAdapter()

    const result = await adapter.healthCheck()

    expect(result).toBe(true)
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/api/health'),
      expect.objectContaining({ timeout: 5000 })
    )
  })

  it('axios lança erro → retorna false', async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error('connection refused'))
    const adapter = new NFSePortalNacionalAdapter()

    const result = await adapter.healthCheck()

    expect(result).toBe(false)
  })
})
