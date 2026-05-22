import { BasePLaywrightAdapter } from './base-playwright.adapter.js'
import { Session, Credential, DocumentoRaw, Periodo } from '../interfaces/base.js'
import { Decimal } from '@saas-contabil/shared'

export class NFCeSefazAdapter extends BasePLaywrightAdapter {
  tipo = 'NFCE'
  fonte = 'SEFAZ_FEDERAL'

  async authenticate(cred: Credential): Promise<Session> {
    return {
      token: 'cert-auth',
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    }
  }

  async fetch(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]> {
    return this.withRetry(async () => {
      return this.withPage(async (page) => {
        await page.goto('https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx', {
          timeout: 30000,
          waitUntil: 'networkidle',
        })

        const docs: DocumentoRaw[] = []
        return docs
      })
    })
  }

  async downloadXML(doc: DocumentoRaw): Promise<string> {
    return doc.xmlContent ?? ''
  }

  async downloadPDF(doc: DocumentoRaw): Promise<Buffer> {
    return Buffer.alloc(0)
  }
}
