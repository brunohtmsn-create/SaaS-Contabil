/**
 * Testes unitários — EcacPortal
 *
 * Cobre:
 *  - consultarSituacaoFiscal(): navega para URL do e-CAC e registra auditoria de acesso
 *  - consultarSituacaoFiscal(): em caso de erro, faz screenshot e salva no S3
 *  - consultarSituacaoFiscal(): em caso de erro, registra auditoria de falha e relança
 *  - consultarSituacaoFiscal(): retorna situacao e pendencias
 *  - baixarCertidao(): registra auditoria CERTIDAO_BAIXADA com competencia correta
 *  - baixarCertidao(): retorna chave S3 da certidão
 *
 * Playwright (chromium), S3 e PrismaClient são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockPage, mockContext, mockBrowser, mockStorage, mockAudit, mockDb } = vi.hoisted(() => {
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('screenshot')),
    waitForSelector: vi.fn().mockResolvedValue(null),
    locator: vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue([]) }),
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
    mockStorage: { upload: vi.fn().mockResolvedValue({ s3Key: 'screenshots/ecac.png' }) },
    mockAudit: { registrar: vi.fn().mockResolvedValue(undefined) },
    mockDb: { alerta: { create: vi.fn().mockResolvedValue({ id: 'alerta-1' }) } },
  }
})

vi.mock('playwright', () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mockBrowser) },
}))

vi.mock('@saas-contabil/storage', () => ({
  StorageService: vi.fn(() => mockStorage),
  S3KeyBuilder: {
    erroScreenshot: vi.fn((cnpj: string, tag: string) => `screenshots/erros/${cnpj}/${tag}.png`),
  },
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn(() => mockAudit),
}))

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    nowBR: vi.fn(() => new Date('2025-05-15T10:00:00.000Z')),
  }
})

import { EcacPortal } from '../ecac.portal.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-ecac'
const EMPRESA_ID = 'emp-ecac'
const CNPJ = '11222333000181'
const CERT_BUF = Buffer.from('pfx-data')
const COMP = '2025-05'

// Make setTimeout fire immediately so withRetry delays don't slow tests
vi.stubGlobal('setTimeout', (fn: Function, _delay?: number, ...args: unknown[]) => {
  fn(...args)
  return 0 as unknown as ReturnType<typeof setTimeout>
})

beforeEach(() => {
  vi.clearAllMocks()
  mockBrowser.close.mockResolvedValue(undefined)
  mockAudit.registrar.mockResolvedValue(undefined)
  mockStorage.upload.mockResolvedValue({ s3Key: 'screenshots/ecac.png' })
  mockPage.goto.mockResolvedValue(undefined)
  mockPage.waitForSelector.mockResolvedValue(null)
  mockPage.locator.mockReturnValue({ all: vi.fn().mockResolvedValue([]) })
  mockDb.alerta.create.mockResolvedValue({ id: 'alerta-1' })
})

// ===========================================================================
// consultarSituacaoFiscal
// ===========================================================================

describe('EcacPortal.consultarSituacaoFiscal()', () => {
  it('abre browser, navega para URL do e-CAC e fecha browser', async () => {
    const portal = new EcacPortal()
    await portal.consultarSituacaoFiscal(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)

    const { chromium } = await import('playwright')
    expect(chromium.launch).toHaveBeenCalledWith({ headless: true })
    expect(mockPage.goto).toHaveBeenCalledWith(
      expect.stringContaining('receita.fazenda.gov.br'),
      expect.any(Object)
    )
    expect(mockBrowser.close).toHaveBeenCalled()
  })

  it('registra auditoria PORTAL_ACESSO_REALIZADO com portal=ECAC', async () => {
    const portal = new EcacPortal()
    await portal.consultarSituacaoFiscal(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)

    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        cnpj: CNPJ,
        evento: 'PORTAL_ACESSO_REALIZADO',
        estadoNovo: expect.objectContaining({ portal: 'ECAC' }),
      })
    )
  })

  it('retorna situacao e pendencias', async () => {
    const portal = new EcacPortal()
    const result = await portal.consultarSituacaoFiscal(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)

    expect(result).toHaveProperty('situacao')
    expect(result).toHaveProperty('pendencias')
    expect(Array.isArray(result.pendencias)).toBe(true)
  })

  it('em caso de erro: faz screenshot e salva no S3', async () => {
    // Fail all 4 retry attempts
    mockPage.goto
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))

    const portal = new EcacPortal()
    await expect(
      portal.consultarSituacaoFiscal(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)
    ).rejects.toThrow()

    expect(mockPage.screenshot).toHaveBeenCalled()
    expect(mockStorage.upload).toHaveBeenCalledWith(
      expect.stringContaining('ecac'),
      expect.any(Buffer),
      'image/png'
    )
  })

  it('em caso de erro: registra auditoria PORTAL_ACESSO_FALHOU', async () => {
    mockPage.goto
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockRejectedValueOnce(new Error('connection refused'))

    const portal = new EcacPortal()
    await expect(
      portal.consultarSituacaoFiscal(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)
    ).rejects.toThrow()

    const eventosFalha = mockAudit.registrar.mock.calls
      .map((c) => c[0].evento)
      .filter((e: string) => e === 'PORTAL_ACESSO_FALHOU')
    expect(eventosFalha.length).toBeGreaterThan(0)
  })

  it('em caso de erro: fecha browser mesmo com falha (finally)', async () => {
    mockPage.goto
      .mockRejectedValueOnce(new Error('nav error'))
      .mockRejectedValueOnce(new Error('nav error'))
      .mockRejectedValueOnce(new Error('nav error'))
      .mockRejectedValueOnce(new Error('nav error'))

    const portal = new EcacPortal()
    await expect(
      portal.consultarSituacaoFiscal(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)
    ).rejects.toThrow()

    expect(mockBrowser.close).toHaveBeenCalled()
  })

  it('em caso de erro: inclui mensagem de erro no estadoNovo da auditoria', async () => {
    const errMsg = 'SSL handshake failed'
    mockPage.goto
      .mockRejectedValueOnce(new Error(errMsg))
      .mockRejectedValueOnce(new Error(errMsg))
      .mockRejectedValueOnce(new Error(errMsg))
      .mockRejectedValueOnce(new Error(errMsg))

    const portal = new EcacPortal()
    await expect(
      portal.consultarSituacaoFiscal(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)
    ).rejects.toThrow()

    const falhaCall = mockAudit.registrar.mock.calls.find(
      (c) => c[0].evento === 'PORTAL_ACESSO_FALHOU'
    )
    expect(falhaCall).toBeDefined()
    expect(falhaCall![0].estadoNovo.erro).toContain(errMsg)
  })
})

// ===========================================================================
// baixarCertidao
// ===========================================================================

describe('EcacPortal.baixarCertidao()', () => {
  it('registra auditoria CERTIDAO_BAIXADA com competencia correta', async () => {
    const portal = new EcacPortal()
    await portal.baixarCertidao(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF, COMP)

    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        cnpj: CNPJ,
        evento: 'CERTIDAO_BAIXADA',
        estadoNovo: expect.objectContaining({ competencia: COMP, portal: 'ECAC' }),
      })
    )
  })

  it('retorna chave S3 da certidão', async () => {
    const portal = new EcacPortal()
    const result = await portal.baixarCertidao(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF, COMP)

    expect(typeof result).toBe('string')
    expect(result).toBeTruthy()
  })

  it('chave retornada contém competencia', async () => {
    const portal = new EcacPortal()
    const result = await portal.baixarCertidao(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF, COMP)

    expect(result).toContain(COMP)
  })
})

// ===========================================================================
// sincronizarDebitos
// ===========================================================================

describe('EcacPortal.sincronizarDebitos()', () => {
  it('abre browser, navega para URLs do e-CAC e fecha browser', async () => {
    const portal = new EcacPortal()
    await portal.sincronizarDebitos(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)

    const { chromium } = await import('playwright')
    expect(chromium.launch).toHaveBeenCalledWith({ headless: true })
    expect(mockPage.goto).toHaveBeenCalledWith(
      expect.stringContaining('receita.fazenda.gov.br'),
      expect.any(Object)
    )
    expect(mockBrowser.close).toHaveBeenCalled()
  })

  it('sem tabela de débitos → retorna totalDebitos=0 e debitos=[]', async () => {
    mockPage.waitForSelector.mockResolvedValue(null)
    mockPage.locator.mockReturnValue({ all: vi.fn().mockResolvedValue([]) })

    const portal = new EcacPortal()
    const result = await portal.sincronizarDebitos(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)

    expect(result.totalDebitos).toBe(0)
    expect(result.debitos).toEqual([])
    expect(mockDb.alerta.create).not.toHaveBeenCalled()
  })

  it('com débitos → extrai linhas e retorna lista', async () => {
    const mockColuna = (texto: string) => ({
      textContent: vi.fn().mockResolvedValue(texto),
    })
    const mockLinha = {
      locator: vi.fn().mockReturnValue({
        all: vi
          .fn()
          .mockResolvedValue([
            mockColuna('IRPJ 2024'),
            mockColuna('R$ 1.500,00'),
            mockColuna('20/03/2025'),
            mockColuna('PENDENTE'),
          ]),
      }),
    }
    mockPage.waitForSelector.mockResolvedValue({ selector: 'found' })
    mockPage.locator.mockReturnValueOnce({ all: vi.fn().mockResolvedValue([mockLinha]) }) // tbody tr

    const portal = new EcacPortal()
    const result = await portal.sincronizarDebitos(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)

    expect(result.totalDebitos).toBe(1)
    expect(result.debitos[0]).toMatchObject({
      descricao: 'IRPJ 2024',
      valor: 'R$ 1.500,00',
      situacao: 'PENDENTE',
    })
  })

  it('com débitos → cria alerta RISCO_EXCLUSAO_SN no banco', async () => {
    const mockColuna = (texto: string) => ({
      textContent: vi.fn().mockResolvedValue(texto),
    })
    const mockLinha = {
      locator: vi.fn().mockReturnValue({
        all: vi
          .fn()
          .mockResolvedValue([
            mockColuna('PGDAS 2024-12'),
            mockColuna('R$ 500,00'),
            mockColuna('15/01/2025'),
            mockColuna('VENCIDO'),
          ]),
      }),
    }
    mockPage.waitForSelector.mockResolvedValue({ selector: 'found' })
    mockPage.locator.mockReturnValueOnce({ all: vi.fn().mockResolvedValue([mockLinha]) })

    const portal = new EcacPortal()
    await portal.sincronizarDebitos(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)

    expect(mockDb.alerta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          empresaId: EMPRESA_ID,
          tipo: 'RISCO_EXCLUSAO_SN',
          mensagem: expect.stringContaining(CNPJ),
        }),
      })
    )
  })

  it('registra auditoria PORTAL_ACESSO_REALIZADO com operação SINCRONIZAR_DEBITOS', async () => {
    const portal = new EcacPortal()
    await portal.sincronizarDebitos(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)

    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        cnpj: CNPJ,
        evento: 'PORTAL_ACESSO_REALIZADO',
        estadoNovo: expect.objectContaining({ operacao: 'SINCRONIZAR_DEBITOS' }),
      })
    )
  })

  it('em caso de erro: faz screenshot e salva no S3', async () => {
    mockPage.goto
      .mockRejectedValueOnce(new Error('portal indisponível'))
      .mockRejectedValueOnce(new Error('portal indisponível'))
      .mockRejectedValueOnce(new Error('portal indisponível'))
      .mockRejectedValueOnce(new Error('portal indisponível'))

    const portal = new EcacPortal()
    await expect(portal.sincronizarDebitos(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)).rejects.toThrow()

    expect(mockPage.screenshot).toHaveBeenCalled()
    expect(mockStorage.upload).toHaveBeenCalledWith(
      expect.stringContaining('ecac'),
      expect.any(Buffer),
      'image/png'
    )
  })

  it('em caso de erro: registra auditoria PORTAL_ACESSO_FALHOU e relança erro', async () => {
    const errMsg = 'timeout na navegação'
    mockPage.goto
      .mockRejectedValueOnce(new Error(errMsg))
      .mockRejectedValueOnce(new Error(errMsg))
      .mockRejectedValueOnce(new Error(errMsg))
      .mockRejectedValueOnce(new Error(errMsg))

    const portal = new EcacPortal()
    await expect(portal.sincronizarDebitos(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)).rejects.toThrow(
      errMsg
    )

    const falhaCall = mockAudit.registrar.mock.calls.find(
      (c) => c[0].evento === 'PORTAL_ACESSO_FALHOU'
    )
    expect(falhaCall).toBeDefined()
    expect(falhaCall![0].estadoNovo.operacao).toBe('SINCRONIZAR_DEBITOS')
  })

  it('em caso de erro: fecha browser (finally)', async () => {
    mockPage.goto
      .mockRejectedValueOnce(new Error('err'))
      .mockRejectedValueOnce(new Error('err'))
      .mockRejectedValueOnce(new Error('err'))
      .mockRejectedValueOnce(new Error('err'))

    const portal = new EcacPortal()
    await expect(portal.sincronizarDebitos(TENANT_ID, EMPRESA_ID, CNPJ, CERT_BUF)).rejects.toThrow()

    expect(mockBrowser.close).toHaveBeenCalled()
  })
})
