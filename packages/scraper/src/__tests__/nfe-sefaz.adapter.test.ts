/**
 * Testes unitários — NFeSefazAdapter
 *
 * Cobre:
 *  - authenticate(): retorna token 'cert-auth' com expiresAt 4h no futuro
 *  - fetch(): chama axios.post com SOAPAction e Content-Type corretos
 *  - fetch(): cStat 137 → documentos extraídos do docZip (base64+gzip)
 *  - fetch(): cStat 138 → documentos extraídos
 *  - fetch(): cStat 100 (sem documentos) → retorna array vazio
 *  - fetch(): cStat 225 (erro) → retorna array vazio
 *  - fetch(): docZip com base64 inválido → ignora, não lança
 *  - fetch(): NF-e sem nNF nem chave → ignorado (null parseNFeXML)
 *  - fetch(): NF-e com chave no atributo Id="NFe..."
 *  - fetch(): NF-e com chave em <chNFe>
 *  - fetch(): valorTotal parseado corretamente como Decimal
 *  - fetch(): cnpjDestinatario vazio → usa cnpjPrincipal como fallback
 *  - fetch(): erro do axios → lança erro (re-throw dentro do withRetry)
 *  - downloadXML(): retorna xmlContent do doc
 *  - downloadXML(): doc sem xmlContent → retorna string vazia
 *  - downloadPDF(): retorna Buffer vazio
 *  - healthCheck(): axios.get ok → true
 *  - healthCheck(): axios.get falha → false
 *  - buildDistribuicaoEnvelope: contém CNPJ e ultNSU no SOAP body
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { gzipSync } from 'zlib'
import { Decimal } from '@saas-contabil/shared'

// ---------------------------------------------------------------------------
// Mocks (devem preceder o import do módulo testado)
// ---------------------------------------------------------------------------

const { mockAxiosPost, mockAxiosGet } = vi.hoisted(() => ({
  mockAxiosPost: vi.fn(),
  mockAxiosGet: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    post: mockAxiosPost,
    get: mockAxiosGet,
  },
}))

vi.mock('@saas-contabil/storage', () => ({
  StorageService: vi.fn().mockImplementation(() => ({
    upload: vi.fn(),
    download: vi.fn(),
    getSignedUrl: vi.fn(),
  })),
  S3KeyBuilder: {
    erroScreenshot: vi.fn().mockReturnValue('erros/screenshot.png'),
  },
}))

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(null),
          close: vi.fn(),
        }),
        close: vi.fn(),
      }),
      close: vi.fn(),
    }),
  },
}))

import { NFeSefazAdapter } from '../adapters/nfe-sefaz.adapter.js'

// ---------------------------------------------------------------------------
// Helpers: gera SOAP response com docZip contendo NF-e XML gzipado
// ---------------------------------------------------------------------------

function makeNFeXml(opts: {
  nNF?: string
  serie?: string
  dhEmi?: string
  cnpjEmit?: string
  nomeEmit?: string
  cnpjDest?: string
  vNF?: string
  chaveAttr?: boolean
  chaveTag?: boolean
  chave?: string
}): string {
  const chave = opts.chave ?? '35240100000000000000550011234500001234567890'
  const idAttr = opts.chaveAttr !== false ? ` Id="NFe${chave}"` : ''
  const chaveTag = opts.chaveTag ? `<chNFe>${chave}</chNFe>` : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe versao="4.00"${idAttr}>
      <ide>
        <nNF>${opts.nNF ?? '12345'}</nNF>
        <serie>${opts.serie ?? '1'}</serie>
        <dhEmi>${opts.dhEmi ?? '2025-01-15T10:00:00-03:00'}</dhEmi>
      </ide>
      <emit>
        <CNPJ>${opts.cnpjEmit ?? '12345678000195'}</CNPJ>
        <xNome>${opts.nomeEmit ?? 'EMPRESA EMITENTE SA'}</xNome>
      </emit>
      <dest>
        <CNPJ>${opts.cnpjDest ?? '98765432000100'}</CNPJ>
      </dest>
      <total>
        <ICMSTot>
          <vNF>${opts.vNF ?? '1500.00'}</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>${chaveTag}</infProt>
  </protNFe>
</nfeProc>`
}

function makeDocZip(nfeXml: string): string {
  const compressed = gzipSync(Buffer.from(nfeXml, 'utf8'))
  return compressed.toString('base64')
}

function makeSoapResponse(cStat: number, docZips: string[] = []): string {
  const lote =
    docZips.length > 0
      ? `<loteDistDFeInt>
        ${docZips.map((d, i) => `<docZip NSU="${String(i + 1).padStart(15, '0')}" schema="procNFe_v4.00.xsd">${d}</docZip>`).join('\n        ')}
      </loteDistDFeInt>`
      : ''

  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope>
  <soap12:Body>
    <nfeDistDFeInteresseResponse>
      <nfeDistDFeInteresseResult>
        <retDistDFeInt versao="1.01">
          <tpAmb>1</tpAmb>
          <cStat>${cStat}</cStat>
          <xMotivo>Documento(s) localizado(s)</xMotivo>
          <ultNSU>000000000000001</ultNSU>
          ${lote}
        </retDistDFeInt>
      </nfeDistDFeInteresseResult>
    </nfeDistDFeInteresseResponse>
  </soap12:Body>
</soap12:Envelope>`
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const CNPJ = '98765432000100'
const PERIODO = {
  inicio: new Date('2025-01-01T00:00:00Z'),
  fim: new Date('2025-01-31T23:59:59Z'),
  competencia: '2025-01',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAxiosGet.mockResolvedValue({ status: 200 })
})

// ---------------------------------------------------------------------------
// authenticate
// ---------------------------------------------------------------------------

describe('NFeSefazAdapter — authenticate()', () => {
  it('retorna token cert-auth', async () => {
    const adapter = new NFeSefazAdapter()
    const session = await adapter.authenticate({ id: 'cred-1', data: Buffer.alloc(0), tipo: 'PFX' })
    expect(session.token).toBe('cert-auth')
  })

  it('expiresAt está ~4h no futuro', async () => {
    const adapter = new NFeSefazAdapter()
    const before = Date.now()
    const session = await adapter.authenticate({ id: 'cred-1', data: Buffer.alloc(0), tipo: 'PFX' })
    const after = Date.now()
    const msMin = 4 * 60 * 60 * 1000 - 1000
    const msMax = 4 * 60 * 60 * 1000 + 1000
    expect(session.expiresAt.getTime() - before).toBeGreaterThanOrEqual(msMin)
    expect(session.expiresAt.getTime() - after).toBeLessThanOrEqual(msMax)
  })
})

// ---------------------------------------------------------------------------
// fetch() — SOAP request
// ---------------------------------------------------------------------------

describe('NFeSefazAdapter — fetch() SOAP request', () => {
  it('chama axios.post com SOAPAction correto no header', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: makeSoapResponse(100) })

    const adapter = new NFeSefazAdapter()
    await adapter.fetch(CNPJ, PERIODO)

    const callArgs = mockAxiosPost.mock.calls[0]
    expect(callArgs![2].headers['SOAPAction']).toContain('nfeDistDFeInteresse')
  })

  it('chama axios.post com Content-Type text/xml', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: makeSoapResponse(100) })

    const adapter = new NFeSefazAdapter()
    await adapter.fetch(CNPJ, PERIODO)

    const callArgs = mockAxiosPost.mock.calls[0]
    expect(callArgs![2].headers['Content-Type']).toContain('text/xml')
  })

  it('envelope SOAP contém o CNPJ informado', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: makeSoapResponse(100) })

    const adapter = new NFeSefazAdapter()
    await adapter.fetch(CNPJ, PERIODO)

    const envelope = mockAxiosPost.mock.calls[0]![1] as string
    expect(envelope).toContain(`<CNPJ>${CNPJ}</CNPJ>`)
  })

  it('envelope SOAP contém ultNSU = 000000000000000', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: makeSoapResponse(100) })

    const adapter = new NFeSefazAdapter()
    await adapter.fetch(CNPJ, PERIODO)

    const envelope = mockAxiosPost.mock.calls[0]![1] as string
    expect(envelope).toContain('<ultNSU>000000000000000</ultNSU>')
  })

  it('timeout de 60000ms configurado na chamada', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: makeSoapResponse(100) })

    const adapter = new NFeSefazAdapter()
    await adapter.fetch(CNPJ, PERIODO)

    const callArgs = mockAxiosPost.mock.calls[0]
    expect(callArgs![2].timeout).toBe(60000)
  })
})

// ---------------------------------------------------------------------------
// fetch() — cStat / parsing
// ---------------------------------------------------------------------------

describe('NFeSefazAdapter — fetch() parseResponse', () => {
  it('cStat 100 (sem documentos) → retorna array vazio', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: makeSoapResponse(100) })

    const adapter = new NFeSefazAdapter()
    const result = await adapter.fetch(CNPJ, PERIODO)

    expect(result).toEqual([])
  })

  it('cStat 225 (erro SEFAZ) → retorna array vazio', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: makeSoapResponse(225) })

    const adapter = new NFeSefazAdapter()
    const result = await adapter.fetch(CNPJ, PERIODO)

    expect(result).toEqual([])
  })

  it('cStat 137 com um docZip → retorna 1 documento', async () => {
    const nfeXml = makeNFeXml({})
    const soap = makeSoapResponse(137, [makeDocZip(nfeXml)])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const result = await adapter.fetch(CNPJ, PERIODO)

    expect(result).toHaveLength(1)
  })

  it('cStat 138 com um docZip → retorna 1 documento', async () => {
    const nfeXml = makeNFeXml({})
    const soap = makeSoapResponse(138, [makeDocZip(nfeXml)])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const result = await adapter.fetch(CNPJ, PERIODO)

    expect(result).toHaveLength(1)
  })

  it('dois docZips → retorna 2 documentos', async () => {
    const xml1 = makeNFeXml({ nNF: '1', chave: '35240100000000000000550011234500001234567890' })
    const xml2 = makeNFeXml({ nNF: '2', chave: '35240200000000000000550011234500009999999999' })
    const soap = makeSoapResponse(137, [makeDocZip(xml1), makeDocZip(xml2)])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const result = await adapter.fetch(CNPJ, PERIODO)

    expect(result).toHaveLength(2)
  })

  it('tipo sempre NFE', async () => {
    const soap = makeSoapResponse(137, [makeDocZip(makeNFeXml({}))])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const [doc] = await adapter.fetch(CNPJ, PERIODO)

    expect(doc!.tipo).toBe('NFE')
  })

  it('fonte sempre SEFAZ_FEDERAL', async () => {
    const soap = makeSoapResponse(137, [makeDocZip(makeNFeXml({}))])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const [doc] = await adapter.fetch(CNPJ, PERIODO)

    expect(doc!.fonte).toBe('SEFAZ_FEDERAL')
  })

  it('chaveAcesso extraída do atributo Id="NFe..."', async () => {
    const chave = '35240100000000000000550011234500001234567890'
    const soap = makeSoapResponse(137, [
      makeDocZip(makeNFeXml({ chave, chaveAttr: true, chaveTag: false })),
    ])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const [doc] = await adapter.fetch(CNPJ, PERIODO)

    expect(doc!.chaveAcesso).toBe(chave)
  })

  it('chaveAcesso extraída da tag <chNFe> quando atributo Id ausente', async () => {
    const chave = '35240100000000000000550011234500001234567890'
    const xml = makeNFeXml({ chave, chaveAttr: false, chaveTag: true })
    const soap = makeSoapResponse(137, [makeDocZip(xml)])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const [doc] = await adapter.fetch(CNPJ, PERIODO)

    expect(doc!.chaveAcesso).toBe(chave)
  })

  it('numero e serie extraídos corretamente', async () => {
    const soap = makeSoapResponse(137, [makeDocZip(makeNFeXml({ nNF: '99887', serie: '2' }))])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const [doc] = await adapter.fetch(CNPJ, PERIODO)

    expect(doc!.numero).toBe('99887')
    expect(doc!.serie).toBe('2')
  })

  it('dataEmissao parseada corretamente', async () => {
    const soap = makeSoapResponse(137, [
      makeDocZip(makeNFeXml({ dhEmi: '2025-03-20T14:30:00-03:00' })),
    ])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const [doc] = await adapter.fetch(CNPJ, PERIODO)

    expect(doc!.dataEmissao).toBeInstanceOf(Date)
    expect(doc!.dataEmissao.getFullYear()).toBe(2025)
  })

  it('cnpjEmitente e nomeEmitente extraídos do bloco <emit>', async () => {
    const soap = makeSoapResponse(137, [
      makeDocZip(makeNFeXml({ cnpjEmit: '12345678000195', nomeEmit: 'PADARIA BOA VISTA LTDA' })),
    ])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const [doc] = await adapter.fetch(CNPJ, PERIODO)

    expect(doc!.cnpjEmitente).toBe('12345678000195')
    expect(doc!.nomeEmitente).toBe('PADARIA BOA VISTA LTDA')
  })

  it('cnpjDestinatario extraído do bloco <dest>', async () => {
    const soap = makeSoapResponse(137, [makeDocZip(makeNFeXml({ cnpjDest: '98765432000100' }))])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const [doc] = await adapter.fetch(CNPJ, PERIODO)

    expect(doc!.cnpjDestinatario).toBe('98765432000100')
  })

  it('cnpjDestinatario vazio no XML → usa cnpj principal como fallback', async () => {
    const xmlSemDest = `<?xml version="1.0"?>
<nfeProc>
  <NFe>
    <infNFe Id="NFe35240100000000000000550011234500001234567890">
      <ide><nNF>1</nNF><serie>1</serie><dhEmi>2025-01-15T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000195</CNPJ><xNome>EMIT SA</xNome></emit>
      <dest></dest>
      <total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`
    const soap = makeSoapResponse(137, [makeDocZip(xmlSemDest)])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const [doc] = await adapter.fetch(CNPJ, PERIODO)

    expect(doc!.cnpjDestinatario).toBe(CNPJ)
  })

  it('valorTotal é Decimal com valor correto', async () => {
    const soap = makeSoapResponse(137, [makeDocZip(makeNFeXml({ vNF: '4500.75' }))])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const [doc] = await adapter.fetch(CNPJ, PERIODO)

    expect(doc!.valorTotal).toBeInstanceOf(Decimal)
    expect(doc!.valorTotal.toFixed(2)).toBe('4500.75')
  })

  it('xmlContent preservado no documento retornado', async () => {
    const soap = makeSoapResponse(137, [makeDocZip(makeNFeXml({}))])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const [doc] = await adapter.fetch(CNPJ, PERIODO)

    expect(doc!.xmlContent).toBeDefined()
    expect(doc!.xmlContent).toContain('<nfeProc')
  })

  it('docZip com base64 inválido → ignorado, outros documentos processados', async () => {
    const validXml = makeNFeXml({ nNF: '999' })
    const soap = `<?xml version="1.0"?><retDistDFeInt><cStat>137</cStat>
      <loteDistDFeInt>
        <docZip schema="x">INVALID_BASE64!!!</docZip>
        <docZip schema="procNFe_v4.00.xsd">${makeDocZip(validXml)}</docZip>
      </loteDistDFeInt>
    </retDistDFeInt>`
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const result = await adapter.fetch(CNPJ, PERIODO)

    expect(result).toHaveLength(1)
    expect(result[0]!.numero).toBe('999')
  })

  it('NF-e sem nNF e sem chave → ignorada (parseNFeXML retorna null)', async () => {
    const xmlSemNumeroEChave = `<?xml version="1.0"?>
<nfeProc>
  <NFe>
    <infNFe>
      <ide><dhEmi>2025-01-15T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>12345678000195</CNPJ><xNome>SA</xNome></emit>
      <dest><CNPJ>98765432000100</CNPJ></dest>
      <total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`
    const soap = makeSoapResponse(137, [makeDocZip(xmlSemNumeroEChave)])
    mockAxiosPost.mockResolvedValueOnce({ data: soap })

    const adapter = new NFeSefazAdapter()
    const result = await adapter.fetch(CNPJ, PERIODO)

    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// fetch() — erro axios (first attempt falha, segundo sucede via retry)
// ---------------------------------------------------------------------------

describe('NFeSefazAdapter — fetch() retry e erro do axios', () => {
  it('primeira chamada falha, segunda sucede → retorna documentos', async () => {
    const nfeXml = makeNFeXml({ nNF: '42' })
    mockAxiosPost
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: makeSoapResponse(137, [makeDocZip(nfeXml)]) })

    const adapter = new NFeSefazAdapter()
    const result = await adapter.fetch(CNPJ, PERIODO)

    expect(mockAxiosPost).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(1)
  }, 10000) // withRetry aguarda 1 segundo antes do segundo attempt

  it('todas as tentativas falham → lança o último erro', async () => {
    mockAxiosPost.mockRejectedValue(new Error('ECONNREFUSED'))

    const adapter = new NFeSefazAdapter()
    await expect(adapter.fetch(CNPJ, PERIODO)).rejects.toThrow('ECONNREFUSED')

    expect(mockAxiosPost).toHaveBeenCalledTimes(4)
  }, 30000) // withRetry tem delays de 1s + 2s + 4s = 7s
})

// ---------------------------------------------------------------------------
// downloadXML / downloadPDF
// ---------------------------------------------------------------------------

describe('NFeSefazAdapter — downloadXML / downloadPDF', () => {
  it('downloadXML retorna xmlContent do documento', async () => {
    const adapter = new NFeSefazAdapter()
    const doc = {
      tipo: 'NFE',
      numero: '1',
      dataEmissao: new Date(),
      cnpjEmitente: '12345678000195',
      nomeEmitente: 'SA',
      cnpjDestinatario: '98765432000100',
      valorTotal: new Decimal('100'),
      fonte: 'SEFAZ_FEDERAL',
      xmlContent: '<nfeProc>...</nfeProc>',
    }
    const result = await adapter.downloadXML(doc)
    expect(result).toBe('<nfeProc>...</nfeProc>')
  })

  it('downloadXML retorna string vazia quando xmlContent ausente', async () => {
    const adapter = new NFeSefazAdapter()
    const doc = {
      tipo: 'NFE',
      numero: '1',
      dataEmissao: new Date(),
      cnpjEmitente: '12345678000195',
      nomeEmitente: 'SA',
      cnpjDestinatario: '98765432000100',
      valorTotal: new Decimal('100'),
      fonte: 'SEFAZ_FEDERAL',
    }
    const result = await adapter.downloadXML(doc)
    expect(result).toBe('')
  })

  it('downloadPDF retorna Buffer vazio', async () => {
    const adapter = new NFeSefazAdapter()
    const doc = {
      tipo: 'NFE',
      numero: '1',
      dataEmissao: new Date(),
      cnpjEmitente: '12345678000195',
      nomeEmitente: 'SA',
      cnpjDestinatario: '98765432000100',
      valorTotal: new Decimal('100'),
      fonte: 'SEFAZ_FEDERAL',
    }
    const result = await adapter.downloadPDF(doc)
    expect(Buffer.isBuffer(result)).toBe(true)
    expect(result.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// healthCheck
// ---------------------------------------------------------------------------

describe('NFeSefazAdapter — healthCheck()', () => {
  it('axios.get ok → retorna true', async () => {
    mockAxiosGet.mockResolvedValueOnce({ status: 200 })

    const adapter = new NFeSefazAdapter()
    const result = await adapter.healthCheck()

    expect(result).toBe(true)
  })

  it('axios.get lança erro → retorna false', async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error('timeout'))

    const adapter = new NFeSefazAdapter()
    const result = await adapter.healthCheck()

    expect(result).toBe(false)
  })
})
