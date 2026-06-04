/**
 * Testes unitários — NFCeSefazAdapter
 *
 * Cobre:
 *  - tipo = 'NFCE' e fonte = 'SEFAZ_FEDERAL'
 *  - authenticate(): retorna token 'cert-auth' com expiresAt ~4h no futuro
 *  - fetch(): chama page.goto com a URL correta do portal NF-e
 *  - fetch(): retorna array vazio (scraping ainda não implementado)
 *  - fetch(): navega com timeout:30000 e waitUntil:'networkidle'
 *  - fetch(): erro em page.goto → propaga via withRetry
 *  - downloadXML(): retorna doc.xmlContent quando presente
 *  - downloadXML(): doc sem xmlContent → retorna string vazia
 *  - downloadPDF(): retorna Buffer vazio (sem implementação de PDF)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — usar vi.hoisted para referenciar nas factories de vi.mock
// ---------------------------------------------------------------------------

const { mockGoto, mockChromiumLaunch } = vi.hoisted(() => {
  const mockGoto = vi.fn().mockResolvedValue(null)
  const mockPage = {
    goto: mockGoto,
    close: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  }
  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const mockChromiumLaunch = vi.fn().mockResolvedValue(mockBrowser)
  return { mockGoto, mockChromiumLaunch }
})

vi.mock('playwright', () => ({
  chromium: { launch: mockChromiumLaunch },
}))

vi.mock('@saas-contabil/storage', () => ({
  StorageService: vi.fn().mockImplementation(() => ({
    upload: vi.fn().mockResolvedValue({ s3Key: 'test/key' }),
    getSignedUrl: vi.fn().mockResolvedValue('https://test.url'),
  })),
  S3KeyBuilder: {
    erroScreenshot: vi.fn().mockReturnValue('erros/screenshot.png'),
  },
}))

import { NFCeSefazAdapter } from '../adapters/nfce-sefaz.adapter.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CRED = { id: 'cred-1', data: Buffer.from('cert-data') } as any
const PERIODO = { inicio: new Date('2025-01-01'), fim: new Date('2025-01-31') }
const CNPJ = '11111111000191'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockGoto.mockResolvedValue(null)
  // Re-setup the chain
  const mockPage = {
    goto: mockGoto,
    close: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  }
  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  }
  mockChromiumLaunch.mockResolvedValue(mockBrowser)
})

describe('NFCeSefazAdapter — propriedades', () => {
  it('tipo é NFCE', () => {
    const adapter = new NFCeSefazAdapter()
    expect(adapter.tipo).toBe('NFCE')
  })

  it('fonte é SEFAZ_FEDERAL', () => {
    const adapter = new NFCeSefazAdapter()
    expect(adapter.fonte).toBe('SEFAZ_FEDERAL')
  })
})

describe('NFCeSefazAdapter.authenticate()', () => {
  it('retorna token "cert-auth"', async () => {
    const adapter = new NFCeSefazAdapter()
    const session = await adapter.authenticate(CRED)
    expect(session.token).toBe('cert-auth')
  })

  it('expiresAt está aproximadamente 4 horas no futuro', async () => {
    const before = Date.now()
    const adapter = new NFCeSefazAdapter()
    const session = await adapter.authenticate(CRED)
    const fourHoursMs = 4 * 60 * 60 * 1000
    expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(before + fourHoursMs - 1000)
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(before + fourHoursMs + 1000)
  })

  it('não depende da credencial — sempre retorna cert-auth', async () => {
    const adapter = new NFCeSefazAdapter()
    const s1 = await adapter.authenticate({ id: 'a', data: Buffer.from('x') } as any)
    const s2 = await adapter.authenticate({ id: 'b', data: Buffer.from('y') } as any)
    expect(s1.token).toBe('cert-auth')
    expect(s2.token).toBe('cert-auth')
  })
})

describe('NFCeSefazAdapter.fetch()', () => {
  it('chama page.goto com URL do portal NF-e fazenda.gov.br', async () => {
    const adapter = new NFCeSefazAdapter()
    await adapter.fetch(CNPJ, PERIODO)
    expect(mockGoto).toHaveBeenCalledWith(
      expect.stringContaining('nfe.fazenda.gov.br'),
      expect.any(Object)
    )
  })

  it('navega com waitUntil:"networkidle" e timeout:30000', async () => {
    const adapter = new NFCeSefazAdapter()
    await adapter.fetch(CNPJ, PERIODO)
    expect(mockGoto).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 30000, waitUntil: 'networkidle' })
    )
  })

  it('retorna array vazio', async () => {
    const adapter = new NFCeSefazAdapter()
    const docs = await adapter.fetch(CNPJ, PERIODO)
    expect(docs).toEqual([])
  })

  it('erro em page.goto → propaga erro (withRetry esgota tentativas)', async () => {
    mockGoto.mockRejectedValue(new Error('Timeout do portal SEFAZ'))
    const adapter = new NFCeSefazAdapter()
    await expect(adapter.fetch(CNPJ, PERIODO)).rejects.toThrow()
  }, 15000) // withRetry tem delays de 1s+2s+4s entre as 4 tentativas
})

describe('NFCeSefazAdapter.downloadXML()', () => {
  it('retorna xmlContent do documento quando presente', async () => {
    const adapter = new NFCeSefazAdapter()
    const doc = { tipo: 'NFCE', xmlContent: '<nfce>conteudo</nfce>' } as any
    const result = await adapter.downloadXML(doc)
    expect(result).toBe('<nfce>conteudo</nfce>')
  })

  it('documento sem xmlContent → retorna string vazia', async () => {
    const adapter = new NFCeSefazAdapter()
    const doc = { tipo: 'NFCE' } as any
    const result = await adapter.downloadXML(doc)
    expect(result).toBe('')
  })

  it('xmlContent undefined → retorna string vazia', async () => {
    const adapter = new NFCeSefazAdapter()
    const doc = { tipo: 'NFCE', xmlContent: undefined } as any
    const result = await adapter.downloadXML(doc)
    expect(result).toBe('')
  })
})

describe('NFCeSefazAdapter.downloadPDF()', () => {
  it('retorna Buffer vazio', async () => {
    const adapter = new NFCeSefazAdapter()
    const doc = { tipo: 'NFCE' } as any
    const result = await adapter.downloadPDF(doc)
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBe(0)
  })
})
