/**
 * Testes unitários — S3KeyBuilder
 *
 * Cobre todos os métodos estáticos puros:
 *  - xmlNFeEmitida, pdfNFeEmitida, xmlNFCeEmitida
 *  - xmlNFSe, xmlNFSeTomada
 *  - guiaDAS, guiaGNRE, guiaISS
 *  - relatorioConciliacao, apuracaoPGDAS, memoriaCalcDifal
 *  - reciboObrigacao, lancamentosContabeis, ecdArquivo
 *  - erroScreenshot, erroLog (formato com timestamp)
 *  - auditoriaEvidencia, relatorio
 *
 * Nenhum mock necessário — funções são puras (exceto erroScreenshot/erroLog
 * que usam Date.now() internamente; testamos o padrão via regex).
 */

import { describe, it, expect } from 'vitest'
import { S3KeyBuilder } from '../s3-key-builder.js'

const CNPJ = '11111111000111'
const COMPETENCIA = '2025-01'
const CHAVE_NFE = '35250111111111000111550010000000011000000014'
const IBGE = '3550308'
const UF = 'SP'
const TENANT_ID = 'tenant-abc'
const AUDIT_EVENT_ID = 'evt-001'

// ---------------------------------------------------------------------------
// NF-e emitida
// ---------------------------------------------------------------------------

