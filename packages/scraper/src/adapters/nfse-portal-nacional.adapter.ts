import { DocumentAdapter, Session, Credential, DocumentoRaw, Periodo } from '../interfaces/base.js'
import { Decimal } from '@saas-contabil/shared'
import axios from 'axios'

export class NFSePortalNacionalAdapter implements DocumentAdapter {
  tipo = 'NFSE_EMITIDA'
  fonte = 'PORTAL_NACIONAL_NFSE'

  private readonly BASE_URL = 'https://www.nfse.gov.br'
  private session: Session | null = null

  async authenticate(cred: Credential): Promise<Session> {
    this.session = {
      token: 'portal-nacional-token',
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    }
    return this.session
  }

  async fetch(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]> {
    const emitidas = await this.fetchEmitidas(cnpj, periodo)
    const tomadas = await this.fetchTomadas(cnpj, periodo)
    return [...emitidas, ...tomadas]
  }

  async fetchEmitidas(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]> {
    try {
      const response = await axios.get(`${this.BASE_URL}/api/nfse/emitidas`, {
        params: {
          cnpjPrestador: cnpj,
          dataInicio: periodo.inicio.toISOString().split('T')[0],
          dataFim: periodo.fim.toISOString().split('T')[0],
        },
        headers: { Authorization: `Bearer ${this.session?.token}` },
        timeout: 60000,
      })

      return this.mapResponse(response.data, 'NFSE_EMITIDA', cnpj)
    } catch {
      return []
    }
  }

  async fetchTomadas(cnpj: string, periodo: Periodo): Promise<DocumentoRaw[]> {
    try {
      const response = await axios.get(`${this.BASE_URL}/api/nfse/tomadas`, {
        params: {
          cnpjTomador: cnpj,
          dataInicio: periodo.inicio.toISOString().split('T')[0],
          dataFim: periodo.fim.toISOString().split('T')[0],
        },
        headers: { Authorization: `Bearer ${this.session?.token}` },
        timeout: 60000,
      })

      return this.mapResponse(response.data, 'NFSE_TOMADA', cnpj)
    } catch {
      return []
    }
  }

  private mapResponse(data: unknown[], tipo: string, cnpj: string): DocumentoRaw[] {
    if (!Array.isArray(data)) return []

    return data.map((item: any) => ({
      tipo,
      numero: String(item.numero ?? ''),
      dataEmissao: new Date(item.dataEmissao),
      cnpjEmitente: tipo === 'NFSE_EMITIDA' ? cnpj : (item.cnpjPrestador ?? ''),
      nomeEmitente: item.nomePrestador ?? '',
      cnpjDestinatario: tipo === 'NFSE_TOMADA' ? cnpj : (item.cnpjTomador ?? ''),
      valorTotal: new Decimal(item.valorTotal ?? 0),
      municipioIBGE: item.ibgePrestador,
      fonte: 'PORTAL_NACIONAL_NFSE',
      xmlContent: item.xml,
    }))
  }

  async downloadXML(doc: DocumentoRaw): Promise<string> {
    return doc.xmlContent ?? ''
  }

  async downloadPDF(doc: DocumentoRaw): Promise<Buffer> {
    return Buffer.alloc(0)
  }

  async healthCheck(): Promise<boolean> {
    try {
      await axios.get(`${this.BASE_URL}/api/health`, { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }
}
