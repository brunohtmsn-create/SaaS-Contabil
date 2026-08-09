/**
 * Testes unitários — SpedContribuicoesService (EFD PIS/COFINS)
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime SN/MEI → lança erro
 *  - LP e LR → geram EFD com alíquotas diferentes
 *  - LP: PIS 0,65% e COFINS 3%
 *  - LR: PIS 1,65% e COFINS 7,6%
 *  - receita zero → contribuições zeradas
 *  - totalContribuicoes = PIS + COFINS
 *  - prazo = dia 10 do 2º mês seguinte
 *  - arquivo SPED contém blocos 0000, M001, 9999
 *  - registro C100 por NF-e
 *  - persiste com tipo PIS
 *  - registra PIS_COFINS_LP_APURADO no audit
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

import { SpedContribuicoesService } from '../sped-contribuicoes.service.js'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-sped-contrib'
const EMPRESA_ID = 'emp-sped-contrib'

const EMPRESA_LP = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa EFD PIS Ltda',
  regime: 'LUCRO_PRESUMIDO',
  cnae: '4711301',
  uf: 'SP',
}

function makeDoc(opts: {
  valorTotal: number
  tipo?: string
  valorPis?: number
  valorCofins?: number
}) {
  return {
    id: `doc-${Math.random()}`,
    chaveAcesso: '12345678901234567890123456789012345678901234',
    numero: '000001',
    serie: '001',
    dataEmissao: new Date('2025-05-10'),
    dataCompetencia: new Date('2025-05-10'),
    tipo: opts.tipo ?? 'NFE',
    direcao: 'SAIDA',
    status: 'CONCILIADO',
    cnpjDestinatario: '98765432000111',
    valorTotal: { toString: () => opts.valorTotal.toString() },
    valorPis: { toString: () => (opts.valorPis ?? 0).toString() },
    valorCofins: { toString: () => (opts.valorCofins ?? 0).toString() },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LP)
  mockDb.documentoFiscal.findMany.mockResolvedValue([])
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'efd-1' })
})

// ===========================================================================

describe('SpedContribuicoesService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new SpedContribuicoesService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('lança erro para regime SIMPLES_NACIONAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LP,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new SpedContribuicoesService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('Lucro Presumido')
  })

  it('lança erro para regime MEI', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'MEI' })
    const service = new SpedContribuicoesService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('Lucro Presumido')
  })

  it('aceita regime LUCRO_REAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'LUCRO_REAL' })
    const service = new SpedContribuicoesService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')).resolves.not.toThrow()
  })
})

// ===========================================================================

describe('SpedContribuicoesService — alíquotas', () => {
  it('LP: PIS = receita × 0,65%', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc({ valorTotal: 100000 })])

    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.totalPIS)).toBe(650)
  })

  it('LP: COFINS = receita × 3%', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc({ valorTotal: 100000 })])

    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.totalCOFINS)).toBe(3000)
  })

  it('LR: PIS = receita × 1,65%', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'LUCRO_REAL' })
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc({ valorTotal: 100000 })])

    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.totalPIS)).toBe(1650)
  })

  it('LR: COFINS = receita × 7,6%', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'LUCRO_REAL' })
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc({ valorTotal: 100000 })])

    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.totalCOFINS)).toBe(7600)
  })

  it('receita zero → contribuições zeradas', async () => {
    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.totalPIS)).toBe(0)
    expect(Number(resultado.totalCOFINS)).toBe(0)
    expect(Number(resultado.totalContribuicoes)).toBe(0)
  })

  it('totalContribuicoes = PIS + COFINS', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc({ valorTotal: 100000 })])

    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const esperado = Number(resultado.totalPIS) + Number(resultado.totalCOFINS)
    expect(Number(resultado.totalContribuicoes)).toBe(esperado)
  })
})

// ===========================================================================

describe('SpedContribuicoesService — prazo', () => {
  it('prazo para 2025-05 = 2025-07-10', async () => {
    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.prazoEntrega).toBe('2025-07-10')
  })

  it('prazo para 2025-11 = 2026-01-10 (vira o ano)', async () => {
    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-11')
    expect(resultado.prazoEntrega).toBe('2026-01-10')
  })

  it('prazo para 2025-12 = 2026-02-10', async () => {
    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-12')
    expect(resultado.prazoEntrega).toBe('2026-02-10')
  })
})

// ===========================================================================

describe('SpedContribuicoesService — arquivo SPED', () => {
  it('arquivo contém registro 0000', async () => {
    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.conteudoSPED).toContain('|0000|')
  })

  it('arquivo contém CNPJ da empresa', async () => {
    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.conteudoSPED).toContain(EMPRESA_LP.cnpj)
  })

  it('arquivo contém bloco M (apurações PIS/COFINS)', async () => {
    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.conteudoSPED).toContain('|M001|')
    expect(resultado.conteudoSPED).toContain('|M200|')
    expect(resultado.conteudoSPED).toContain('|M600|')
  })

  it('arquivo termina com 9999', async () => {
    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.conteudoSPED).toContain('|9999|')
  })

  it('arquivo usa \\r\\n (padrão SPED)', async () => {
    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.conteudoSPED).toContain('\r\n')
  })

  it('NF-e gera registro C100', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc({ valorTotal: 10000 })])

    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const linhasC100 = resultado.conteudoSPED.split('\r\n').filter((l) => l.startsWith('|C100|'))
    expect(linhasC100).toHaveLength(1)
  })

  it('NFS-e gera registro A100', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([
      makeDoc({ valorTotal: 10000, tipo: 'NFSE_EMITIDA' }),
    ])

    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const linhasA100 = resultado.conteudoSPED.split('\r\n').filter((l) => l.startsWith('|A100|'))
    expect(linhasA100).toHaveLength(1)
  })
})

// ===========================================================================

describe('SpedContribuicoesService — persistência e auditoria', () => {
  it('persiste com tipo PIS', async () => {
    const service = new SpedContribuicoesService()
    await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const upsertCall = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(upsertCall[0].where.tenantId_empresaId_competencia_tipo.tipo).toBe('PIS')
  })

  it('registra PIS_COFINS_LP_APURADO no audit', async () => {
    const service = new SpedContribuicoesService()
    await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('PIS_COFINS_LP_APURADO')
    expect(auditCall.tenantId).toBe(TENANT_ID)
  })

  it('audit estadoNovo contém regime, PIS e COFINS', async () => {
    mockDb.documentoFiscal.findMany.mockResolvedValueOnce([makeDoc({ valorTotal: 100000 })])

    const service = new SpedContribuicoesService()
    await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.estadoNovo.regime).toBe('LUCRO_PRESUMIDO')
    expect(Number(auditCall.estadoNovo.totalPIS)).toBe(650)
    expect(Number(auditCall.estadoNovo.totalCOFINS)).toBe(3000)
  })
})
