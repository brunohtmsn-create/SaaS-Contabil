import { gunzipSync } from 'zlib'
import { BasePLaywrightAdapter } from './base-playwright.adapter.js'
import { Session, Credential, DocumentoRaw, Periodo } from '../interfaces/base.js'
import { Decimal } from '@saas-contabil/shared'
import axios from 'axios'

export class NFeSefazAdapter extends BasePLaywrightAdapter {
  tipo = 'NFE'
  fonte = 'SEFAZ_FEDERAL'

  private readonly SEFAZ_URL = 'https://www.nfe.fazenda.gov.br'
  private readonly WS_URL =
    'https://www.nfe.fazenda.gov.br/NfeDistribuicaoDFe/NfeDistribuicaoDFe.asmx'

  async authenticate(cred: Credential): Promise<Session> {
    return {
      token: 'cert-auth',
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    }
  }

  async fetch(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]> {
    return this.withRetry(async () => {
      const docs: DocumentoRaw[] = []

      const envelope = this.buildDistribuicaoEnvelope(cnpj, periodo)

      try {
        const response = await axios.post(this.WS_URL, envelope, {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction:
              'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse',
          },
          timeout: 60000,
        })

        docs.push(...this.parseResponse(response.data, cnpj))
      } catch (err) {
        console.error('[NFeSefaz] Erro ao buscar NF-e:', err)
        throw err
      }

      return docs
    })
  }

  private buildDistribuicaoEnvelope(cnpj: string, periodo: Periodo): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Header>
    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <cUF>35</cUF>
      <versaoDados>1.01</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>1</tpAmb>
          <cUFAutor>35</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU>
            <ultNSU>000000000000000</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`
  }

  async downloadXML(doc: DocumentoRaw): Promise<string> {
    return doc.xmlContent ?? ''
  }

  async downloadPDF(doc: DocumentoRaw): Promise<Buffer> {
    return Buffer.alloc(0)
  }

  async healthCheck(): Promise<boolean> {
    try {
      await axios.get(this.SEFAZ_URL, { timeout: 10000 })
      return true
    } catch {
      return false
    }
  }

  // ─── Parsing SOAP / NF-e ──────────────────────────────────────────────────

  private parseResponse(xml: string, cnpj: string): DocumentoRaw[] {
    const cStatMatch = xml.match(/<cStat>(\d+)<\/cStat>/)
    const cStat = cStatMatch ? Number(cStatMatch[1]) : 0

    // 137 = "Documento(s) localizado(s)", 138 = same for different query type
    if (![137, 138].includes(cStat)) return []

    const docs: DocumentoRaw[] = []
    const docZipRegex = /<docZip[^>]*>([^<]+)<\/docZip>/g
    let match: RegExpExecArray | null

    while ((match = docZipRegex.exec(xml)) !== null) {
      const base64Content = match[1]!.trim().replace(/\s/g, '')
      try {
        const compressed = Buffer.from(base64Content, 'base64')
        const xmlContent = gunzipSync(compressed).toString('utf8')
        const doc = this.parseNFeXML(xmlContent, cnpj)
        if (doc) docs.push(doc)
      } catch (err) {
        console.error('[NFeSefaz] Erro ao decodificar docZip:', err)
      }
    }

    return docs
  }

  private parseNFeXML(xml: string, cnpjPrincipal: string): DocumentoRaw | null {
    // Chave de acesso: 44 dígitos no atributo Id ou em <chNFe>
    const chaveAttrMatch = xml.match(/Id="NFe(\d{44})"/)
    const chaveTagMatch = xml.match(/<chNFe>(\d{44})<\/chNFe>/)
    const chaveAcesso = chaveAttrMatch
      ? chaveAttrMatch[1]
      : chaveTagMatch
        ? chaveTagMatch[1]
        : undefined

    const nNumMatch = xml.match(/<nNF>(\d+)<\/nNF>/)
    const numero = nNumMatch ? nNumMatch[1]! : ''

    const serieMatch = xml.match(/<serie>(\d+)<\/serie>/)
    const serie = serieMatch ? serieMatch[1] : undefined

    const dhEmiMatch = xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)
    const dataEmissao = dhEmiMatch ? new Date(dhEmiMatch[1]!) : new Date()

    const emitBlock = xml.match(/<emit>([\s\S]*?)<\/emit>/)
    let cnpjEmitente = ''
    let nomeEmitente = ''
    if (emitBlock) {
      const cnpjEmit = emitBlock[1]!.match(/<CNPJ>(\d{14})<\/CNPJ>/)
      const nomeEmit = emitBlock[1]!.match(/<xNome>([^<]+)<\/xNome>/)
      cnpjEmitente = cnpjEmit ? cnpjEmit[1]! : ''
      nomeEmitente = nomeEmit ? nomeEmit[1]! : ''
    }

    const destBlock = xml.match(/<dest>([\s\S]*?)<\/dest>/)
    let cnpjDestinatario = ''
    if (destBlock) {
      const cnpjDest = destBlock[1]!.match(/<CNPJ>(\d{14})<\/CNPJ>/)
      cnpjDestinatario = cnpjDest ? cnpjDest[1]! : ''
    }
    if (!cnpjDestinatario) cnpjDestinatario = cnpjPrincipal

    const vNFMatch = xml.match(/<vNF>([^<]+)<\/vNF>/)
    const valorTotal = new Decimal(vNFMatch ? vNFMatch[1]!.trim() : '0')

    if (!numero && !chaveAcesso) return null

    return {
      tipo: 'NFE',
      ...(chaveAcesso !== undefined ? { chaveAcesso } : {}),
      numero,
      ...(serie !== undefined ? { serie } : {}),
      dataEmissao,
      cnpjEmitente,
      nomeEmitente,
      cnpjDestinatario,
      valorTotal,
      xmlContent: xml,
      fonte: 'SEFAZ_FEDERAL',
    }
  }
}
