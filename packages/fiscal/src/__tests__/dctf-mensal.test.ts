/**
 * Testes unitários — DCTFMensalService
 *
 * Cobre:
 *  - empresa não encontrada → lança erro
 *  - regime SN/MEI → lança erro
 *  - LP → gera DCTF com itens PIS e COFINS
 *  - LR → códigos de receita não-cumulativos
 *  - sem apuração PIS/COFINS → itens zerados
 *  - com apuração → valores corretos
 *  - totalDebitos = PIS + COFINS
 *  - prazo = dia 15 do 2º mês seguinte
 *  - persiste no banco com tipo DCTFWEB
 *  - registra DCTFWEB_TRANSMITIDA no audit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAudit = { registrar: vi.fn() }

const mockDb = {
  empresaCliente: { findUnique: vi.fn() },
  apuracaoFiscal: { findFirst: vi.fn(), upsert: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

import { DCTFMensalService } from '../dctf-mensal.service.js'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-dctf'
const EMPRESA_ID = 'emp-dctf'

const EMPRESA_LP = {
  id: EMPRESA_ID,
  cnpj: '12345678000195',
  razaoSocial: 'Empresa DCTF Ltda',
  regime: 'LUCRO_PRESUMIDO',
  cnae: '4711301',
}

function makeApuracaoPIS(pis: number) {
  return { id: 'ap-pis', tipo: 'PIS', dados: { pis: pis.toString() } }
}

function makeApuracaoCOFINS(cofins: number) {
  return { id: 'ap-cofins', tipo: 'COFINS', dados: { cofins: cofins.toString() } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.empresaCliente.findUnique.mockResolvedValue(EMPRESA_LP)
  mockDb.apuracaoFiscal.findFirst.mockResolvedValue(null)
  mockDb.apuracaoFiscal.upsert.mockResolvedValue({ id: 'dctf-1' })
})

// ===========================================================================

describe('DCTFMensalService — validações', () => {
  it('lança erro quando empresa não existe', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce(null)
    const service = new DCTFMensalService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow(
      'Empresa não encontrada'
    )
  })

  it('lança erro para regime SIMPLES_NACIONAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({
      ...EMPRESA_LP,
      regime: 'SIMPLES_NACIONAL',
    })
    const service = new DCTFMensalService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('Lucro Presumido')
  })

  it('lança erro para regime MEI', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'MEI' })
    const service = new DCTFMensalService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')).rejects.toThrow('Lucro Presumido')
  })

  it('aceita regime LUCRO_REAL', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'LUCRO_REAL' })
    const service = new DCTFMensalService()
    await expect(service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')).resolves.not.toThrow()
  })
})

// ===========================================================================

describe('DCTFMensalService — estrutura', () => {
  it('retorna 2 itens: PIS e COFINS', async () => {
    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.itens).toHaveLength(2)
  })

  it('LP usa código 6912 para PIS', async () => {
    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    const pis = resultado.itens.find((i) => i.descricao.includes('PIS'))!
    expect(pis.codigoReceita).toBe('6912')
  })

  it('LP usa código 2172 para COFINS', async () => {
    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    const cofins = resultado.itens.find((i) => i.descricao.includes('COFINS'))!
    expect(cofins.codigoReceita).toBe('2172')
  })

  it('LR usa código 5856 para PIS (não-cumulativo)', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'LUCRO_REAL' })
    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    const pis = resultado.itens.find((i) => i.descricao.includes('PIS'))!
    expect(pis.codigoReceita).toBe('5856')
  })

  it('LR usa código 5960 para COFINS (não-cumulativo)', async () => {
    mockDb.empresaCliente.findUnique.mockResolvedValueOnce({ ...EMPRESA_LP, regime: 'LUCRO_REAL' })
    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    const cofins = resultado.itens.find((i) => i.descricao.includes('COFINS'))!
    expect(cofins.codigoReceita).toBe('5960')
  })
})

// ===========================================================================

describe('DCTFMensalService — prazo', () => {
  it('prazo para 2025-05 = 2025-07-15', async () => {
    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')
    expect(resultado.prazoEntrega).toBe('2025-07-15')
  })

  it('prazo para 2025-11 = 2026-01-15 (vira o ano)', async () => {
    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-11')
    expect(resultado.prazoEntrega).toBe('2026-01-15')
  })

  it('prazo para 2025-12 = 2026-02-15', async () => {
    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-12')
    expect(resultado.prazoEntrega).toBe('2026-02-15')
  })

  it('prazo para 2025-01 = 2025-03-15', async () => {
    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-01')
    expect(resultado.prazoEntrega).toBe('2025-03-15')
  })
})

// ===========================================================================

describe('DCTFMensalService — cálculo', () => {
  it('sem apurações → todos os valores zerados', async () => {
    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.totalDebitos)).toBe(0)
    expect(Number(resultado.saldoDevedor)).toBe(0)
  })

  it('com PIS e COFINS apurados → totalDebitos correto', async () => {
    mockDb.apuracaoFiscal.findFirst
      .mockResolvedValueOnce(makeApuracaoPIS(650))
      .mockResolvedValueOnce(makeApuracaoCOFINS(3000))

    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.totalDebitos)).toBe(3650)
    expect(Number(resultado.saldoDevedor)).toBe(3650)
  })

  it('PIS = 650 está no item correto', async () => {
    mockDb.apuracaoFiscal.findFirst
      .mockResolvedValueOnce(makeApuracaoPIS(650))
      .mockResolvedValueOnce(null)

    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const pis = resultado.itens.find((i) => i.descricao.includes('PIS'))!
    expect(Number(pis.valorDebito)).toBe(650)
    expect(Number(pis.valorLiquido)).toBe(650)
  })

  it('saldoDevedor = totalDebitos quando sem créditos', async () => {
    mockDb.apuracaoFiscal.findFirst
      .mockResolvedValueOnce(makeApuracaoPIS(1000))
      .mockResolvedValueOnce(makeApuracaoCOFINS(5000))

    const service = new DCTFMensalService()
    const resultado = await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(Number(resultado.saldoDevedor)).toBe(Number(resultado.totalDebitos))
  })
})

// ===========================================================================

describe('DCTFMensalService — persistência', () => {
  it('persiste com tipo DCTFWEB', async () => {
    const service = new DCTFMensalService()
    await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const upsertCall = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(upsertCall[0].where.tenantId_empresaId_competencia_tipo.tipo).toBe('DCTFWEB')
  })

  it('status = CALCULADO', async () => {
    const service = new DCTFMensalService()
    await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const upsertCall = mockDb.apuracaoFiscal.upsert.mock.calls[0]
    expect(upsertCall[0].create.status).toBe('CALCULADO')
  })

  it('busca PIS e COFINS com tenantId e empresaId corretos', async () => {
    const service = new DCTFMensalService()
    await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const calls = mockDb.apuracaoFiscal.findFirst.mock.calls
    expect(calls[0][0].where.tenantId).toBe(TENANT_ID)
    expect(calls[0][0].where.empresaId).toBe(EMPRESA_ID)
    expect(calls[0][0].where.competencia).toBe('2025-05')
    const tipos = calls.map((c: any) => c[0].where.tipo)
    expect(tipos).toContain('PIS')
    expect(tipos).toContain('COFINS')
  })
})

// ===========================================================================

describe('DCTFMensalService — auditoria', () => {
  it('registra DCTFWEB_TRANSMITIDA no audit', async () => {
    const service = new DCTFMensalService()
    await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    expect(mockAudit.registrar).toHaveBeenCalledOnce()
    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.evento).toBe('DCTFWEB_TRANSMITIDA')
    expect(auditCall.tenantId).toBe(TENANT_ID)
  })

  it('audit estadoNovo contém competencia, saldo e prazo', async () => {
    mockDb.apuracaoFiscal.findFirst
      .mockResolvedValueOnce(makeApuracaoPIS(650))
      .mockResolvedValueOnce(makeApuracaoCOFINS(3000))

    const service = new DCTFMensalService()
    await service.gerar(TENANT_ID, EMPRESA_ID, '2025-05')

    const auditCall = mockAudit.registrar.mock.calls[0][0]
    expect(auditCall.estadoNovo.competencia).toBe('2025-05')
    expect(auditCall.estadoNovo.prazoEntrega).toBe('2025-07-15')
    expect(Number(auditCall.estadoNovo.saldoDevedor)).toBe(3650)
  })
})
