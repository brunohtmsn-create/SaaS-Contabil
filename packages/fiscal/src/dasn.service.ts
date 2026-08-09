import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo } from '@saas-contabil/shared'

export interface ReceitaMensalDasn {
  competencia: string
  receita: string
  pgdasCalculado: boolean
}

export interface ResultadoDasn {
  cnpj: string
  ano: number
  receitaMensal: ReceitaMensalDasn[]
  receitaAnualTotal: string
  mesesComPGDAS: number
  mesesCompletos: boolean
  obrigacaoId: string | null
  vencimento: string
}

export class DasnService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async gerar(tenantId: string, empresaId: string, ano: number): Promise<ResultadoDasn> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'SIMPLES_NACIONAL' && empresa.regime !== 'MEI') {
      throw new Error(`DASN não aplicável — regime: ${empresa.regime}`)
    }

    const competencias = Array.from({ length: 12 }, (_, i) => {
      const mes = String(i + 1).padStart(2, '0')
      return `${ano}-${mes}`
    })

    const apuracoes = await this.db.apuracaoFiscal.findMany({
      where: { tenantId, empresaId, tipo: 'PGDAS', competencia: { in: competencias } },
      select: { competencia: true },
    })
    const pgdasCalculados = new Set(apuracoes.map((a) => a.competencia))

    const receitaMensal: ReceitaMensalDasn[] = []
    let receitaAnualTotal = new Decimal(0)

    for (const competencia of competencias) {
      const { inicio, fim } = parsePeriodo(competencia)

      const agg = await this.db.documentoFiscal.aggregate({
        where: {
          tenantId,
          empresaId,
          dataCompetencia: { gte: inicio, lte: fim },
          status: 'CONCILIADO',
          tipo: { in: ['NFE', 'NFCE', 'NFSE_EMITIDA'] },
          direcao: { in: ['SAIDA', 'PRESTACAO'] },
        },
        _sum: { valorTotal: true },
      })

      const receita = new Decimal(agg._sum.valorTotal?.toString() ?? '0')
      receitaAnualTotal = receitaAnualTotal.plus(receita)
      receitaMensal.push({
        competencia,
        receita: receita.toFixed(2),
        pgdasCalculado: pgdasCalculados.has(competencia),
      })
    }

    const mesesComPGDAS = receitaMensal.filter((m) => m.pgdasCalculado).length
    const mesesCompletos = mesesComPGDAS === 12

    // Vencimento: 31 de março do ano seguinte — UTC 12h para representar SP corretamente
    const vencimento = new Date(Date.UTC(ano + 1, 2, 31, 12, 0, 0))

    const obrigacaoExistente = await this.db.obrigacao.findFirst({
      where: { tenantId, empresaId, tipo: 'DASN', competencia: String(ano) },
    })

    let obrigacaoId: string
    if (obrigacaoExistente) {
      obrigacaoId = obrigacaoExistente.id
    } else {
      const obrigacao = await this.db.obrigacao.create({
        data: {
          tenantId,
          empresaId,
          tipo: 'DASN',
          competencia: String(ano),
          vencimento,
          status: 'PENDENTE',
        },
      })
      obrigacaoId = obrigacao.id
    }

    const resultado: ResultadoDasn = {
      cnpj: empresa.cnpj,
      ano,
      receitaMensal,
      receitaAnualTotal: receitaAnualTotal.toFixed(2),
      mesesComPGDAS,
      mesesCompletos,
      obrigacaoId,
      vencimento: vencimento.toISOString(),
    }

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'OBRIGACAO',
      entidadeId: obrigacaoId,
      evento: 'DASN_GERADA',
      estadoNovo: {
        ano,
        mesesComPGDAS,
        mesesCompletos,
        receitaAnualTotal: resultado.receitaAnualTotal,
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
