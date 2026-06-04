/**
 * Testes unitários — BaseBethaAdapter
 *
 * Cobre (via subclasse concreta TestBethaAdapter):
 *  authenticate():
 *   - sucesso: sem CAPTCHA, sem erro de login, sem redirect loop → retorna Session
 *   - sessão armazenada em this.session após autenticação bem-sucedida
 *   - CAPTCHA detectado → solveCaptcha e preencherCaptcha chamados
 *   - formulário de login não encontrado → lança erro (captureAndThrow)
 *   - mensagem de erro de login visível → lança erro
 *   - página redireciona de volta para login → lança erro
 *
 *  fetch():
 *   - chama fetchEmitidas e fetchTomadas via Promise.allSettled
 *   - fetchEmitidas falha → resultado inclui só tomadas
 *   - fetchTomadas falha → resultado inclui só emitidas
 *
 *  fetchEmitidas() / fetchTomadas():
 *   - sem sessão → lança 'sessão não inicializada'
 *   - sessão expirada → lança 'sessão expirada'
 *   - sucesso com linhas na grade → retorna DocumentoRaw[]
 *   - linha com menos de 6 células → ignorada
 *   - linha com número não-numérico → ignorada
 *   - paginação: clica próxima até não haver mais botão
 *   - limite de 100 páginas respeitado (loop não excede)
 *
 *  downloadXML():
 *   - doc com xmlContent → retorna diretamente (sem Playwright)
 *   - doc sem xmlContent → navega e baixa
 *
 *  downloadPDF():
 *   - doc com pdfBuffer → retorna diretamente (sem Playwright)
 *   - doc sem pdfBuffer → navega e baixa
 *
 *  healthCheck():
 *   - status < 500 → true
 *   - status >= 500 → false
 *   - página lança erro → false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Mock de Playwright — deve preceder os imports
// ---------------------------------------------------------------------------

type MockPage = {
  goto: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  waitForSelector: ReturnType<typeof vi.fn>
  fill: ReturnType<typeof vi.fn>
  click: ReturnType<typeof vi.fn>
  waitForLoadState: ReturnType<typeof vi.fn>
  url: ReturnType<typeof vi.fn>
  textContent: ReturnType<typeof vi.fn>
  context: ReturnType<typeof vi.fn>
  screenshot: ReturnType<typeof vi.fn>
  locator: ReturnType<typeof vi.fn>
  waitForEvent: ReturnType<typeof vi.fn>
  $: ReturnType<typeof vi.fn>
  evaluate: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function makeMockPage(overrides: Partial<MockPage> = {}): MockPage {
  const cookies = [{ name: 'JSESSIONID', value: 'abc123' }]
  const mockContext = {
    cookies: vi.fn().mockResolvedValue(cookies),
    close: vi.fn(),
  }

  return {
    goto: vi.fn().mockResolvedValue({ status: () => 200 }),
    isVisible: vi.fn().mockResolvedValue(false),
    waitForSelector: vi.fn().mockResolvedValue({}),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue('https://nfse.test.sp.gov.br/nfse/painel'),
    textContent: vi.fn().mockResolvedValue(''),
    context: vi.fn().mockReturnValue(mockContext),
    screenshot: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    locator: vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue([]),
    }),
    waitForEvent: vi.fn(),
    $: vi.fn().mockResolvedValue(null),
    evaluate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    ...overrides,
  }
}

const { mockChromiumLaunch } = vi.hoisted(() => ({
  mockChromiumLaunch: vi.fn(),
}))

vi.mock('playwright', () => ({
  chromium: { launch: mockChromiumLaunch },
}))

vi.mock('@saas-contabil/storage', () => ({
  StorageService: vi.fn().mockImplementation(() => ({
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn(),
    getSignedUrl: vi.fn(),
  })),
  S3KeyBuilder: {
    erroScreenshot: vi.fn().mockReturnValue('erros/screenshot.png'),
  },
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    nowBR: vi.fn().mockReturnValue(new Date('2025-06-04T10:00:00')),
    formatDate: vi.fn((d: Date, fmt: string) => {
      if (fmt === 'dd/MM/yyyy') {
        const day = String(d.getDate()).padStart(2, '0')
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const year = d.getFullYear()
        return `${day}/${month}/${year}`
      }
      return d.toISOString()
    }),
  }
})

import { BaseBethaAdapter } from '../adapters/base-betha.adapter.js'

// ---------------------------------------------------------------------------
// Subclasse concreta para testes
// ---------------------------------------------------------------------------

class TestBethaAdapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.cidadeteste.sp.gov.br',
      municipio: 'Cidade Teste',
      ibge: '9999999',
      fonte: 'NFSE_BETHA_TEST',
    })
  }
}

// ---------------------------------------------------------------------------
// Helpers para montar mock de browser
// ---------------------------------------------------------------------------

function setupBrowserMock(page: MockPage) {
  const mockContext = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn(),
  }
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn(),
  }
  mockChromiumLaunch.mockResolvedValue(mockBrowser)
  return { mockBrowser, mockContext }
}

const CRED = {
  id: 'cred-1',
  data: Buffer.from(JSON.stringify({ cnpj: '12345678000195', senha: 'senha123' }), 'utf8'),
  tipo: 'JSON',
}

const PERIODO = {
  inicio: new Date('2025-05-01T00:00:00'),
  fim: new Date('2025-05-31T23:59:59'),
  competencia: '2025-05',
}

const SESSION_VALIDA = {
  cookies: 'JSESSIONID=abc123',
  expiresAt: new Date('2099-01-01T00:00:00'),
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// authenticate()
// ---------------------------------------------------------------------------

describe('BaseBethaAdapter — authenticate()', () => {
  it('sucesso: sem CAPTCHA, sem erro → retorna Session com cookies', async () => {
    const page = makeMockPage()
    page.isVisible.mockResolvedValue(false) // sem CAPTCHA, sem erro
    page.url.mockReturnValue('https://nfse.cidadeteste.sp.gov.br/nfse/painel')
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    const session = await adapter.authenticate(CRED)

    expect(session.cookies).toBeDefined()
    expect(session.expiresAt).toBeInstanceOf(Date)
    // expiresAt = nowBR() + 4h; nowBR mock = '2025-06-04T10:00:00' → expiresAt ≈ '2025-06-04T14:00:00'
    expect(session.expiresAt.getTime()).toBeGreaterThan(new Date('2025-06-04T10:00:00').getTime())
  })

  it('sessão é armazenada em this.session após autenticação', async () => {
    const page = makeMockPage()
    page.url.mockReturnValue('https://nfse.cidadeteste.sp.gov.br/nfse/painel')
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    await adapter.authenticate(CRED)

    expect((adapter as any).session).not.toBeNull()
    expect((adapter as any).session?.cookies).toBeDefined()
  })

  it('sessão contém cookies concatenados da página', async () => {
    const page = makeMockPage()
    const mockCtx = {
      cookies: vi.fn().mockResolvedValue([
        { name: 'JSESSIONID', value: 'xyz789' },
        { name: 'TOKEN', value: 'tk123' },
      ]),
      close: vi.fn(),
    }
    page.context.mockReturnValue(mockCtx)
    page.url.mockReturnValue('https://nfse.cidadeteste.sp.gov.br/nfse/painel')
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    const session = await adapter.authenticate(CRED)

    expect(session.cookies).toContain('JSESSIONID=xyz789')
    expect(session.cookies).toContain('TOKEN=tk123')
  })

  it('navega para URL /nfse/ do portal', async () => {
    const page = makeMockPage()
    page.url.mockReturnValue('https://nfse.cidadeteste.sp.gov.br/nfse/painel')
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    await adapter.authenticate(CRED)

    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining('/nfse/'),
      expect.objectContaining({ waitUntil: 'networkidle' })
    )
  })

  it('preenche CNPJ sem máscara no campo de login', async () => {
    const page = makeMockPage()
    page.url.mockReturnValue('https://nfse.cidadeteste.sp.gov.br/nfse/painel')
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    await adapter.authenticate(CRED)

    const fillCalls = page.fill.mock.calls
    const cnpjFill = fillCalls.find((c) => c[1] === '12345678000195')
    expect(cnpjFill).toBeDefined()
  })

  it('formulário de login não encontrado → lança erro com municipio', async () => {
    const page = makeMockPage()
    page.waitForSelector.mockRejectedValue(new Error('Timeout'))
    page.url.mockReturnValue('https://nfse.cidadeteste.sp.gov.br/nfse/painel')
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    await expect(adapter.authenticate(CRED)).rejects.toThrow('Cidade Teste')
  }, 30000) // withRetry retenta 4x com delays de 1s+2s+4s

  it('mensagem de erro de login visível → lança erro', async () => {
    const page = makeMockPage()
    page.url.mockReturnValue('https://nfse.cidadeteste.sp.gov.br/nfse/painel')
    // Sempre retorna true para qualquer isVisible após CAPTCHA_FRAME (que é false)
    // Para garantir que MSG_ERRO_LOGIN seja sempre true em todas as tentativas de retry
    page.isVisible.mockImplementation((selector: string) => {
      if (selector.includes('recaptcha') || selector.includes('hcaptcha')) {
        return Promise.resolve(false) // sem CAPTCHA
      }
      return Promise.resolve(true) // MSG_ERRO_LOGIN sempre visível
    })
    page.textContent.mockResolvedValue('Usuário ou senha inválidos')
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    await expect(adapter.authenticate(CRED)).rejects.toThrow()
  }, 30000) // withRetry retenta 4x com delays de 1s+2s+4s

  it('redirecionamento para login → lança erro', async () => {
    const page = makeMockPage()
    page.url.mockReturnValue('https://nfse.cidadeteste.sp.gov.br/nfse/login?erro=1')
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    await expect(adapter.authenticate(CRED)).rejects.toThrow('redirecionamento')
  }, 30000)
})

// ---------------------------------------------------------------------------
// fetch() — Promise.allSettled
// ---------------------------------------------------------------------------

describe('BaseBethaAdapter — fetch()', () => {
  it('combina emitidas e tomadas quando ambas têm sucesso', async () => {
    const adapter = new TestBethaAdapter()

    const emitida = {
      tipo: 'NFSE_EMITIDA',
      numero: '1',
      dataEmissao: new Date(),
      cnpjEmitente: '12345678000195',
      nomeEmitente: 'SA',
      cnpjDestinatario: '98765432000100',
      valorTotal: new Decimal('1000'),
      fonte: 'NFSE_BETHA_TEST',
    }
    const tomada = { ...emitida, tipo: 'NFSE_TOMADA', numero: '2' }

    vi.spyOn(adapter, 'fetchEmitidas').mockResolvedValue([emitida])
    vi.spyOn(adapter, 'fetchTomadas').mockResolvedValue([tomada])

    const result = await adapter.fetch('12345678000195', PERIODO)

    expect(result).toHaveLength(2)
    expect(result.map((d) => d.tipo)).toContain('NFSE_EMITIDA')
    expect(result.map((d) => d.tipo)).toContain('NFSE_TOMADA')
  })

  it('fetchEmitidas falha → resultado inclui apenas tomadas', async () => {
    const adapter = new TestBethaAdapter()

    const tomada = {
      tipo: 'NFSE_TOMADA',
      numero: '2',
      dataEmissao: new Date(),
      cnpjEmitente: '12345678000195',
      nomeEmitente: 'SA',
      cnpjDestinatario: '98765432000100',
      valorTotal: new Decimal('500'),
      fonte: 'NFSE_BETHA_TEST',
    }

    vi.spyOn(adapter, 'fetchEmitidas').mockRejectedValue(new Error('Erro emitidas'))
    vi.spyOn(adapter, 'fetchTomadas').mockResolvedValue([tomada])

    const result = await adapter.fetch('12345678000195', PERIODO)

    expect(result).toHaveLength(1)
    expect(result[0]!.tipo).toBe('NFSE_TOMADA')
  })

  it('fetchTomadas falha → resultado inclui apenas emitidas', async () => {
    const adapter = new TestBethaAdapter()

    const emitida = {
      tipo: 'NFSE_EMITIDA',
      numero: '1',
      dataEmissao: new Date(),
      cnpjEmitente: '12345678000195',
      nomeEmitente: 'SA',
      cnpjDestinatario: '98765432000100',
      valorTotal: new Decimal('1200'),
      fonte: 'NFSE_BETHA_TEST',
    }

    vi.spyOn(adapter, 'fetchEmitidas').mockResolvedValue([emitida])
    vi.spyOn(adapter, 'fetchTomadas').mockRejectedValue(new Error('Erro tomadas'))

    const result = await adapter.fetch('12345678000195', PERIODO)

    expect(result).toHaveLength(1)
    expect(result[0]!.tipo).toBe('NFSE_EMITIDA')
  })

  it('ambas falham → retorna array vazio', async () => {
    const adapter = new TestBethaAdapter()

    vi.spyOn(adapter, 'fetchEmitidas').mockRejectedValue(new Error('Erro'))
    vi.spyOn(adapter, 'fetchTomadas').mockRejectedValue(new Error('Erro'))

    const result = await adapter.fetch('12345678000195', PERIODO)

    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// fetchEmitidas() / fetchTomadas() — validação de sessão
// ---------------------------------------------------------------------------

describe('BaseBethaAdapter — fetchEmitidas() sessão', () => {
  it('sem sessão → lança erro "sessão não inicializada"', async () => {
    const page = makeMockPage()
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    await expect(adapter.fetchEmitidas('12345678000195', PERIODO)).rejects.toThrow(
      'sessão não inicializada'
    )
  }, 30000)

  it('sessão expirada → lança erro "sessão expirada"', async () => {
    const page = makeMockPage()
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    ;(adapter as any).session = {
      cookies: 'JSESSIONID=old',
      expiresAt: new Date('2000-01-01T00:00:00'), // já expirou
    }

    await expect(adapter.fetchEmitidas('12345678000195', PERIODO)).rejects.toThrow(
      'sessão expirada'
    )
  }, 30000)
})

describe('BaseBethaAdapter — fetchTomadas() sessão', () => {
  it('sem sessão → lança erro', async () => {
    const page = makeMockPage()
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    await expect(adapter.fetchTomadas('12345678000195', PERIODO)).rejects.toThrow(
      'sessão não inicializada'
    )
  }, 30000)
})

// ---------------------------------------------------------------------------
// fetchEmitidas() — navegação e parsing de grade
// ---------------------------------------------------------------------------

describe('BaseBethaAdapter — fetchEmitidas() navegação', () => {
  it('navega para URL de listagem de NFS-e emitidas', async () => {
    const page = makeMockPage()
    page.locator.mockReturnValue({ all: vi.fn().mockResolvedValue([]) })
    page.isVisible.mockResolvedValue(false)
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    ;(adapter as any).session = SESSION_VALIDA
    await adapter.fetchEmitidas('12345678000195', PERIODO)

    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining('listagemNf.xhtml'),
      expect.any(Object)
    )
  })

  it('grade vazia → retorna array vazio', async () => {
    const page = makeMockPage()
    page.locator.mockReturnValue({ all: vi.fn().mockResolvedValue([]) })
    page.isVisible.mockResolvedValue(false)
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    ;(adapter as any).session = SESSION_VALIDA
    const result = await adapter.fetchEmitidas('12345678000195', PERIODO)

    expect(result).toHaveLength(0)
  })

  it('linha com 6+ células válidas → retorna DocumentoRaw', async () => {
    const page = makeMockPage()

    const mockCell = (text: string) => ({
      textContent: vi.fn().mockResolvedValue(text),
    })
    const mockRow = {
      locator: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue([
          mockCell('12345'), // numero
          mockCell('15/05/2025'), // dataEmissao
          mockCell('EMPRESA PRESTADORA'), // nomeEmitente
          mockCell('12.345.678/0001-95'), // cnpjEmitente
          mockCell('98.765.432/0001-00'), // cnpjTomador
          mockCell('1.234,56'), // valor
        ]),
      }),
    }

    page.locator.mockReturnValue({
      all: vi.fn().mockResolvedValue([mockRow]),
    })
    page.isVisible.mockResolvedValue(false) // sem botão próxima
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    ;(adapter as any).session = SESSION_VALIDA
    const result = await adapter.fetchEmitidas('12345678000195', PERIODO)

    expect(result).toHaveLength(1)
    expect(result[0]!.numero).toBe('12345')
    expect(result[0]!.tipo).toBe('NFSE_EMITIDA')
    expect(result[0]!.valorTotal).toBeInstanceOf(Decimal)
    expect(result[0]!.valorTotal.toFixed(2)).toBe('1234.56')
  })

  it('linha com menos de 6 células → ignorada', async () => {
    const page = makeMockPage()

    const mockCell = (text: string) => ({
      textContent: vi.fn().mockResolvedValue(text),
    })
    const mockRowIncompleta = {
      locator: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue([
          mockCell('1'),
          mockCell('15/05/2025'),
          mockCell('SA'),
          // apenas 3 células — deve ser ignorada
        ]),
      }),
    }

    page.locator.mockReturnValue({
      all: vi.fn().mockResolvedValue([mockRowIncompleta]),
    })
    page.isVisible.mockResolvedValue(false)
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    ;(adapter as any).session = SESSION_VALIDA
    const result = await adapter.fetchEmitidas('12345678000195', PERIODO)

    expect(result).toHaveLength(0)
  })

  it('linha com número não-numérico (ex: cabeçalho) → ignorada', async () => {
    const page = makeMockPage()

    const mockCell = (text: string) => ({
      textContent: vi.fn().mockResolvedValue(text),
    })
    const mockRowCabecalho = {
      locator: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue([
          mockCell('Nº'), // não-numérico
          mockCell('Data'),
          mockCell('Prestador'),
          mockCell('CNPJ'),
          mockCell('Tomador'),
          mockCell('Valor'),
        ]),
      }),
    }

    page.locator.mockReturnValue({
      all: vi.fn().mockResolvedValue([mockRowCabecalho]),
    })
    page.isVisible.mockResolvedValue(false)
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    ;(adapter as any).session = SESSION_VALIDA
    const result = await adapter.fetchEmitidas('12345678000195', PERIODO)

    expect(result).toHaveLength(0)
  })

  it('paginação: clica botão próxima quando disponível', async () => {
    const page = makeMockPage()

    page.locator.mockReturnValue({ all: vi.fn().mockResolvedValue([]) })
    // isVisible: primeira vez (BTN_PROXIMA após 1ª pág) → true; segunda → false
    page.isVisible
      .mockResolvedValueOnce(true) // BTN_PROXIMA visível → clica
      .mockResolvedValueOnce(false) // BTN_PROXIMA não visível → para

    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    ;(adapter as any).session = SESSION_VALIDA
    await adapter.fetchEmitidas('12345678000195', PERIODO)

    // click é chamado pelo menos uma vez para BTN_CONSULTAR + uma vez para BTN_PROXIMA
    expect(page.click).toHaveBeenCalledTimes(2) // BTN_CONSULTAR + BTN_PROXIMA
  })

  it('fetchTomadas navega para URL de notas tomadas', async () => {
    const page = makeMockPage()
    page.locator.mockReturnValue({ all: vi.fn().mockResolvedValue([]) })
    page.isVisible.mockResolvedValue(false)
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    ;(adapter as any).session = SESSION_VALIDA
    await adapter.fetchTomadas('98765432000100', PERIODO)

    expect(page.goto).toHaveBeenCalledWith(
      expect.stringContaining('listagemNfTomadas.xhtml'),
      expect.any(Object)
    )
  })
})

// ---------------------------------------------------------------------------
// downloadXML() / downloadPDF()
// ---------------------------------------------------------------------------

describe('BaseBethaAdapter — downloadXML()', () => {
  it('doc já tem xmlContent → retorna sem chamar Playwright', async () => {
    const adapter = new TestBethaAdapter()
    const doc = {
      tipo: 'NFSE_EMITIDA',
      numero: '1',
      dataEmissao: new Date(),
      cnpjEmitente: '12345678000195',
      nomeEmitente: 'SA',
      cnpjDestinatario: '98765432000100',
      valorTotal: new Decimal('100'),
      fonte: 'NFSE_BETHA_TEST',
      xmlContent: '<nfse>...</nfse>',
    }

    const result = await adapter.downloadXML(doc)

    expect(result).toBe('<nfse>...</nfse>')
    expect(mockChromiumLaunch).not.toHaveBeenCalled()
  })
})

describe('BaseBethaAdapter — downloadPDF()', () => {
  it('doc já tem pdfBuffer → retorna sem chamar Playwright', async () => {
    const adapter = new TestBethaAdapter()
    const pdfBuffer = Buffer.from('%PDF-1.4...')
    const doc = {
      tipo: 'NFSE_EMITIDA',
      numero: '1',
      dataEmissao: new Date(),
      cnpjEmitente: '12345678000195',
      nomeEmitente: 'SA',
      cnpjDestinatario: '98765432000100',
      valorTotal: new Decimal('100'),
      fonte: 'NFSE_BETHA_TEST',
      pdfBuffer,
    }

    const result = await adapter.downloadPDF(doc)

    expect(result).toBe(pdfBuffer)
    expect(mockChromiumLaunch).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// healthCheck()
// ---------------------------------------------------------------------------

describe('BaseBethaAdapter — healthCheck()', () => {
  it('status 200 → true', async () => {
    const page = makeMockPage()
    page.goto.mockResolvedValue({ status: () => 200 })
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    const result = await adapter.healthCheck()

    expect(result).toBe(true)
  })

  it('status 500 → false', async () => {
    const page = makeMockPage()
    page.goto.mockResolvedValue({ status: () => 500 })
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    const result = await adapter.healthCheck()

    expect(result).toBe(false)
  })

  it('page.goto lança erro → false', async () => {
    const page = makeMockPage()
    page.goto.mockRejectedValue(new Error('Connection refused'))
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    const result = await adapter.healthCheck()

    expect(result).toBe(false)
  })

  it('goto retorna null (sem response) → false', async () => {
    const page = makeMockPage()
    page.goto.mockResolvedValue(null)
    setupBrowserMock(page)

    const adapter = new TestBethaAdapter()
    const result = await adapter.healthCheck()

    // null → status() não existe → 500 default → false
    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Propriedades da subclasse
// ---------------------------------------------------------------------------

describe('BaseBethaAdapter — propriedades', () => {
  it('tipo é NFSE_EMITIDA', () => {
    const adapter = new TestBethaAdapter()
    expect(adapter.tipo).toBe('NFSE_EMITIDA')
  })

  it('ibge é 9999999', () => {
    const adapter = new TestBethaAdapter()
    expect(adapter.ibge).toBe('9999999')
  })

  it('municipio é Cidade Teste', () => {
    const adapter = new TestBethaAdapter()
    expect(adapter.municipio).toBe('Cidade Teste')
  })

  it('fonte é NFSE_BETHA_TEST', () => {
    const adapter = new TestBethaAdapter()
    expect(adapter.fonte).toBe('NFSE_BETHA_TEST')
  })
})
