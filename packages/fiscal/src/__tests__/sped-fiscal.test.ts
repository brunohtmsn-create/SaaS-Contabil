/**
 * Testes unitários — SpedFiscalService (EFD ICMS/IPI)
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime SN/MEI → lança erro
 *  - LP e LR → geram SPED Fiscal
 *  - sem documentos → totalICMS = 0, totalDocumentos = 0
 *  - documentos CONCILIADOS → totalICMS somado
 *  - prazo = dia 15 do 2º mês seguinte
 *  - arquivo SPED contém blocos 0000, C001, E001, 9999
 *  - CNPJ e razão social no arquivo
 *  - registro C100 por documento
 *  - busca somente NFE/NFCE CONCILIADOS
 *  - persiste no banco
 *  - registra DESTDA_GERADO no audit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = { registrar: vi.fn() }

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  documentoFiscal: { findMany: vi.fn() },
  apuracaoFiscal: { upsert: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { SpedFiscalService } from '../sped-fiscal.service.js'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-sped'
const EMPRESA_ID = 'emp-sped'

const EMPRESA_LP = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa SPED Ltda',
  regime: 'LUCRO_PRESUMIDO',
  cnae: '4711301',
  uf: 'SP',
}

function makeDoc(opts: { valorTotal: number; valorIcms: number; valorIpi?: number }) {
  return {
    id: `doc-${Math.random()}`,
    chaveAcesso: '12345678901234567890123456789012345678901234',
    numero: '000001',
    serie: '001',
    dataEmissao: new Date('2025-05-10'),
    dataCompetencia: new Date('2025-05-10'),
    tipo: 'NFE',
    status: 'CONCILIADO',
    valorTotal: { toString: () => opts.valorTotal.toString() },
    valorIcms: { toString: () => opts.valorIcms.toString() },
    valorIpi: { toString: () => (opts.valorIpi ?? 0).toString() },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LP)
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'sped-1' })
})

// ===========================================================================

describe('SpedFiscalService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new SpedFiscalService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('lança erro para regime SIMPLES_NACIONAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LP,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new SpedFiscalService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('Lucro Presumido')
  })

  it('lança erro para regime MEI', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'MEI' })
    const service = new SpedFiscalService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('Lucro Presumido')
  })

  it('aceita regime LUCRO_REAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'LUCRO_REAL' })
    const service = new SpedFiscalService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')).resolves.not.toThrow()
  })
})

// ===========================================================================

describe('SpedFiscalService — prazo', () => {
  it('prazo para 2025-05 = 2025-07-15', async () => {
    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.prazoEntrega).toBe('2025-07-15')
  })

  it('prazo para 2025-11 = 2026-01-15 (vira o ano)', async () => {
    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-11')
    expect(resultado.prazoEntrega).toBe('2026-01-15')
  })

  it('prazo para 2025-12 = 2026-02-15', async () => {
    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-12')
    expect(resultado.prazoEntrega).toBe('2026-02-15')
  })
})

// ===========================================================================

describe('SpedFiscalService — cálculo', () => {
  it('sem documentos → totalICMS = 0, totalDocumentos = 0', async () => {
    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.totalICMS)).toBe(0)
    expect(Number(resultado.totalIPI)).toBe(0)
    expect(resultado.totalDocumentos).toBe(0)
  })

  it('um documento → totalICMS correto', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ valorTotal: 10000, valorIcms: 1200 }),
    ])

    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.totalICMS)).toBe(1200)
    expect(resultado.totalDocumentos).toBe(1)
  })

  it('múltiplos documentos → ICMS somado', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ valorTotal: 10000, valorIcms: 1200 }),
      makeDoc({ valorTotal: 5000, valorIcms: 600 }),
      makeDoc({ valorTotal: 8000, valorIcms: 960 }),
    ])

    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.totalICMS)).toBe(2760)
    expect(resultado.totalDocumentos).toBe(3)
  })

  it('IPI somado corretamente', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ valorTotal: 10000, valorIcms: 1200, valorIpi: 500 }),
      makeDoc({ valorTotal: 5000, valorIcms: 600, valorIpi: 300 }),
    ])

    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.totalIPI)).toBe(800)
  })

  it('busca somente NFE e NFCE CONCILIADOS', async () => {
    const service = new SpedFiscalService()
    await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const findWhere = mockDb.documentoFiscal.findMany.mock.calls[0][0].where
    expect(findWhere.status).toBe('CONCILIADO')
    expect(findWhere.tipo.in).toContain('NFE')
    expect(findWhere.tipo.in).toContain('NFCE')
    expect(findWhere.tenantId).toBe(TENANT_ID)
    expect(findWhere.empresaId).toBe(EMPRESA_ID)
  })
})

// ===========================================================================

describe('SpedFiscalService — arquivo SPED', () => {
  it('arquivo contém registro 0000', async () => {
    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.conteudoSPED).toContain('|0000|')
  })

  it('arquivo contém CNPJ da empresa', async () => {
    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.conteudoSPED).toContain(EMPRESA_LP.cnpj)
  })

  it('arquivo contém bloco C (documentos)', async () => {
    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.conteudoSPED).toContain('|C001|')
  })

  it('arquivo contém bloco E (apuração ICMS)', async () => {
    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.conteudoSPED).toContain('|E001|')
    expect(resultado.conteudoSPED).toContain('|E110|')
  })

  it('arquivo termina com 9999', async () => {
    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.conteudoSPED).toContain('|9999|')
  })

  it('arquivo usa \\r\\n (padrão SPED)', async () => {
    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.conteudoSPED).toContain('\r\n')
  })

  it('um documento → um registro C100', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ valorTotal: 10000, valorIcms: 1200 }),
    ])

    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const linhasC100 = resultado.conteudoSPED.split('\r\n').filter((l) => l.startsWith('|C100|'))
    expect(linhasC100).toHaveLength(1)
  })

  it('3 documentos → 3 registros C100', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ valorTotal: 1000, valorIcms: 120 }),
      makeDoc({ valorTotal: 2000, valorIcms: 240 }),
      makeDoc({ valorTotal: 3000, valorIcms: 360 }),
    ])

    const service = new SpedFiscalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const linhasC100 = resultado.conteudoSPED.split('\r\n').filter((l) => l.startsWith('|C100|'))
    expect(linhasC100).toHaveLength(3)
  })
})

// ===========================================================================

describe('SpedFiscalService — persistência e auditoria', () => {
  it('persiste no banco', async () => {
    const service = new SpedFiscalService()
    await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(mockDb.apuracaoFiscal.upsert).toHaveBeenCalledOnce()
  })

  it('registra DESTDA_GERADO no audit', async () => {
    const service = new SpedFiscalService()
    await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('DESTDA_GERADO')
    expect(auditCall.tenantId).toBe(TENANT_ID)
  })

  it('audit estadoNovo contém competencia, totalDocumentos e prazoEntrega', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ valorTotal: 10000, valorIcms: 1200 }),
    ])

    const service = new SpedFiscalService()
    await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.estadoNovo.competencia).toBe('2025-05')
    expect(auditCall.estadoNovo.totalDocumentos).toBe(1)
    expect(auditCall.estadoNovo.prazoEntrega).toBe('2025-07-15')
  })
})
