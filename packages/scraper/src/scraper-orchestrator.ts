import { NFeSefazAdapter } from './adapters/nfe-sefaz.adapter.js'
import { NFCeSefazAdapter } from './adapters/nfce-sefaz.adapter.js'
import { NFSePortalNacionalAdapter } from './adapters/nfse-portal-nacional.adapter.js'
import { Prefeitura3550308Adapter } from './adapters/prefeitura-3550308.adapter.js'
import { Prefeitura3304557Adapter } from './adapters/prefeitura-3304557.adapter.js'
import { Prefeitura3106200Adapter } from './adapters/prefeitura-3106200.adapter.js'
import { DocumentoRaw, Periodo, PrefeituraAdapter, Credential } from './interfaces/base.js'
import { parsePeriodo } from '@saas-contabil/shared'

export class ScraperOrchestrator {
  private nfeSefaz = new NFeSefazAdapter()
  private nfceSefaz = new NFCeSefazAdapter()
  private nfsePortalNacional = new NFSePortalNacionalAdapter()

  private prefeituras: Map<string, PrefeituraAdapter> = new Map<string, PrefeituraAdapter>([
    ['3550308', new Prefeitura3550308Adapter()],
    ['3304557', new Prefeitura3304557Adapter()],
    ['3106200', new Prefeitura3106200Adapter()],
  ])

  async capturarTodos(
    cnpj: string,
    competencia: string,
    credencial: any
  ): Promise<{
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

  async capturarNFSe(
    cnpj: string,
    competencia: string,
    credencial: any
  ): Promise<{
    emitidas: DocumentoRaw[]
    tomadas: DocumentoRaw[]
  }> {
    const periodo = parsePeriodo(competencia)
    await this.nfsePortalNacional.authenticate(credencial)
    const emitidas = await this.nfsePortalNacional.fetchEmitidas(cnpj, periodo)
    const tomadas = await this.nfsePortalNacional.fetchTomadas(cnpj, periodo)
    return { emitidas, tomadas }
  }

  /**
   * Captura NFS-e de uma prefeitura específica pelo código IBGE.
   * Lança erro se o código IBGE não tiver adapter registrado.
   */
  async capturarNFSePrefeitura(
    cnpj: string,
    competencia: string,
    ibge: string,
    credencial: Credential
  ): Promise<{ emitidas: DocumentoRaw[]; tomadas: DocumentoRaw[] }> {
    const adapter = this.prefeituras.get(ibge)
    if (!adapter) {
      throw new Error(
        `ScraperOrchestrator: nenhum adapter registrado para IBGE ${ibge}. ` +
          `Prefeituras disponíveis: ${[...this.prefeituras.keys()].join(', ')}`
      )
    }

    const periodo = parsePeriodo(competencia)
    await adapter.authenticate(credencial)

    const [emitidas, tomadas] = await Promise.allSettled([
      adapter.fetchEmitidas(cnpj, periodo),
      adapter.fetchTomadas(cnpj, periodo),
    ])

    return {
      emitidas: emitidas.status === 'fulfilled' ? emitidas.value : [],
      tomadas: tomadas.status === 'fulfilled' ? tomadas.value : [],
    }
  }

  /**
   * Executa healthCheck em todos os adapters de prefeitura registrados.
   * Retorna um mapa IBGE → boolean indicando disponibilidade do portal.
   */
  async healthCheckPrefeituras(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>()

    await Promise.all(
      [...this.prefeituras.entries()].map(async ([ibge, adapter]) => {
        try {
          results.set(ibge, await adapter.healthCheck())
        } catch {
          results.set(ibge, false)
        }
      })
    )

    return results
  }
}
