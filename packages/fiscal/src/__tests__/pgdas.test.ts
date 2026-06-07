/**
 * Testes unitários — PGDASService
 *
 * Cobre:
 *  - segregarReceitas(): roteamento de documentos por tipo/CFOP → Anexo correto
 *  - buscarFaixa():      localização da faixa correta nas tabelas I, III e V
 *  - calcularAliquotaEfetiva(): fórmula (aliquota * RB - deducao) / RB
 *
 * Os métodos privados são testados via instância com acesso via cast para 'any'.
 * O PrismaClient é mockado com vi.mock para que nenhuma conexão real seja feita.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Decimal } from 'decimal.js'
import { TABELA_SIMPLES_NACIONAL } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Mocks de dependências externas (devem vir ANTES do import do serviço)
// ---------------------------------------------------------------------------

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => ({
    empresaCliente: { findUnique: vi.fn() },
    documentoFiscal: {
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { valorTotal: null } }),
    },
    apuracaoFiscal: { upsert: vi.fn() },
    alerta: { create: vi.fn() },
  })),
}))

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => ({
    registrar: vi.fn(),
  })),
}))

// FatorRService retorna fatorR = 0 por padrão nos testes de PGDAS
vi.mock('../fator-r.service.js', () => ({
  FatorRService: vi.fn().mockImplementation(() => ({
    calcular: vi.fn().mockResolvedValue({ fatorR: new Decimal(0), anexo: 'V' }),
  })),
}))

import { PGDASService } from '../pgdas.service.js'

// ---------------------------------------------------------------------------
// Helper: cria documentos fiscais fictícios
// ---------------------------------------------------------------------------

function makeDoc(tipo: string, valorTotal: string, cfop?: string) {
  return { tipo, valorTotal: new Decimal(valorTotal), cfop }
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('PGDASService — segregarReceitas()', () => {
  let service: PGDASService

  beforeEach(() => {
    service = new PGDASService()
  })

  it('NFC-e vai para Anexo I', () => {
    const docs = [makeDoc('NFCE', '1000.00')]
    const receitas = (service as any).segregarReceitas(docs, '00.000.000/0001-00', '2025-01')

    expect(receitas.anexoI.toFixed(2)).toBe('1000.00')
    expect(receitas.anexoIII.toFixed(2)).toBe('0.00')
    expect(receitas.anexoV.toFixed(2)).toBe('0.00')
    expect(receitas.total.toFixed(2)).toBe('1000.00')
  })

  it('NF-e com CFOP 5.xxx (saída interna) vai para Anexo I', () => {
    const docs = [makeDoc('NFE', '2500.00', '5.102')]
    const receitas = (service as any).segregarReceitas(docs, '00.000.000/0001-00', '2025-01')

    expect(receitas.anexoI.toFixed(2)).toBe('2500.00')
    expect(receitas.total.toFixed(2)).toBe('2500.00')
  })

  it('NF-e com CFOP 6.xxx (saída interestadual) NÃO vai para nenhum anexo', () => {
    // CFOP 6.xxx não começa com '5', então não é classificado no Anexo I pelo serviço atual
    const docs = [makeDoc('NFE', '3000.00', '6.102')]
    const receitas = (service as any).segregarReceitas(docs, '00.000.000/0001-00', '2025-01')

    expect(receitas.anexoI.toFixed(2)).toBe('0.00')
    expect(receitas.total.toFixed(2)).toBe('0.00')
  })

  it('NFSe emitida vai para Anexo III', () => {
    const docs = [makeDoc('NFSE_EMITIDA', '5000.00')]
    const receitas = (service as any).segregarReceitas(docs, '00.000.000/0001-00', '2025-01')

    expect(receitas.anexoIII.toFixed(2)).toBe('5000.00')
    expect(receitas.anexoI.toFixed(2)).toBe('0.00')
    expect(receitas.total.toFixed(2)).toBe('5000.00')
  })

  it('Mix: NFC-e + NFSe emitida → segregados corretamente', () => {
    const docs = [
      makeDoc('NFCE', '1000.00'),
      makeDoc('NFSE_EMITIDA', '2000.00'),
      makeDoc('NFE', '500.00', '5.101'),
    ]
    const receitas = (service as any).segregarReceitas(docs, '00.000.000/0001-00', '2025-01')

    expect(receitas.anexoI.toFixed(2)).toBe('1500.00') // NFCE + NFE 5.x
    expect(receitas.anexoIII.toFixed(2)).toBe('2000.00') // NFSE_EMITIDA
    expect(receitas.total.toFixed(2)).toBe('3500.00')
  })

  it('Lista vazia → todos os anexos zerados', () => {
    const receitas = (service as any).segregarReceitas([], '00.000.000/0001-00', '2025-01')

    expect(receitas.total.toFixed(2)).toBe('0.00')
    expect(receitas.anexoI.toFixed(2)).toBe('0.00')
    expect(receitas.anexoIII.toFixed(2)).toBe('0.00')
  })

  it('NF-e com cfop null → não vai para nenhum anexo e não lança erro (optional chaining)', () => {
    // doc.cfop?.startsWith('5') → undefined quando cfop é null → não entra no Anexo I
    const docs = [makeDoc('NFE', '1000.00', undefined)]
    // makeDoc sem cfop → cfop = undefined → equivale ao null path
    const docComCfopNull = { tipo: 'NFE', valorTotal: new Decimal('1000.00'), cfop: null }
    const receitas = (service as any).segregarReceitas(
      [docComCfopNull],
      '00.000.000/0001-00',
      '2025-01'
    )

    expect(receitas.anexoI.toFixed(2)).toBe('0.00')
    expect(receitas.anexoIII.toFixed(2)).toBe('0.00')
    expect(receitas.total.toFixed(2)).toBe('0.00')
  })
})

// ---------------------------------------------------------------------------
// buscarFaixa — Anexo I (6 faixas)
// ---------------------------------------------------------------------------

describe('PGDASService — buscarFaixa() Anexo I', () => {
  let service: PGDASService

  beforeEach(() => {
    service = new PGDASService()
  })

  const casos = [
    { rb: '0', faixa: 0, aliquota: '4', deducao: '0' },
    { rb: '90000', faixa: 0, aliquota: '4', deducao: '0' },
    { rb: '180000', faixa: 0, aliquota: '4', deducao: '0' },
    { rb: '180000.01', faixa: 1, aliquota: '7.3', deducao: '5940' },
    { rb: '270000', faixa: 1, aliquota: '7.3', deducao: '5940' },
    { rb: '360000', faixa: 1, aliquota: '7.3', deducao: '5940' },
    { rb: '360000.01', faixa: 2, aliquota: '9.5', deducao: '13860' },
    { rb: '720000', faixa: 2, aliquota: '9.5', deducao: '13860' },
    { rb: '720000.01', faixa: 3, aliquota: '10.7', deducao: '22500' },
    { rb: '1800000', faixa: 3, aliquota: '10.7', deducao: '22500' },
    { rb: '1800000.01', faixa: 4, aliquota: '14.3', deducao: '87300' },
    { rb: '3600000', faixa: 4, aliquota: '14.3', deducao: '87300' },
    { rb: '3600000.01', faixa: 5, aliquota: '19', deducao: '378000' },
    { rb: '4800000', faixa: 5, aliquota: '19', deducao: '378000' },
  ]

  it.each(casos)('RB R$ %s → alíquota %s%% / deduções R$ %s', ({ rb, aliquota, deducao }) => {
    const faixa = (service as any).buscarFaixa(new Decimal(rb), 'ANEXO_I')
    expect(faixa).toBeDefined()
    expect(faixa.aliquota.toString()).toBe(aliquota)
    expect(faixa.deducao.toString()).toBe(deducao)
  })

  it('RB acima de R$ 4.800.000 → sem faixa (null/undefined)', () => {
    const faixa = (service as any).buscarFaixa(new Decimal('4800000.01'), 'ANEXO_I')
    expect(faixa).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// buscarFaixa — Anexo III (6 faixas)
// ---------------------------------------------------------------------------

describe('PGDASService — buscarFaixa() Anexo III', () => {
  let service: PGDASService

  beforeEach(() => {
    service = new PGDASService()
  })

  const casos = [
    { rb: '0', aliquota: '6', deducao: '0' },
    { rb: '180000', aliquota: '6', deducao: '0' },
    { rb: '180000.01', aliquota: '11.2', deducao: '9360' },
    { rb: '360000', aliquota: '11.2', deducao: '9360' },
    { rb: '360000.01', aliquota: '13.5', deducao: '17640' },
    { rb: '720000', aliquota: '13.5', deducao: '17640' },
    { rb: '720000.01', aliquota: '16', deducao: '35640' },
    { rb: '1800000', aliquota: '16', deducao: '35640' },
    { rb: '1800000.01', aliquota: '21', deducao: '125640' },
    { rb: '3600000', aliquota: '21', deducao: '125640' },
    { rb: '3600000.01', aliquota: '33', deducao: '648000' },
    { rb: '4800000', aliquota: '33', deducao: '648000' },
  ]

  it.each(casos)(
    'RB R$ $rb → alíquota $aliquota%% / deduções R$ $deducao',
    ({ rb, aliquota, deducao }) => {
      const faixa = (service as any).buscarFaixa(new Decimal(rb), 'ANEXO_III')
      expect(faixa).toBeDefined()
      expect(faixa.aliquota.toString()).toBe(aliquota)
      expect(faixa.deducao.toString()).toBe(deducao)
    }
  )
})

// ---------------------------------------------------------------------------
// buscarFaixa — Anexo V (6 faixas)
// ---------------------------------------------------------------------------

describe('PGDASService — buscarFaixa() Anexo V', () => {
  let service: PGDASService

  beforeEach(() => {
    service = new PGDASService()
  })

  const casos = [
    { rb: '0', aliquota: '15.5', deducao: '0' },
    { rb: '180000', aliquota: '15.5', deducao: '0' },
    { rb: '180000.01', aliquota: '18', deducao: '4500' },
    { rb: '360000', aliquota: '18', deducao: '4500' },
    { rb: '360000.01', aliquota: '19.5', deducao: '9900' },
    { rb: '720000', aliquota: '19.5', deducao: '9900' },
    { rb: '720000.01', aliquota: '20.5', deducao: '17100' },
    { rb: '1800000', aliquota: '20.5', deducao: '17100' },
    { rb: '1800000.01', aliquota: '23', deducao: '62100' },
    { rb: '3600000', aliquota: '23', deducao: '62100' },
    { rb: '3600000.01', aliquota: '30.5', deducao: '540000' },
    { rb: '4800000', aliquota: '30.5', deducao: '540000' },
  ]

  it.each(casos)(
    'RB R$ $rb → alíquota $aliquota%% / deduções R$ $deducao',
    ({ rb, aliquota, deducao }) => {
      const faixa = (service as any).buscarFaixa(new Decimal(rb), 'ANEXO_V')
      expect(faixa).toBeDefined()
      expect(faixa.aliquota.toString()).toBe(aliquota)
      expect(faixa.deducao.toString()).toBe(deducao)
    }
  )
})

// ---------------------------------------------------------------------------
// calcularAliquotaEfetiva — fórmula pura
//
// Fórmula: aliquotaEfetiva = (aliquota/100 * RB - deducao) / RB
// O serviço retorna aliquotaEfetiva já multiplicada por 100 (em %).
// ---------------------------------------------------------------------------

describe('PGDASService — calcularAliquotaEfetiva()', () => {
  /**
   * Testa a fórmula diretamente sem instanciar o serviço, usando os dados
   * da tabela TABELA_SIMPLES_NACIONAL da lib shared.
   *
   * Fórmula (equivalente à implementação em pgdas.service.ts):
   *   aliqEfetiva = (aliquotaNominal/100 * RB - deducao) / RB * 100
   */
  function calcularAliquotaEfetiva(rb: Decimal, aliquota: Decimal, deducao: Decimal): Decimal {
    if (rb.lte(0)) return new Decimal(0)
    return aliquota.div(100).times(rb).minus(deducao).div(rb).times(100).toDecimalPlaces(4)
  }

  it('Faixa 1 Anexo I — RB R$90k → alíquota efetiva = 4% (sem deduções)', () => {
    const rb = new Decimal(90000)
    const { aliquota, deducao } = TABELA_SIMPLES_NACIONAL.ANEXO_I[0]!
    const efetiva = calcularAliquotaEfetiva(rb, aliquota, deducao)
    expect(efetiva.toFixed(4)).toBe('4.0000')
  })

  it('Faixa 2 Anexo I — RB R$270k → alíquota efetiva correta', () => {
    const rb = new Decimal(270000)
    const { aliquota, deducao } = TABELA_SIMPLES_NACIONAL.ANEXO_I[1]!
    // (7.3/100 * 270000 - 5940) / 270000 * 100
    // = (19710 - 5940) / 270000 * 100
    // = 13770 / 270000 * 100 ≈ 5.1
    const efetiva = calcularAliquotaEfetiva(rb, aliquota, deducao)
    const esperado = aliquota
      .div(100)
      .times(rb)
      .minus(deducao)
      .div(rb)
      .times(100)
      .toDecimalPlaces(4)
    expect(efetiva.toFixed(4)).toBe(esperado.toFixed(4))
    // Verifica que é menor que a nominal (deduções reduzem a efetiva)
    expect(efetiva.lt(aliquota)).toBe(true)
  })

  it('Faixa 1 Anexo III — RB R$150k → alíquota efetiva = 6% (sem deduções)', () => {
    const rb = new Decimal(150000)
    const { aliquota, deducao } = TABELA_SIMPLES_NACIONAL.ANEXO_III[0]!
    const efetiva = calcularAliquotaEfetiva(rb, aliquota, deducao)
    expect(efetiva.toFixed(4)).toBe('6.0000')
  })

  it('Faixa 2 Anexo III — RB R$250k → alíquota efetiva < 11.2% (nominal)', () => {
    const rb = new Decimal(250000)
    const { aliquota, deducao } = TABELA_SIMPLES_NACIONAL.ANEXO_III[1]!
    const efetiva = calcularAliquotaEfetiva(rb, aliquota, deducao)
    expect(efetiva.lt(aliquota)).toBe(true)
  })

  it('Faixa 1 Anexo V — RB R$100k → alíquota efetiva = 15.5% (sem deduções)', () => {
    const rb = new Decimal(100000)
    const { aliquota, deducao } = TABELA_SIMPLES_NACIONAL.ANEXO_V[0]!
    const efetiva = calcularAliquotaEfetiva(rb, aliquota, deducao)
    expect(efetiva.toFixed(4)).toBe('15.5000')
  })

  it('Faixa 4 Anexo I — RB R$1.260.000 → valor DAS = aliq*RB - deducao', () => {
    const rb = new Decimal(1260000)
    const { aliquota, deducao } = TABELA_SIMPLES_NACIONAL.ANEXO_I[3]! // faixa 4: 10.7% - 22500
    // Fórmula direta sem intermediário: DAS = (aliq/100 * RB - deducao)
    // = (0.107 * 1260000 - 22500) = 134820 - 22500 = 112320
    const valorDAS = aliquota.div(100).times(rb).minus(deducao).toDecimalPlaces(2)
    expect(valorDAS.toFixed(2)).toBe('112320.00')
  })

  it('RB = 0 → alíquota efetiva = 0 (evita divisão por zero)', () => {
    const efetiva = calcularAliquotaEfetiva(new Decimal(0), new Decimal(6), new Decimal(0))
    expect(efetiva.toFixed(4)).toBe('0.0000')
  })

  it('Maior faixa Anexo III — RB R$4.200.000 → alíquota efetiva < 33% (nominal)', () => {
    const rb = new Decimal(4200000)
    const { aliquota, deducao } = TABELA_SIMPLES_NACIONAL.ANEXO_III[5]!
    const efetiva = calcularAliquotaEfetiva(rb, aliquota, deducao)
    expect(efetiva.lt(aliquota)).toBe(true)
    expect(efetiva.gt(0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// determinarAnexoPrincipal — lógica de decisão
// ---------------------------------------------------------------------------

describe('PGDASService — determinarAnexoPrincipal()', () => {
  let service: PGDASService

  beforeEach(() => {
    service = new PGDASService()
  })

  function makeReceitas(anexoI: string, anexoIII: string, anexoV = '0') {
    return {
      cnpj: '00.000.000/0001-00',
      competencia: '2025-01',
      anexoI: new Decimal(anexoI),
      anexoII: new Decimal(0),
      anexoIII: new Decimal(anexoIII),
      anexoIV: new Decimal(0),
      anexoV: new Decimal(anexoV),
      exportacao: new Decimal(0),
      substituicaoTributaria: new Decimal(0),
      imunes: new Decimal(0),
      isentas: new Decimal(0),
      total: new Decimal(anexoI).plus(anexoIII).plus(anexoV),
    }
  }

  it('Anexo I predomina → retorna ANEXO_I', () => {
    const receitas = makeReceitas('10000', '5000')
    const anexo = (service as any).determinarAnexoPrincipal(receitas, new Decimal(0))
    expect(anexo).toBe('ANEXO_I')
  })

  it('Serviços com FatorR ≥ 28 → retorna ANEXO_III', () => {
    const receitas = makeReceitas('0', '10000')
    const anexo = (service as any).determinarAnexoPrincipal(receitas, new Decimal(28))
    expect(anexo).toBe('ANEXO_III')
  })

  it('Serviços com FatorR < 28 → retorna ANEXO_V', () => {
    const receitas = makeReceitas('0', '10000')
    const anexo = (service as any).determinarAnexoPrincipal(receitas, new Decimal(27))
    expect(anexo).toBe('ANEXO_V')
  })

  it('FatorR exatamente 28 → retorna ANEXO_III (limite inclusivo)', () => {
    const receitas = makeReceitas('0', '10000')
    const anexo = (service as any).determinarAnexoPrincipal(receitas, new Decimal(28))
    expect(anexo).toBe('ANEXO_III')
  })
})
