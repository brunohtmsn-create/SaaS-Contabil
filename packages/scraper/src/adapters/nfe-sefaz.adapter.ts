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

  private parseResponse(xml: string, cnpj: string): DocumentoRaw[] {
    return []
  }

  async downloadXML(doc: DocumentoRaw): Promise<string> {
    return doc.xmlContent ?? ''
  }

  async downloadPDF(doc: DocumentoRaw): Promise<Buffer> {
    return Buffer.alloc(0)
  }
}
