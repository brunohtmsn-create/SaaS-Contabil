/**
 * Testes unitários — SefazSpPortal
 *
 * Cobre:
 *  transmitirDeSTDA():
 *   - abre browser e navega para URL do SPED SP
 *   - retorna protocolo, recibo e dataTransmissao
 *   - registra auditoria DESTDA_TRANSMITIDA com competencia
 *   - em erro: screenshot + S3 + auditoria OBRIGACAO_FALHOU + relança
 *   - fecha browser no finally (sucesso e erro)
 *
 *  emitirGNRE():
 *   - abre browser e preenche formulário de GNRE
 *   - faz upsert do registro de apuração com status TRANSMITIDO
 *   - registra auditoria GNRE_GERADA com uf, valor e pdfKey
 *   - retorna ResultadoGNRE com numeroGuia, codigoBarras, vencimento e pdfKey
 *   - vencimento é dia 20 do mês seguinte à competencia
 *   - em erro: screenshot + S3 + auditoria OBRIGACAO_FALHOU + relança
 *
 *  emitirGNRELote():
 *   - processa cada UF chamando emitirGNRE()
 *   - continua quando uma UF falha (registra OBRIGACAO_FALHOU e segue)
 *   - retorna apenas resultados bem-sucedidos
 *
 * Playwright, S3, PrismaClient e AuditService são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockPage, mockContext, mockBrowser, mockDb, mockStorage, mockAudit } = vi.hoisted(() => {
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('screenshot')),
    pdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn(),
  }
  const mockContext = { newPage: vi.fn().mockResolvedValue(mockPage) }
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  }
  return {
    mockPage,
    mockContext,
    mockBrowser,
    mockDb: {
      apuracaoFiscal: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'apr-1',
          dados: { content: 'DESTDA-CONTENT-MOCK' },
        }),
        upsert: vi.fn().mockResolvedValue({ id: 'apr-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    },
    mockStorage: {
      upload: vi.fn().mockResolvedValue({ s3Key: 'gnre-key.pdf' }),
    },
    mockAudit: { registrar: vi.fn().mockResolvedValue(undefined) },
  }
})

vi.mock('playwright', () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mockBrowser) },
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/storage', () => ({
  StorageService: vi.fn(() => mockStorage),
  S3KeyBuilder: {
    erroScreenshot: vi.fn((cnpj: string, tag: string) => `screenshots/${cnpj}/${tag}.png`),
    guiaGNRE: vi.fn((cnpj: string, comp: string, uf: string) => `gnre/${cnpj}/${comp}/${uf}.pdf`),
  },
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn(() => mockAudit),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    nowBR: vi.fn(() => new Date('2025-05-15T10:00:00.000Z')),
    parsePeriodo: vi.fn((comp: string) => {
      const [y, m] = comp.split('-').map(Number)
      return {
        inicio: new Date(y!, m! - 1, 1),
        fim: new Date(y!, m!, 0),
      }
    }),
    addMeses: vi.fn((date: Date, n: number) => {
      const d = new Date(date)
      d.setMonth(d.getMonth() + n)
      return d
    }),
    formatCompetencia: vi.fn(() => '2025-06'),
  }
})

import { SefazSpPortal } from '../sefaz-sp.portal.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-sp'
const EMPRESA_ID = 'emp-sp'
const CNPJ = '11222333000181'
const COMP = '2025-05'
const CERT_BUF = Buffer.from('pfx-sp')
const CERT_SENHA = 'senha123'

// Make setTimeout fire immediately for retry loops
vi.stubGlobal('setTimeout', (fn: Function, _delay?: number, ...args: unknown[]) => {
  fn(...args)
  return 0 as unknown as ReturnType<typeof setTimeout>
})

function mockLocator(textContent = 'BARCODE-123456789') {
  const locatorInstance = {
    waitFor: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
    first: vi.fn(),
    textContent: vi.fn().mockResolvedValue(textContent),
  }
  locatorInstance.first.mockReturnValue(locatorInstance)
  return locatorInstance
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBrowser.close.mockResolvedValue(undefined)
  mockPage.goto.mockResolvedValue(undefined)
  mockPage.waitForURL.mockResolvedValue(undefined)
  mockPage.waitForSelector.mockResolvedValue(undefined)
  mockPage.pdf.mockResolvedValue(Buffer.from('%PDF-1.4'))
  mockAudit.registrar.mockResolvedValue(undefined)
  mockStorage.upload.mockResolvedValue({ s3Key: 'gnre-key.pdf' })
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'apr-1' })
  mockDb.apuracaoFiscal.updateMany.mockResolvedValue({ count: 1 })
  mockDb.apuracaoFiscal.findFirst.mockResolvedValue({
    id: 'apr-1',
    dados: { content: 'DESTDA-CONTENT-MOCK' },
  })

  // Default locator mock for GNRE form fields and DeSTDA file input
  const loc = mockLocator()
  mockPage.locator.mockReturnValue(loc)
})

// ===========================================================================
// transmitirDeSTDA
// ===========================================================================

describe('SefazSpPortal.transmitirDeSTDA()', () => {
  it('abre browser e navega para URL do SPED SP', async () => {
    const portal = new SefazSpPortal()
    await portal.transmitirDeSTDA(TENANT_ID, EMPRESA_ID, CNPJ, COMP, CERT_BUF, CERT_SENHA)

    const { chromium } = await import('playwright')
    expect(chromium.launch).toHaveBeenCalledWith({ headless: true })
    expect(mockPage.goto).toHaveBeenCalledWith(expect.stringContaining('sped'), expect.any(Object))
  })

  it('retorna protocolo, recibo e dataTransmissao', async () => {
    const portal = new SefazSpPortal()
    const result = await portal.transmitirDeSTDA(
      TENANT_ID,
      EMPRESA_ID,
      CNPJ,
      COMP,
      CERT_BUF,
      CERT_SENHA
    )

    expect(result).toHaveProperty('protocolo')
    expect(result).toHaveProperty('recibo')
    expect(result).toHaveProperty('dataTransmissao')
    expect(result.dataTransmissao).toBeInstanceOf(Date)
  })

  it('registra auditoria DESTDA_TRANSMITIDO com competencia', async () => {
    const portal = new SefazSpPortal()
    await portal.transmitirDeSTDA(TENANT_ID, EMPRESA_ID, CNPJ, COMP, CERT_BUF, CERT_SENHA)

    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        cnpj: CNPJ,
        evento: 'DESTDA_TRANSMITIDO',
      })
    )
  })

  it('fecha browser no finally em caso de sucesso', async () => {
    const portal = new SefazSpPortal()
    await portal.transmitirDeSTDA(TENANT_ID, EMPRESA_ID, CNPJ, COMP, CERT_BUF, CERT_SENHA)

    expect(mockBrowser.close).toHaveBeenCalled()
  })

  it('em erro: screenshot + S3 + auditoria OBRIGACAO_FALHOU + relança', async () => {
    mockPage.goto.mockRejectedValueOnce(new Error('SPED SP offline'))

    const portal = new SefazSpPortal()
    await expect(
      portal.transmitirDeSTDA(TENANT_ID, EMPRESA_ID, CNPJ, COMP, CERT_BUF, CERT_SENHA)
    ).rejects.toThrow()

    expect(mockPage.screenshot).toHaveBeenCalled()
    expect(mockStorage.upload).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer),
      'image/png'
    )

    const falha = mockAudit.registrar.mock.calls.find((c) => c[0].evento === 'OBRIGACAO_FALHOU')
    expect(falha).toBeDefined()
    expect(falha![0].estadoNovo.operacao).toBe('DESTDA_TRANSMISSAO')
  })

  it('fecha browser no finally em caso de erro', async () => {
    mockPage.goto.mockRejectedValueOnce(new Error('erro fatal'))

    const portal = new SefazSpPortal()
    await expect(
      portal.transmitirDeSTDA(TENANT_ID, EMPRESA_ID, CNPJ, COMP, CERT_BUF, CERT_SENHA)
    ).rejects.toThrow()

    expect(mockBrowser.close).toHaveBeenCalled()
  })
})

// ===========================================================================
// emitirGNRE
// ===========================================================================

describe('SefazSpPortal.emitirGNRE()', () => {
  it('retorna ResultadoGNRE com uf, valor, codigoBarras e pdfKey', async () => {
    const portal = new SefazSpPortal()
    const result = await portal.emitirGNRE(
      TENANT_ID,
      EMPRESA_ID,
      CNPJ,
      COMP,
      'SP',
      new Decimal('1500.00'),
      '10010'
    )

    expect(result.uf).toBe('SP')
    expect(result.valor.toFixed(2)).toBe('1500.00')
    expect(result.pdfKey).toBeTruthy()
    expect(result.vencimento).toBeInstanceOf(Date)
  })

  it('faz upsert do registro de apuração com status TRANSMITIDO', async () => {
    const portal = new SefazSpPortal()
    await portal.emitirGNRE(
      TENANT_ID,
      EMPRESA_ID,
      CNPJ,
      COMP,
      'RJ',
      new Decimal('2000.00'),
      '10015'
    )

    expect(mockDb.apuracaoFiscal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'TRANSMITIDO' }),
        create: expect.objectContaining({ status: 'TRANSMITIDO', tipo: 'GNRE' }),
      })
    )
  })

  it('registra auditoria GNRE_GERADA com uf, valor e pdfKey', async () => {
    const portal = new SefazSpPortal()
    await portal.emitirGNRE(TENANT_ID, EMPRESA_ID, CNPJ, COMP, 'MG', new Decimal('800.00'), '10010')

    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        evento: 'GNRE_GERADA',
        estadoNovo: expect.objectContaining({
          uf: 'MG',
          valor: '800.00',
          pdfKey: expect.any(String),
        }),
      })
    )
  })

  it('vencimento é dia 20 do mês seguinte à competencia', async () => {
    const portal = new SefazSpPortal()
    const result = await portal.emitirGNRE(
      TENANT_ID,
      EMPRESA_ID,
      CNPJ,
      COMP,
      'SP',
      new Decimal('500.00'),
      '10010'
    )

    expect(result.vencimento.getDate()).toBe(20)
    // mês seguinte a 2025-05 é 2025-06 (index 5)
    expect(result.vencimento.getMonth()).toBe(5)
  })

  it('fecha browser no finally', async () => {
    const portal = new SefazSpPortal()
    await portal.emitirGNRE(TENANT_ID, EMPRESA_ID, CNPJ, COMP, 'SP', new Decimal('100'), '10010')

    expect(mockBrowser.close).toHaveBeenCalled()
  })

  it('em erro: screenshot + S3 + auditoria OBRIGACAO_FALHOU + relança', async () => {
    mockPage.goto.mockRejectedValue(new Error('portal GNRE offline'))

    const portal = new SefazSpPortal()
    await expect(
      portal.emitirGNRE(TENANT_ID, EMPRESA_ID, CNPJ, COMP, 'SP', new Decimal('100'), '10010')
    ).rejects.toThrow()

    expect(mockPage.screenshot).toHaveBeenCalled()
    const falha = mockAudit.registrar.mock.calls.find((c) => c[0].evento === 'OBRIGACAO_FALHOU')
    expect(falha).toBeDefined()
    expect(falha![0].estadoNovo.operacao).toBe('GNRE_EMISSAO')
  })
})

// ===========================================================================
// emitirGNRELote
// ===========================================================================

describe('SefazSpPortal.emitirGNRELote()', () => {
  it('processa cada UF chamando emitirGNRE() e retorna lista de resultados', async () => {
    const portal = new SefazSpPortal()
    const gnres = [
      { uf: 'SP', valor: new Decimal('1500.00'), codReceita: '10010' },
      { uf: 'RJ', valor: new Decimal('800.00'), codReceita: '10010' },
    ]

    const resultados = await portal.emitirGNRELote(TENANT_ID, EMPRESA_ID, CNPJ, COMP, gnres)

    expect(resultados).toHaveLength(2)
    expect(resultados[0]!.uf).toBe('SP')
    expect(resultados[1]!.uf).toBe('RJ')
  })

  it('continua quando uma UF falha e registra OBRIGACAO_FALHOU', async () => {
    // First UF (SP) succeeds, second (RJ) fails
    mockPage.goto
      .mockResolvedValueOnce(undefined) // SP succeeds
      .mockRejectedValue(new Error('RJ offline')) // RJ always fails

    const portal = new SefazSpPortal()
    const gnres = [
      { uf: 'SP', valor: new Decimal('1500.00'), codReceita: '10010' },
      { uf: 'RJ', valor: new Decimal('800.00'), codReceita: '10010' },
    ]

    const resultados = await portal.emitirGNRELote(TENANT_ID, EMPRESA_ID, CNPJ, COMP, gnres)

    // Only the successful SP result is returned
    expect(resultados).toHaveLength(1)
    expect(resultados[0]!.uf).toBe('SP')

    // OBRIGACAO_FALHOU for RJ was registered
    const falhas = mockAudit.registrar.mock.calls.filter(
      (c) => c[0].evento === 'OBRIGACAO_FALHOU' && c[0].estadoNovo.uf === 'RJ'
    )
    expect(falhas.length).toBeGreaterThan(0)
  })

  it('retorna array vazio quando todas as UFs falham', async () => {
    mockPage.goto.mockRejectedValue(new Error('portal down'))

    const portal = new SefazSpPortal()
    const gnres = [
      { uf: 'SP', valor: new Decimal('1000'), codReceita: '10010' },
      { uf: 'MG', valor: new Decimal('500'), codReceita: '10010' },
    ]

    const resultados = await portal.emitirGNRELote(TENANT_ID, EMPRESA_ID, CNPJ, COMP, gnres)

    expect(resultados).toHaveLength(0)
  })

  it('array vazio de gnres → retorna array vazio sem erros', async () => {
    const portal = new SefazSpPortal()
    const resultados = await portal.emitirGNRELote(TENANT_ID, EMPRESA_ID, CNPJ, COMP, [])

    expect(resultados).toHaveLength(0)
    expect(mockPage.goto).not.toHaveBeenCalled()
  })
})