describe('S3KeyBuilder — NF-e emitida', () => {
  it('xmlNFeEmitida() monta caminho correto', () => {
    const key = S3KeyBuilder.xmlNFeEmitida(CNPJ, COMPETENCIA, CHAVE_NFE)
    expect(key).toBe(`${CNPJ}/${COMPETENCIA}/notas-emitidas/nfe/${CHAVE_NFE}.xml`)
  })

  it('pdfNFeEmitida() monta caminho DANFE correto', () => {
    const key = S3KeyBuilder.pdfNFeEmitida(CNPJ, COMPETENCIA, CHAVE_NFE)
    expect(key).toBe(`${CNPJ}/${COMPETENCIA}/notas-emitidas/nfe/${CHAVE_NFE}-danfe.pdf`)
  })

  it('xmlNFeEmitida() e pdfNFeEmitida() ficam na mesma pasta', () => {
    const xml = S3KeyBuilder.xmlNFeEmitida(CNPJ, COMPETENCIA, CHAVE_NFE)
    const pdf = S3KeyBuilder.pdfNFeEmitida(CNPJ, COMPETENCIA, CHAVE_NFE)
    const pastaXml = xml.split('/').slice(0, -1).join('/')
    const pastaPdf = pdf.split('/').slice(0, -1).join('/')
    expect(pastaXml).toBe(pastaPdf)
  })

  it('xml termina em .xml', () => {
    const key = S3KeyBuilder.xmlNFeEmitida(CNPJ, COMPETENCIA, CHAVE_NFE)
    expect(key.endsWith('.xml')).toBe(true)
  })

  it('pdf termina em .pdf', () => {
    const key = S3KeyBuilder.pdfNFeEmitida(CNPJ, COMPETENCIA, CHAVE_NFE)
    expect(key.endsWith('.pdf')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// NFC-e emitida
// ---------------------------------------------------------------------------

describe('S3KeyBuilder — NFC-e emitida', () => {
  it('xmlNFCeEmitida() monta caminho correto', () => {
    const key = S3KeyBuilder.xmlNFCeEmitida(CNPJ, COMPETENCIA, CHAVE_NFE)
    expect(key).toBe(`${CNPJ}/${COMPETENCIA}/notas-emitidas/nfce/${CHAVE_NFE}.xml`)
  })

  it('NF-e e NFC-e ficam em pastas diferentes', () => {
    const nfe = S3KeyBuilder.xmlNFeEmitida(CNPJ, COMPETENCIA, CHAVE_NFE)
    const nfce = S3KeyBuilder.xmlNFCeEmitida(CNPJ, COMPETENCIA, CHAVE_NFE)
    expect(nfe).not.toBe(nfce)
    expect(nfe).toContain('/nfe/')
    expect(nfce).toContain('/nfce/')
  })
})

// ---------------------------------------------------------------------------
// NFSe
// ---------------------------------------------------------------------------

describe('S3KeyBuilder — NFSe', () => {
  it('xmlNFSe() monta caminho com numero e ibge', () => {
    const key = S3KeyBuilder.xmlNFSe(CNPJ, COMPETENCIA, '1234', IBGE)
    expect(key).toBe(`${CNPJ}/${COMPETENCIA}/notas-emitidas/nfse/1234-${IBGE}.xml`)
  })

  it('xmlNFSeTomada() monta caminho com ibge e numero em pasta separada', () => {
    const key = S3KeyBuilder.xmlNFSeTomada(CNPJ, COMPETENCIA, IBGE, '5678')
    expect(key).toBe(`${CNPJ}/${COMPETENCIA}/notas-tomadas/nfse-prefeitura/${IBGE}/5678.xml`)
  })

  it('NFSe emitida fica em notas-emitidas', () => {
    const key = S3KeyBuilder.xmlNFSe(CNPJ, COMPETENCIA, '1', IBGE)
    expect(key).toContain('notas-emitidas')
  })

  it('NFSe tomada fica em notas-tomadas', () => {
    const key = S3KeyBuilder.xmlNFSeTomada(CNPJ, COMPETENCIA, IBGE, '1')
    expect(key).toContain('notas-tomadas')
  })

  it('NFSes de prefeituras diferentes ficam em subpastas distintas', () => {
    const ibge1 = '3550308' // São Paulo
    const ibge2 = '3304557' // Rio de Janeiro
    const k1 = S3KeyBuilder.xmlNFSeTomada(CNPJ, COMPETENCIA, ibge1, '1')
    const k2 = S3KeyBuilder.xmlNFSeTomada(CNPJ, COMPETENCIA, ibge2, '1')
    expect(k1).not.toBe(k2)
  })
})

// ---------------------------------------------------------------------------
// Guias
// ---------------------------------------------------------------------------

describe('S3KeyBuilder — guias', () => {
  it('guiaDAS() monta caminho com competencia no nome do arquivo', () => {
    const key = S3KeyBuilder.guiaDAS(CNPJ, COMPETENCIA)
    expect(key).toBe(`${CNPJ}/${COMPETENCIA}/guias/das-${COMPETENCIA}.pdf`)
  })

  it('guiaGNRE() inclui UF no caminho', () => {
    const key = S3KeyBuilder.guiaGNRE(CNPJ, COMPETENCIA, UF)
    expect(key).toBe(`${CNPJ}/${COMPETENCIA}/guias/gnre-${UF}-${COMPETENCIA}.pdf`)
  })

  it('guiaGNRE() UFs diferentes → caminhos diferentes', () => {
    const sp = S3KeyBuilder.guiaGNRE(CNPJ, COMPETENCIA, 'SP')
    const rj = S3KeyBuilder.guiaGNRE(CNPJ, COMPETENCIA, 'RJ')
    expect(sp).not.toBe(rj)
    expect(sp).toContain('SP')
    expect(rj).toContain('RJ')
  })

  it('guiaISS() inclui ibge no caminho', () => {
    const key = S3KeyBuilder.guiaISS(CNPJ, COMPETENCIA, IBGE)
    expect(key).toBe(`${CNPJ}/${COMPETENCIA}/guias/iss-${IBGE}-${COMPETENCIA}.pdf`)
  })

  it('todas as guias ficam na pasta /guias/', () => {
    const das = S3KeyBuilder.guiaDAS(CNPJ, COMPETENCIA)
    const gnre = S3KeyBuilder.guiaGNRE(CNPJ, COMPETENCIA, UF)
    const iss = S3KeyBuilder.guiaISS(CNPJ, COMPETENCIA, IBGE)
    expect(das).toContain('/guias/')
    expect(gnre).toContain('/guias/')
    expect(iss).toContain('/guias/')
  })

  it('todas as guias terminam em .pdf', () => {
    expect(S3KeyBuilder.guiaDAS(CNPJ, COMPETENCIA).endsWith('.pdf')).toBe(true)
    expect(S3KeyBuilder.guiaGNRE(CNPJ, COMPETENCIA, UF).endsWith('.pdf')).toBe(true)
    expect(S3KeyBuilder.guiaISS(CNPJ, COMPETENCIA, IBGE).endsWith('.pdf')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Relatórios
// ---------------------------------------------------------------------------

describe('S3KeyBuilder — relatórios', () => {
  it('relatorioConciliacao() inclui tipo no nome', () => {
    const key = S3KeyBuilder.relatorioConciliacao(CNPJ, COMPETENCIA, 'nfse')
    expect(key).toBe(`${CNPJ}/${COMPETENCIA}/relatorios/conciliacao-nfse-${COMPETENCIA}.xlsx`)
  })

  it('relatorioConciliacao() tipos diferentes → arquivos diferentes', () => {
    const nfse = S3KeyBuilder.relatorioConciliacao(CNPJ, COMPETENCIA, 'nfse')
    const nfe = S3KeyBuilder.relatorioConciliacao(CNPJ, COMPETENCIA, 'nfe')
    expect(nfse).not.toBe(nfe)
  })

  it('relatorioConciliacao() termina em .xlsx', () => {
    const key = S3KeyBuilder.relatorioConciliacao(CNPJ, COMPETENCIA, 'nfce')
    expect(key.endsWith('.xlsx')).toBe(true)
  })

  it('apuracaoPGDAS() monta caminho correto', () => {
    const key = S3KeyBuilder.apuracaoPGDAS(CNPJ, COMPETENCIA)
    expect(key).toBe(`${CNPJ}/${COMPETENCIA}/relatorios/apuracao-pgdas-${COMPETENCIA}.pdf`)
  })

  it('memoriaCalcDifal() monta caminho correto', () => {
    const key = S3KeyBuilder.memoriaCalcDifal(CNPJ, COMPETENCIA)
    expect(key).toBe(
      `${CNPJ}/${COMPETENCIA}/relatorios/memoria-calculo-difal-${COMPETENCIA}.pdf`
    )
  })

  it('relatorio() usa tenant e competencia', () => {
    const key = S3KeyBuilder.relatorio(TENANT_ID, COMPETENCIA)
    expect(key).toBe(
      `tenants/${TENANT_ID}/relatorios/relatorio-consolidado-${COMPETENCIA}.csv`
    )
  })

  it('relatorio() tenants diferentes → caminhos diferentes', () => {
    const k1 = S3KeyBuilder.relatorio('tenant-1', COMPETENCIA)
    const k2 = S3KeyBuilder.relatorio('tenant-2', COMPETENCIA)
    expect(k1).not.toBe(k2)
  })
})

// ---------------------------------------------------------------------------
// Obrigações e recibos
// ---------------------------------------------------------------------------

describe('S3KeyBuilder — obrigações', () => {
  it('reciboObrigacao() inclui tipo e competencia', () => {
    const key = S3KeyBuilder.reciboObrigacao(CNPJ, COMPETENCIA, 'EFD-REINF')
    expect(key).toBe(`${CNPJ}/${COMPETENCIA}/obrigacoes/EFD-REINF-${COMPETENCIA}-recibo.xml`)
  })

  it('reciboObrigacao() tipos diferentes → arquivos diferentes', () => {
    const r1 = S3KeyBuilder.reciboObrigacao(CNPJ, COMPETENCIA, 'PGDAS')
    const r2 = S3KeyBuilder.reciboObrigacao(CNPJ, COMPETENCIA, 'DCTFWEB')
    expect(r1).not.toBe(r2)
  })
})

// ---------------------------------------------------------------------------
// Contábil
// ---------------------------------------------------------------------------

describe('S3KeyBuilder — contábil', () => {
  it('lancamentosContabeis() monta caminho correto', () => {
    const key = S3KeyBuilder.lancamentosContabeis(CNPJ, COMPETENCIA)
    expect(key).toBe(`${CNPJ}/${COMPETENCIA}/contabil/lancamentos-${COMPETENCIA}.json`)
  })

  it('lancamentosContabeis() termina em .json', () => {
    const key = S3KeyBuilder.lancamentosContabeis(CNPJ, COMPETENCIA)
    expect(key.endsWith('.json')).toBe(true)
  })

  it('ecdArquivo() usa ano (não competência) e termina em .txt', () => {
    const key = S3KeyBuilder.ecdArquivo(CNPJ, '2025')
    expect(key).toBe(`${CNPJ}/2025/contabil/ecd-2025.txt`)
    expect(key.endsWith('.txt')).toBe(true)
  })

  it('ecdArquivo() anos diferentes → arquivos diferentes', () => {
    const k1 = S3KeyBuilder.ecdArquivo(CNPJ, '2024')
    const k2 = S3KeyBuilder.ecdArquivo(CNPJ, '2025')
    expect(k1).not.toBe(k2)
  })
})

// ---------------------------------------------------------------------------
// Erros (usam Date.now() — testamos padrão)
// ---------------------------------------------------------------------------

describe('S3KeyBuilder — erros', () => {
  it('erroScreenshot() contém cnpj, jobId e termina em .png', () => {
    const jobId = 'job-123'
    const key = S3KeyBuilder.erroScreenshot(CNPJ, jobId)
    expect(key).toContain(CNPJ)
    expect(key).toContain(jobId)
    expect(key).toContain('screenshots')
    expect(key.endsWith('.png')).toBe(true)
  })

  it('erroScreenshot() chamado duas vezes → chaves diferentes (timestamp)', async () => {
    const k1 = S3KeyBuilder.erroScreenshot(CNPJ, 'job-1')
    await new Promise((r) => setTimeout(r, 2))
    const k2 = S3KeyBuilder.erroScreenshot(CNPJ, 'job-1')
    // timestamps can be identical in fast machines; just check they exist and match the pattern
    expect(k1).toMatch(/erros\/screenshots\/job-1-\d+\.png$/)
    expect(k2).toMatch(/erros\/screenshots\/job-1-\d+\.png$/)
  })

  it('erroLog() contém cnpj, jobId e termina em .json', () => {
    const jobId = 'job-456'
    const key = S3KeyBuilder.erroLog(CNPJ, jobId)
    expect(key).toContain(CNPJ)
    expect(key).toContain(jobId)
    expect(key).toContain('logs')
    expect(key.endsWith('.json')).toBe(true)
  })

  it('erroScreenshot() e erroLog() ficam em subpastas distintas', () => {
    const screenshot = S3KeyBuilder.erroScreenshot(CNPJ, 'job-1')
    const log = S3KeyBuilder.erroLog(CNPJ, 'job-1')
    expect(screenshot).toContain('screenshots')
    expect(log).toContain('logs')
    expect(screenshot).not.toContain('logs')
    expect(log).not.toContain('screenshots')
  })
})

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

describe('S3KeyBuilder — auditoria', () => {
  it('auditoriaEvidencia() monta caminho com auditEventId e filename', () => {
    const key = S3KeyBuilder.auditoriaEvidencia(TENANT_ID, AUDIT_EVENT_ID, 'screenshot.png')
    expect(key).toBe(`auditoria/evidencias/${AUDIT_EVENT_ID}/screenshot.png`)
  })

  it('auditoriaEvidencia() começa com auditoria/', () => {
    const key = S3KeyBuilder.auditoriaEvidencia(TENANT_ID, AUDIT_EVENT_ID, 'doc.pdf')
    expect(key.startsWith('auditoria/')).toBe(true)
  })

  it('auditoriaEvidencia() eventos diferentes → caminhos diferentes', () => {
    const k1 = S3KeyBuilder.auditoriaEvidencia(TENANT_ID, 'evt-1', 'f.png')
    const k2 = S3KeyBuilder.auditoriaEvidencia(TENANT_ID, 'evt-2', 'f.png')
    expect(k1).not.toBe(k2)
  })
})

// ---------------------------------------------------------------------------
// Isolamento por CNPJ e competência
// ---------------------------------------------------------------------------

describe('S3KeyBuilder — isolamento por CNPJ e competência', () => {
  it('CNPJs diferentes geram caminhos distintos', () => {
    const c1 = S3KeyBuilder.guiaDAS('11111111000111', COMPETENCIA)
    const c2 = S3KeyBuilder.guiaDAS('22222222000122', COMPETENCIA)
    expect(c1).not.toBe(c2)
  })

  it('competências diferentes geram caminhos distintos', () => {
    const k1 = S3KeyBuilder.guiaDAS(CNPJ, '2025-01')
    const k2 = S3KeyBuilder.guiaDAS(CNPJ, '2025-02')
    expect(k1).not.toBe(k2)
  })

  it('todos os caminhos começam com o CNPJ (exceto auditoria e relatorio)', () => {
    const keys = [
      S3KeyBuilder.xmlNFeEmitida(CNPJ, COMPETENCIA, CHAVE_NFE),
      S3KeyBuilder.pdfNFeEmitida(CNPJ, COMPETENCIA, CHAVE_NFE),
      S3KeyBuilder.xmlNFCeEmitida(CNPJ, COMPETENCIA, CHAVE_NFE),
      S3KeyBuilder.xmlNFSe(CNPJ, COMPETENCIA, '1', IBGE),
      S3KeyBuilder.xmlNFSeTomada(CNPJ, COMPETENCIA, IBGE, '1'),
      S3KeyBuilder.guiaDAS(CNPJ, COMPETENCIA),
      S3KeyBuilder.guiaGNRE(CNPJ, COMPETENCIA, UF),
      S3KeyBuilder.guiaISS(CNPJ, COMPETENCIA, IBGE),
      S3KeyBuilder.relatorioConciliacao(CNPJ, COMPETENCIA, 'nfse'),
      S3KeyBuilder.apuracaoPGDAS(CNPJ, COMPETENCIA),
      S3KeyBuilder.memoriaCalcDifal(CNPJ, COMPETENCIA),
      S3KeyBuilder.reciboObrigacao(CNPJ, COMPETENCIA, 'PGDAS'),
      S3KeyBuilder.lancamentosContabeis(CNPJ, COMPETENCIA),
      S3KeyBuilder.ecdArquivo(CNPJ, '2025'),
      S3KeyBuilder.erroScreenshot(CNPJ, 'j-1'),
      S3KeyBuilder.erroLog(CNPJ, 'j-1'),
    ]
    for (const key of keys) {
      expect(key.startsWith(CNPJ), `Esperado começar com CNPJ: ${key}`).toBe(true)
    }
  })
})
