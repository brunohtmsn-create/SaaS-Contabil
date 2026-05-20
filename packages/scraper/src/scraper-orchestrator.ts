import { NFeSefazAdapter } from './adapters/nfe-sefaz.adapter.js'
import { NFCeSefazAdapter } from './adapters/nfce-sefaz.adapter.js'
import { NFSePortalNacionalAdapter } from './adapters/nfse-portal-nacional.adapter.js'
import { DocumentoRaw, Periodo } from './interfaces/base.js'
import { parsePeriodo } from '@saas-contabil/shared'

export class ScraperOrchestrator {
  private nfeSefaz = new NFeSefazAdapter()
  private nfceSefaz = new NFCeSefazAdapter()
  private nfsePortalNacional = new NFSePortalNacionalAdapter()

  async capturarTodos(cnpj: string, competencia: string, credencial: any): Promise<{
    nfe: DocumentoRaw[]
    nfce: DocumentoRaw[]
    nfseEmitidas: DocumentoRaw[]
    nfseTomadas: DocumentoRaw[]
  }> {
    const periodo = parsePeriodo(competencia)

    const [nfeSession, nfceSession, nfseSession] = await Promise.all([
      this.nfeSefaz.authenticate(credencial),
      this.nfceSefaz.authenticate(credencial),
      this.nfsePortalNacional.authenticate(credencial),
    ])

    const [nfe, nfce, nfseAll] = await Promise.allSettled([
      this.nfeSefaz.fetch(cnpj, periodo),
      this.nfceSefaz.fetch(cnpj, periodo),
      this.nfsePortalNacional.fetch(cnpj, periodo),
    ])

    const nfseResults = nfseAll.status === 'fulfilled' ? nfseAll.value : []

    return {
      nfe: nfe.status === 'fulfilled' ? nfe.value : [],
      nfce: nfce.status === 'fulfilled' ? nfce.value : [],
      nfseEmitidas: nfseResults.filter((d) => d.tipo === 'NFSE_EMITIDA'),
      nfseTomadas: nfseResults.filter((d) => d.tipo === 'NFSE_TOMADA'),
    }
  }

  async capturarNFe(cnpj: string, competencia: string, credencial: any): Promise<DocumentoRaw[]> {
    const periodo = parsePeriodo(competencia)
    await this.nfeSefaz.authenticate(credencial)
    return this.nfeSefaz.fetch(cnpj, periodo)
  }

  async capturarNFCe(cnpj: string, competencia: string, credencial: any): Promise<DocumentoRaw[]> {
    const periodo = parsePeriodo(competencia)
    await this.nfceSefaz.authenticate(credencial)
    return this.nfceSefaz.fetch(cnpj, periodo)
  }

  async capturarNFSe(cnpj: string, competencia: string, credencial: any): Promise<{
    emitidas: DocumentoRaw[]
    tomadas: DocumentoRaw[]
  }> {
    const periodo = parsePeriodo(competencia)
    await this.nfsePortalNacional.authenticate(credencial)
    const emitidas = await this.nfsePortalNacional.fetchEmitidas(cnpj, periodo)
    const tomadas = await this.nfsePortalNacional.fetchTomadas(cnpj, periodo)
    return { emitidas, tomadas }
  }
}
