import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo } from '@saas-contabil/shared'

// Alíquota padrão de ISS quando não há configuração municipal específica (2%)
const ALIQUOTA_ISS_PADRAO = new Decimal('0.02')

export type MunicipioISS = {
  municipioIBGE: string
  totalServicos: Decimal
  aliquotaISS: Decimal
  totalISS: Decimal
  nfseIds: string[]
}

export type ResultadoDMS = {
  competencia: string
  cnpj: string
  totalNFSe: number
  totalServicos: Decimal
  totalISS: Decimal
  porMunicipio: MunicipioISS[]
}

/**
 * DMS — Declaração Mensal de Serviços (ISS Municipal).
 *
 * Agrega NFSe emitidas CONCILIADAS do período, calcula ISS por município
 * e registra a obrigação DMS. Para Simples Nacional, o ISS está incluído
 * no DAS, mas muitos municípios exigem a entrega da DMS independentemente.
 *
 * Regra: usa SOMENTE NFSe com status CONCILIADO (analogia à regra do DIFAL
 * e PGDAS do CLAUDE.md §10/§11).
 */
export class DMSService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async apurar(tenantId: string, empresaId: string, competencia: string): Promise<ResultadoDMS> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const { inicio, fim } = parsePeriodo(competencia)

    // Busca NFSe emitidas CONCILIADAS no período (não PENDENTE, não NORMALIZADO)
    const nfse = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        tipo: 'NFSE_EMITIDA',
        status: 'CONCILIADO',
        dataCompetencia: { gte: inicio, lte: fim },
      },
    })

    if (nfse.length === 0) {
      return {
        competencia,
        cnpj: empresa.cnpj,
        totalNFSe: 0,
        totalServicos: new Decimal(0),
        totalISS: new Decimal(0),
        porMunicipio: [],
      }
    }

    // Agrupa por município IBGE do prestador
    const porMunicipio = new Map<string, { total: Decimal; ids: string[] }>()

    for (const doc of nfse) {
      const ibge = (doc.dadosAdicionais as any)?.municipioIBGE ?? 'DESCONHECIDO'
      const valor = new Decimal(doc.valorTotal?.toString() ?? '0')

      const atual = porMunicipio.get(ibge) ?? { total: new Decimal(0), ids: [] }
      porMunicipio.set(ibge, {
        total: atual.total.plus(valor),
        ids: [...atual.ids, doc.id],
      })
    }

    // Calcula ISS por município
    const municipios: MunicipioISS[] = []
    let totalServicos = new Decimal(0)
    let totalISS = new Decimal(0)

    for (const [ibge, dados] of porMunicipio) {
      const aliquota = await this.buscarAliquotaISS(tenantId, ibge)
      const iss = dados.total.times(aliquota).toDecimalPlaces(2)

      totalServicos = totalServicos.plus(dados.total)
      totalISS = totalISS.plus(iss)

      municipios.push({
        municipioIBGE: ibge,
        totalServicos: dados.total,
        aliquotaISS: aliquota,
        totalISS: iss,
        nfseIds: dados.ids,
      })
    }

    // Cria obrigação DMS (se não existir)
    const obrigacaoExistente = await this.db.obrigacao.findFirst({
      where: { tenantId, empresaId, tipo: 'DMS', competencia },
    })

    if (!obrigacaoExistente) {
      const [ano, mes] = competencia.split('-').map(Number) as [number, number]
      // DMS vence geralmente no dia 10 do mês seguinte
      const vencimento = new Date(ano, mes, 10)

      await this.db.obrigacao.create({
        data: {
          tenantId,
          empresaId,
          tipo: 'DMS',
          competencia,
          vencimento,
          status: 'PENDENTE',
          valor: totalISS.toFixed(2),
          dados: {
            totalNFSe: nfse.length,
            totalServicos: totalServicos.toFixed(2),
            totalISS: totalISS.toFixed(2),
            porMunicipio: municipios.map((m) => ({
              municipioIBGE: m.municipioIBGE,
              totalServicos: m.totalServicos.toFixed(2),
              aliquotaISS: m.aliquotaISS.toFixed(4),
              totalISS: m.totalISS.toFixed(2),
            })),
          },
        },
      })
    }

    const resultado: ResultadoDMS = {
      competencia,
      cnpj: empresa.cnpj,
      totalNFSe: nfse.length,
      totalServicos,
      totalISS,
      porMunicipio: municipios,
    }

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'OBRIGACAO',
      entidadeId: empresaId,
      evento: 'DMS_APURADA',
      estadoNovo: {
        competencia,
        totalNFSe: nfse.length,
        totalServicos: totalServicos.toFixed(2),
        totalISS: totalISS.toFixed(2),
        municipios: municipios.length,
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }

  /**
   * Busca a alíquota de ISS configurada para o município.
   * Fallback para 2% caso não haja configuração específica.
   */
  private async buscarAliquotaISS(tenantId: string, municipioIBGE: string): Promise<Decimal> {
    // Busca configuração de alíquota salva como alerta do tipo CONFIGURACAO_ISS
    // (padrão provisório até ter tabela dedicada de configurações municipais)
    const config = await this.db.alerta.findFirst({
      where: {
        tenantId,
        tipo: 'CONFIGURACAO_ISS',
        dados: { path: ['municipioIBGE'], equals: municipioIBGE },
      },
    })

    if (config) {
      const dados = config.dados as any
      return new Decimal(dados.aliquota ?? '0.02')
    }

    return ALIQUOTA_ISS_PADRAO
  }
}
