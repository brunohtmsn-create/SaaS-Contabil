/**
 * Testes unitários — utilitários do pacote @saas-contabil/shared
 *
 * Cobre:
 *  - parsePeriodo():              início e fim de competência com timezone Brasil
 *  - formatCompetencia():         formatação de Date para string 'YYYY-MM'
 *  - sha256():                    hash SHA-256 de string e Buffer
 *  - nowBR():                     retorna Date representando horário de Sao Paulo
 *  - MAPA_CFOP_CONTA:             CFOP '5102' → conta de receita (começa com '3')
 *  - Decimal:                     aritmética sem erro de float
 *  - addDays():                   adição de dias
 *  - differenceInCalendarDays():  diferença em dias entre duas datas
 *
 * Não há dependências externas de banco de dados — todos os testes são puros.
 */

import { describe, it, expect } from 'vitest'
import { Decimal } from '../utils/decimal.js'
import {
  parsePeriodo,
  formatCompetencia,
  nowBR,
  addDays,
  addMeses,
  competencias12Meses,
  differenceInCalendarDays,
} from '../utils/date.js'
import { sha256 } from '../utils/crypto.js'
import { MAPA_CFOP_CONTA } from '../constants/cfop.js'
import { validarCNPJ, formatarCNPJ, limparCNPJ } from '../utils/cnpj.js'

// ---------------------------------------------------------------------------
// parsePeriodo
// ---------------------------------------------------------------------------

describe('parsePeriodo()', () => {
  it("'2024-03': inicio é 2024-03-01 e fim é 2024-03-31", () => {
    const { inicio, fim, competencia } = parsePeriodo('2024-03')

    expect(competencia).toBe('2024-03')

    // date-fns startOfMonth/endOfMonth trabalham com o valor local da data
    expect(inicio.getFullYear()).toBe(2024)
    expect(inicio.getMonth()).toBe(2) // 0-indexed → março
    expect(inicio.getDate()).toBe(1)
    expect(inicio.getHours()).toBe(0)
    expect(inicio.getMinutes()).toBe(0)
    expect(inicio.getSeconds()).toBe(0)

    expect(fim.getFullYear()).toBe(2024)
    expect(fim.getMonth()).toBe(2) // 0-indexed → março
    expect(fim.getDate()).toBe(31)
    expect(fim.getHours()).toBe(23)
    expect(fim.getMinutes()).toBe(59)
    expect(fim.getSeconds()).toBe(59)
  })

  it("fim de fevereiro em ano bissexto: '2024-02' termina no dia 29", () => {
    const { fim } = parsePeriodo('2024-02')
    expect(fim.getDate()).toBe(29)
    expect(fim.getMonth()).toBe(1) // 0-indexed → fevereiro
  })

  it("fim de fevereiro em ano não bissexto: '2023-02' termina no dia 28", () => {
    const { fim } = parsePeriodo('2023-02')
    expect(fim.getDate()).toBe(28)
  })

  it("'2024-12': início dia 1, fim dia 31 de dezembro", () => {
    const { inicio, fim } = parsePeriodo('2024-12')
    expect(inicio.getMonth()).toBe(11) // 0-indexed → dezembro
    expect(inicio.getDate()).toBe(1)
    expect(fim.getMonth()).toBe(11)
    expect(fim.getDate()).toBe(31)
  })

  it('inicio sempre tem hora 00:00:00', () => {
    const { inicio } = parsePeriodo('2025-06')
    expect(inicio.getHours()).toBe(0)
    expect(inicio.getMinutes()).toBe(0)
    expect(inicio.getSeconds()).toBe(0)
  })

  it('fim sempre tem hora 23:59:59', () => {
    const { fim } = parsePeriodo('2025-06')
    expect(fim.getHours()).toBe(23)
    expect(fim.getMinutes()).toBe(59)
    expect(fim.getSeconds()).toBe(59)
  })
})

// ---------------------------------------------------------------------------
// formatCompetencia
// ---------------------------------------------------------------------------

