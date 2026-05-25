import { NFeSefazAdapter } from './adapters/nfe-sefaz.adapter.js'
import { NFCeSefazAdapter } from './adapters/nfce-sefaz.adapter.js'
import { NFSePortalNacionalAdapter } from './adapters/nfse-portal-nacional.adapter.js'
// SP — já existentes
import { Prefeitura3550308Adapter } from './adapters/prefeitura-3550308.adapter.js'
// RJ / MG — já existentes
import { Prefeitura3304557Adapter } from './adapters/prefeitura-3304557.adapter.js'
import { Prefeitura3106200Adapter } from './adapters/prefeitura-3106200.adapter.js'
// SP — Betha
import { Prefeitura3518800Adapter } from './adapters/prefeitura-3518800.adapter.js'
import { Prefeitura3543402Adapter } from './adapters/prefeitura-3543402.adapter.js'
import { Prefeitura3513009Adapter } from './adapters/prefeitura-3513009.adapter.js'
import { Prefeitura3503406Adapter } from './adapters/prefeitura-3503406.adapter.js'
import { Prefeitura3515701Adapter } from './adapters/prefeitura-3515701.adapter.js'
import { Prefeitura3552502Adapter } from './adapters/prefeitura-3552502.adapter.js'
import { Prefeitura3530607Adapter } from './adapters/prefeitura-3530607.adapter.js'
import { Prefeitura3539400Adapter } from './adapters/prefeitura-3539400.adapter.js'
import { Prefeitura3523107Adapter } from './adapters/prefeitura-3523107.adapter.js'
import { Prefeitura3546702Adapter } from './adapters/prefeitura-3546702.adapter.js'
import { Prefeitura3547809Adapter } from './adapters/prefeitura-3547809.adapter.js'
import { Prefeitura3505708Adapter } from './adapters/prefeitura-3505708.adapter.js'
import { Prefeitura3548807Adapter } from './adapters/prefeitura-3548807.adapter.js'
// PR / SC — Betha
import { Prefeitura4115200Adapter } from './adapters/prefeitura-4115200.adapter.js'
import { Prefeitura4125506Adapter } from './adapters/prefeitura-4125506.adapter.js'
import { Prefeitura4211405Adapter } from './adapters/prefeitura-4211405.adapter.js'
// Capitais / grandes cidades
import { Prefeitura5208707Adapter } from './adapters/prefeitura-5208707.adapter.js'
import { Prefeitura1501402Adapter } from './adapters/prefeitura-1501402.adapter.js'
import { Prefeitura3170206Adapter } from './adapters/prefeitura-3170206.adapter.js'
import { Prefeitura2611606Adapter } from './adapters/prefeitura-2611606.adapter.js'
import { Prefeitura1721000Adapter } from './adapters/prefeitura-1721000.adapter.js'
import { Prefeitura2304400Adapter } from './adapters/prefeitura-2304400.adapter.js'
import { Prefeitura4314902Adapter } from './adapters/prefeitura-4314902.adapter.js'
import { Prefeitura4113700Adapter } from './adapters/prefeitura-4113700.adapter.js'
import { Prefeitura2927408Adapter } from './adapters/prefeitura-2927408.adapter.js'
import { Prefeitura5108402Adapter } from './adapters/prefeitura-5108402.adapter.js'
import { Prefeitura5300108Adapter } from './adapters/prefeitura-5300108.adapter.js'
import { Prefeitura3205200Adapter } from './adapters/prefeitura-3205200.adapter.js'
import { DocumentoRaw, Periodo, PrefeituraAdapter, Credential } from './interfaces/base.js'
import { parsePeriodo } from '@saas-contabil/shared'

export class ScraperOrchestrator {
  private nfeSefaz = new NFeSefazAdapter()
  private nfceSefaz = new NFCeSefazAdapter()
  private nfsePortalNacional = new NFSePortalNacionalAdapter()

  private prefeituras: Map<string, PrefeituraAdapter> = new Map<string, PrefeituraAdapter>([
    // São Paulo/SP
    ['3550308', new Prefeitura3550308Adapter()],
    // Rio de Janeiro/RJ
    ['3304557', new Prefeitura3304557Adapter()],
    // Belo Horizonte/MG
    ['3106200', new Prefeitura3106200Adapter()],
    // Guarulhos/SP
    ['3518800', new Prefeitura3518800Adapter()],
    // Ribeirão Preto/SP
    ['3543402', new Prefeitura3543402Adapter()],
    // Cotia/SP
    ['3513009', new Prefeitura3513009Adapter()],
    // Arujá/SP
    ['3503406', new Prefeitura3503406Adapter()],
    // Ferraz de Vasconcelos/SP
    ['3515701', new Prefeitura3515701Adapter()],
    // Suzano/SP
    ['3552502', new Prefeitura3552502Adapter()],
    // Mogi das Cruzes/SP
    ['3530607', new Prefeitura3530607Adapter()],
    // Poá/SP
    ['3539400', new Prefeitura3539400Adapter()],
    // Itaquaquecetuba/SP
    ['3523107', new Prefeitura3523107Adapter()],
    // Santa Isabel/SP
    ['3546702', new Prefeitura3546702Adapter()],
    // Santo André/SP
    ['3547809', new Prefeitura3547809Adapter()],
    // Barueri/SP
    ['3505708', new Prefeitura3505708Adapter()],
    // São Caetano do Sul/SP
    ['3548807', new Prefeitura3548807Adapter()],
    // Maringá/PR
    ['4115200', new Prefeitura4115200Adapter()],
    // São José dos Pinhais/PR
    ['4125506', new Prefeitura4125506Adapter()],
    // Navegantes/SC
    ['4211405', new Prefeitura4211405Adapter()],
    // Goiânia/GO
    ['5208707', new Prefeitura5208707Adapter()],
    // Belém/PA
    ['1501402', new Prefeitura1501402Adapter()],
    // Uberlândia/MG
    ['3170206', new Prefeitura3170206Adapter()],
    // Recife/PE
    ['2611606', new Prefeitura2611606Adapter()],
    // Palmas/TO
    ['1721000', new Prefeitura1721000Adapter()],
    // Fortaleza/CE
    ['2304400', new Prefeitura2304400Adapter()],
    // Porto Alegre/RS
    ['4314902', new Prefeitura4314902Adapter()],
    // Londrina/PR
    ['4113700', new Prefeitura4113700Adapter()],
    // Salvador/BA
    ['2927408', new Prefeitura2927408Adapter()],
    // Várzea Grande/MT
    ['5108402', new Prefeitura5108402Adapter()],
    // Distrito Federal/DF
    ['5300108', new Prefeitura5300108Adapter()],
    // Vila Velha/ES
    ['3205200', new Prefeitura3205200Adapter()],
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

    await Promise.all([
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
