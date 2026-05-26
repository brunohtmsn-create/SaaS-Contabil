/**
 * Testes unitários — SimplesNacionalPortal
 *
 * Cobre:
 *  - transmitirPGDAS(): abre browser e navega para URL do Simples Nacional
 *  - transmitirPGDAS(): atualiza status da apuração para TRANSMITIDO com recibo gerado
 *  - transmitirPGDAS(): registra auditoria PGDAS_TRANSMITIDO com tenantId, cnpj e competencia
 *  - transmitirPGDAS(): retorna string de recibo não-vazia
 *  - transmitirPGDAS(): recibo contém CNPJ e competencia
 *  - transmitirPGDAS(): em caso de erro, faz screenshot e salva no S3
 *  - transmitirPGDAS(): em caso de erro, registra auditoria OBRIGACAO_FALHOU e relança
 *  - transmitirPGDAS(): fecha browser em caso de erro (finally)
 *  - transmitirPGDAS(): filtra updateMany por tenantId (isolamento multi-tenant)
 *
 * Playwright, PrismaClient, StorageService e AuditService são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockPage, mockContext, mockBrowser, mockDb, mockStorage, mockAudit } = vi.hoisted(() => {
  const mockPage = {
    goto: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('screenshot-pgdas')),
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
      apuracaoFiscal: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    },
    mockStorage: {
      upload: vi.fn().mockResolvedValue({ s3Key: 'screenshots/pgdas.png' }),
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
    erroScreenshot: vi.fn((cnpj: string, tag: string) => `screenshots/erros/${cnpj}/${tag}.png`),
  },
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn(() => mockAudit),
}))

import { SimplesNacionalPortal } from '../simples-nacional.portal.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-sn'
const EMPRESA_ID = 'emp-sn'
const CNPJ = '11222333000181'
const COMP = '2025-05'
const DADOS_PGDAS = { totalReceitas: '50000.00', anexoIII: '50000.00' }

beforeEach(() => {
  vi.clearAllMocks()
  mockPage.goto.mockResolvedValue(undefined)
  mockBrowser.close.mockResolvedValue(undefined)
  mockDb.apuracaoFiscal.updateMany.mockResolvedValue({ count: 1 })
  mockAudit.registrar.mockResolvedValue(undefined)
  mockStorage.upload.mockResolvedValue({ s3Key: 'screenshots/pgdas.png' })
})

afterEach(() => {
  vi.useRealTimers()
})

// ===========================================================================
// transmitirPGDAS
// ===========================================================================

describe('SimplesNacionalPortal.transmitirPGDAS()', () => {
  it('abre browser e navega para URL do Simples Nacional', async () => {
    const portal = new SimplesNacionalPortal()
    await portal.transmitirPGDAS(TENANT_ID, EMPRESA_ID, CNPJ, COMP, DADOS_PGDAS)

    const { chromium } = await import('playwright')
    expect(chromium.launch).toHaveBeenCalledWith({ headless: true })
    expect(mockPage.goto).toHaveBeenCalledWith(
      expect.stringContaining('SimplesNacional'),
      expect.any(Object)
    )
    expect(mockBrowser.close).toHaveBeenCalled()
  })

  it('retorna recibo não-vazio', async () => {
    const portal = new SimplesNacionalPortal()
    const recibo = await portal.transmitirPGDAS(TENANT_ID, EMPRESA_ID, CNPJ, COMP, DADOS_PGDAS)

    expect(typeof recibo).toBe('string')
    expect(recibo.length).toBeGreaterThan(0)
  })

  it('recibo contém CNPJ e competencia', async () => {
    const portal = new SimplesNacionalPortal()
    const recibo = await portal.transmitirPGDAS(TENANT_ID, EMPRESA_ID, CNPJ, COMP, DADOS_PGDAS)

    expect(recibo).toContain(CNPJ)
    expect(recibo).toContain(COMP)
  })

  it('atualiza apuração para TRANSMITIDO com o recibo gerado', async () => {
    const portal = new SimplesNacionalPortal()
    const recibo = await portal.transmitirPGDAS(TENANT_ID, EMPRESA_ID, CNPJ, COMP, DADOS_PGDAS)

    expect(mockDb.apuracaoFiscal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'TRANSMITIDO', recibo }),
      })
    )
  })

  it('filtra updateMany por tenantId e empresaId (isolamento multi-tenant)', async () => {
    const portal = new SimplesNacionalPortal()
    await portal.transmitirPGDAS(TENANT_ID, EMPRESA_ID, CNPJ, COMP, DADOS_PGDAS)

    const { where } = mockDb.apuracaoFiscal.updateMany.mock.calls[0][0]
    expect(where.tenantId).toBe(TENANT_ID)
    expect(where.empresaId).toBe(EMPRESA_ID)
    expect(where.competencia).toBe(COMP)
  })

  it('registra auditoria PGDAS_TRANSMITIDO com cnpj e competencia', async () => {
    const portal = new SimplesNacionalPortal()
    await portal.transmitirPGDAS(TENANT_ID, EMPRESA_ID, CNPJ, COMP, DADOS_PGDAS)

    expect(mockAudit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        cnpj: CNPJ,
        evento: 'PGDAS_TRANSMITIDO',
        estadoNovo: expect.objectContaining({ competencia: COMP }),
      })
    )
  })

  it('em caso de erro: faz screenshot e salva no S3', async () => {
    mockPage.goto.mockRejectedValue(new Error('network timeout'))

    const portal = new SimplesNacionalPortal()
    await expect(
      portal.transmitirPGDAS(TENANT_ID, EMPRESA_ID, CNPJ, COMP, DADOS_PGDAS)
    ).rejects.toThrow()

    expect(mockPage.screenshot).toHaveBeenCalled()
    expect(mockStorage.upload).toHaveBeenCalledWith(
      expect.stringContaining('pgdas'),
      expect.any(Buffer),
      'image/png'
    )
  })

  it('em caso de erro: registra auditoria OBRIGACAO_FALHOU', async () => {
    mockPage.goto.mockRejectedValue(new Error('portal offline'))

    const portal = new SimplesNacionalPortal()
    await expect(
      portal.transmitirPGDAS(TENANT_ID, EMPRESA_ID, CNPJ, COMP, DADOS_PGDAS)
    ).rejects.toThrow()

    const falhaCall = mockAudit.registrar.mock.calls.find((c) => c[0].evento === 'OBRIGACAO_FALHOU')
    expect(falhaCall).toBeDefined()
    expect(falhaCall![0].estadoNovo.competencia).toBe(COMP)
  })

  it('em caso de erro: fecha browser (finally)', async () => {
    mockPage.goto.mockRejectedValue(new Error('fatal'))

    const portal = new SimplesNacionalPortal()
    await expect(
      portal.transmitirPGDAS(TENANT_ID, EMPRESA_ID, CNPJ, COMP, DADOS_PGDAS)
    ).rejects.toThrow()

    expect(mockBrowser.close).toHaveBeenCalled()
  })

  it('em caso de erro: inclui mensagem no estadoNovo da auditoria de falha', async () => {
    const errMsg = 'certificado expirado'
    mockPage.goto.mockRejectedValue(new Error(errMsg))

    const portal = new SimplesNacionalPortal()
    await expect(
      portal.transmitirPGDAS(TENANT_ID, EMPRESA_ID, CNPJ, COMP, DADOS_PGDAS)
    ).rejects.toThrow()

    const falhaCall = mockAudit.registrar.mock.calls.find((c) => c[0].evento === 'OBRIGACAO_FALHOU')
    expect(falhaCall![0].estadoNovo.erro).toContain(errMsg)
  })
})