describe('formatCompetencia()', () => {
  it('retorna string no formato YYYY-MM para janeiro de 2024', () => {
    // Usa um instante sem ambiguidade de timezone: meio-dia UTC no dia 15
    const date = new Date('2024-01-15T15:00:00.000Z') // 12:00 BRT (UTC-3)
    const result = formatCompetencia(date)
    expect(result).toBe('2024-01')
  })

  it('retorna string no formato YYYY-MM para dezembro de 2025', () => {
    const date = new Date('2025-12-20T15:00:00.000Z') // 12:00 BRT
    const result = formatCompetencia(date)
    expect(result).toBe('2025-12')
  })

  it('resultado tem exatamente 7 caracteres (YYYY-MM)', () => {
    const date = new Date('2024-06-10T15:00:00.000Z')
    expect(formatCompetencia(date)).toHaveLength(7)
  })

  it('resultado corresponde ao padrão YYYY-MM', () => {
    const date = new Date('2024-09-05T15:00:00.000Z')
    expect(formatCompetencia(date)).toMatch(/^\d{4}-\d{2}$/)
  })
})

// ---------------------------------------------------------------------------
// sha256
// ---------------------------------------------------------------------------

describe('sha256()', () => {
  // Hash canônico de 'hello' (RFC / Wikipedia)
  const HASH_HELLO = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

  it("sha256('hello') retorna o hash hex correto", () => {
    expect(sha256('hello')).toBe(HASH_HELLO)
  })

  it('sha256(Buffer) aceita Buffer e retorna o mesmo hash que string equivalente', () => {
    const buf = Buffer.from('hello')
    expect(sha256(buf)).toBe(HASH_HELLO)
  })

  it('retorna string hexadecimal de 64 caracteres', () => {
    const hash = sha256('qualquer string de teste')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('entradas diferentes produzem hashes diferentes', () => {
    expect(sha256('foo')).not.toBe(sha256('bar'))
  })

  it('mesma entrada sempre produz o mesmo hash (determinístico)', () => {
    const input = 'conteúdo fiscal 2024-03 tenant-abc'
    expect(sha256(input)).toBe(sha256(input))
  })

  it('sha256 de string vazia tem comprimento correto', () => {
    expect(sha256('')).toHaveLength(64)
  })
})

// ---------------------------------------------------------------------------
// nowBR
// ---------------------------------------------------------------------------

describe('nowBR()', () => {
  it('retorna uma instância de Date', () => {
    expect(nowBR()).toBeInstanceOf(Date)
  })

  it('retorna Date válido (não NaN)', () => {
    const d = nowBR()
    expect(isNaN(d.getTime())).toBe(false)
  })

  it('retorna Date próximo ao instante atual (dentro de 5 segundos)', () => {
    const before = Date.now()
    const d = nowBR()
    const after = Date.now()
    // nowBR() = new Date() — instante UTC correto para armazenamento em Prisma DateTime
    expect(d.getTime()).toBeGreaterThanOrEqual(before)
    expect(d.getTime()).toBeLessThanOrEqual(after)
  })
})

// ---------------------------------------------------------------------------
// MAPA_CFOP_CONTA
// ---------------------------------------------------------------------------

describe('MAPA_CFOP_CONTA', () => {
  it("CFOP '5102' possui entrada no mapa", () => {
    expect(MAPA_CFOP_CONTA['5.102']).toBeDefined()
  })

  it("CFOP '5102' → crédito começa com '3' (conta de receita)", () => {
    const contas = MAPA_CFOP_CONTA['5.102']
    expect(contas).toBeDefined()
    // Conta de receita começa com '3' (Receitas no plano de contas)
    expect(contas!.credito.startsWith('3')).toBe(true)
  })

  it("CFOP '5405' → crédito também é conta de receita (começa com '3')", () => {
    const contas = MAPA_CFOP_CONTA['5.405']
    expect(contas).toBeDefined()
    expect(contas!.credito.startsWith('3')).toBe(true)
  })

  it("CFOP '1102' (entrada de compra) → débito começa com '1' (ativo/estoque)", () => {
    const contas = MAPA_CFOP_CONTA['1.102']
    expect(contas).toBeDefined()
    expect(contas!.debito.startsWith('1')).toBe(true)
  })

  it("CFOP '1102' (entrada de compra) → crédito começa com '2' (passivo/fornecedor)", () => {
    const contas = MAPA_CFOP_CONTA['1.102']
    expect(contas!.credito.startsWith('2')).toBe(true)
  })

  it('CFOP inexistente retorna undefined', () => {
    expect(MAPA_CFOP_CONTA['9.999']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Decimal — aritmética sem erro de float
// ---------------------------------------------------------------------------

describe('Decimal (decimal.js)', () => {
  it('R$100,00 + R$50,00 = R$150,00 sem erro de float', () => {
    const a = new Decimal('100.00')
    const b = new Decimal('50.00')
    expect(a.plus(b).toFixed(2)).toBe('150.00')
  })

  it('0.1 + 0.2 = 0.3 (sem erro clássico de float)', () => {
    // Com number nativo: 0.1 + 0.2 === 0.30000000000000004
    const resultado = new Decimal('0.1').plus('0.2')
    expect(resultado.toFixed(1)).toBe('0.3')
  })

  it('multiplicação: R$33,33 × 3 = R$99,99', () => {
    const valor = new Decimal('33.33')
    expect(valor.times(3).toFixed(2)).toBe('99.99')
  })

  it('divisão: R$100,00 ÷ 3 = R$33,33 (arredondamento ROUND_HALF_UP)', () => {
    const resultado = new Decimal('100').div('3').toDecimalPlaces(2)
    expect(resultado.toFixed(2)).toBe('33.33')
  })

  it('comparação: R$150,00 > R$100,00', () => {
    const a = new Decimal('150.00')
    const b = new Decimal('100.00')
    expect(a.greaterThan(b)).toBe(true)
  })

  it('igualdade: new Decimal("1.50") equals new Decimal("1.5")', () => {
    expect(new Decimal('1.50').equals(new Decimal('1.5'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// addDays
// ---------------------------------------------------------------------------

describe('addDays()', () => {
  it('adiciona 7 dias a 2024-03-01 → 2024-03-08', () => {
    const base = new Date('2024-03-01T12:00:00.000Z')
    const result = addDays(base, 7)
    expect(result.getUTCFullYear()).toBe(2024)
    expect(result.getUTCMonth()).toBe(2) // 0-indexed → março
    expect(result.getUTCDate()).toBe(8)
  })

  it('adicionar 0 dias retorna a mesma data', () => {
    const base = new Date('2024-06-15T12:00:00.000Z')
    const result = addDays(base, 0)
    expect(result.getTime()).toBe(base.getTime())
  })

  it('adicionar dias atravessa meses corretamente (31 mar + 1 = 1 abr)', () => {
    const base = new Date('2024-03-31T12:00:00.000Z')
    const result = addDays(base, 1)
    expect(result.getUTCMonth()).toBe(3) // 0-indexed → abril
    expect(result.getUTCDate()).toBe(1)
  })

  it('adicionar dias negativos subtrai dias', () => {
    const base = new Date('2024-03-10T12:00:00.000Z')
    const result = addDays(base, -3)
    expect(result.getUTCDate()).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// differenceInCalendarDays
// ---------------------------------------------------------------------------

describe('differenceInCalendarDays()', () => {
  it('diferença entre 2024-03-10 e 2024-03-01 = 9 dias', () => {
    const d1 = new Date('2024-03-01T12:00:00.000Z')
    const d2 = new Date('2024-03-10T12:00:00.000Z')
    expect(differenceInCalendarDays(d2, d1)).toBe(9)
  })

  it('mesma data → diferença = 0', () => {
    const d = new Date('2024-06-15T12:00:00.000Z')
    expect(differenceInCalendarDays(d, d)).toBe(0)
  })

  it('diferença negativa quando data anterior é maior', () => {
    const d1 = new Date('2024-03-10T12:00:00.000Z')
    const d2 = new Date('2024-03-01T12:00:00.000Z')
    expect(differenceInCalendarDays(d2, d1)).toBe(-9)
  })

  it('diferença entre 2024-01-01 e 2024-12-31 = 365 (ano bissexto)', () => {
    const start = new Date('2024-01-01T12:00:00.000Z')
    const end = new Date('2024-12-31T12:00:00.000Z')
    expect(differenceInCalendarDays(end, start)).toBe(365)
  })
})

// ---------------------------------------------------------------------------
// addMeses
// ---------------------------------------------------------------------------

describe('addMeses()', () => {
  it('adiciona 1 mês corretamente', () => {
    const base = new Date(2025, 0, 15) // jan 2025
    const result = addMeses(base, 1)
    expect(result.getMonth()).toBe(1) // fev
    expect(result.getFullYear()).toBe(2025)
  })

  it('adiciona meses cruzando ano', () => {
    const base = new Date(2025, 11, 15) // dez 2025
    const result = addMeses(base, 1)
    expect(result.getMonth()).toBe(0) // jan
    expect(result.getFullYear()).toBe(2026)
  })

  it('adiciona 12 meses = mesmo mês do ano seguinte', () => {
    const base = new Date(2025, 4, 1) // mai 2025
    const result = addMeses(base, 12)
    expect(result.getMonth()).toBe(4)
    expect(result.getFullYear()).toBe(2026)
  })
})

// ---------------------------------------------------------------------------
// competencias12Meses
// ---------------------------------------------------------------------------

describe('competencias12Meses()', () => {
  it('retorna 12 competências', () => {
    const result = competencias12Meses('2025-05')
    expect(result).toHaveLength(12)
  })

  it('todas as entradas têm formato YYYY-MM', () => {
    const result = competencias12Meses('2025-12')
    result.forEach((c) => {
      expect(c).toMatch(/^\d{4}-\d{2}$/)
    })
  })

  it('resultado tem 12 entradas ordenadas crescentemente', () => {
    const result = competencias12Meses('2025-06')
    for (let i = 1; i < result.length; i++) {
      expect(result[i]! > result[i - 1]!).toBe(true)
    }
  })

  it('intervalo entre primeiro e último é de 11 meses', () => {
    const result = competencias12Meses('2025-06')
    const first = result[0]!
    const last = result[11]!
    const [fy, fm] = first.split('-').map(Number) as [number, number]
    const [ly, lm] = last.split('-').map(Number) as [number, number]
    const diffMonths = (ly - fy) * 12 + (lm - fm)
    expect(diffMonths).toBe(11)
  })
})

// ---------------------------------------------------------------------------
// validarCNPJ
// ---------------------------------------------------------------------------

describe('validarCNPJ()', () => {
  it('CNPJ válido formatado retorna true', () => {
    expect(validarCNPJ('11.222.333/0001-81')).toBe(true)
  })

  it('CNPJ válido sem formatação retorna true', () => {
    expect(validarCNPJ('11222333000181')).toBe(true)
  })

  it('CNPJ com dígitos verificadores errados retorna false', () => {
    expect(validarCNPJ('11222333000100')).toBe(false)
  })

  it('CNPJ com todos dígitos iguais retorna false', () => {
    expect(validarCNPJ('11111111111111')).toBe(false)
    expect(validarCNPJ('00000000000000')).toBe(false)
  })

  it('CNPJ com menos de 14 dígitos retorna false', () => {
    expect(validarCNPJ('1122233300018')).toBe(false)
  })

  it('string vazia retorna false', () => {
    expect(validarCNPJ('')).toBe(false)
  })

  it('outro CNPJ válido conhecido', () => {
    // 00.000.000/0001-91 é válido (Banco do Brasil)
    expect(validarCNPJ('00000000000191')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// formatarCNPJ
// ---------------------------------------------------------------------------

describe('formatarCNPJ()', () => {
  it('formata 14 dígitos no padrão XX.XXX.XXX/XXXX-XX', () => {
    expect(formatarCNPJ('11222333000181')).toBe('11.222.333/0001-81')
  })

  it('aceita CNPJ já formatado como entrada', () => {
    expect(formatarCNPJ('11.222.333/0001-81')).toBe('11.222.333/0001-81')
  })
})

// ---------------------------------------------------------------------------
// limparCNPJ
// ---------------------------------------------------------------------------

describe('limparCNPJ()', () => {
  it('remove pontuação e retorna apenas dígitos', () => {
    expect(limparCNPJ('11.222.333/0001-81')).toBe('11222333000181')
  })

  it('CNPJ sem pontuação permanece igual', () => {
    expect(limparCNPJ('11222333000181')).toBe('11222333000181')
  })
})
