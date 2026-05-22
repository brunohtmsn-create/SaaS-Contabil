import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo, TABELA_SIMPLES_NACIONAL, LIMITES_SIMPLES_NACIONAL, competencias12Meses } from '@saas-contabil/shared'
import type { ReceitaSegregada, ResultadoPGDAS } from './types.js'
import { FatorRService } from './fator-r.service.js'

export class PGDASService {
  private db = getPrismaClient()
  private audit = new AuditService()
  private fatorR = new FatorRService()

  async apurar(tenantId: string, empresaId: string, competencia: string): Promise<ResultadoPGDAS> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'SIMPLES_NACIONAL') throw new Error('Empresa não é do Simples Nacional')

    const { inicio, fim } = parsePeriodo(competencia)

    const docs = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: 'CONCILIADO',
        tipo: { in: ['NFE', 'NFCE', 'NFSE_EMITIDA'] },
        direcao: { in: ['SAIDA', 'PRESTACAO'] },
      },
    })

    const receitas = this.segregarReceitas(docs, empresa.cnpj, competencia)

    const [rb12, { fatorR }] = await Promise.all([
      this.calcularRB12Meses(tenantId, empresaId, competencia),
      this.fatorR.calcular(tenantId, empresaId, competencia),
    ])

    const anexoPrincipal = this.determinarAnexoPrincipal(receitas, fatorR)
    const faixa = this.buscarFaixa(rb12, anexoPrincipal)

    const aliquotaEfetiva = faixa
      ? receitas.total.gt(0)
        ? faixa.aliquota.div(100).times(receitas.total).minus(faixa.deducao).div(receitas.total)
        : new Decimal(0)
      : new Decimal(0)

    const valorDAS = receitas.total.times(aliquotaEfetiva).toDecimalPlaces(2)

    const resultado: ResultadoPGDAS = {
      cnpj: empresa.cnpj,
      competencia,
      receitaBrutaTotal: receitas.total,
      receitaBruta12Meses: rb12,
      faixaAnexo: `${anexoPrincipal}`,
      aliquotaNominal: faixa?.aliquota ?? new Decimal(0),
      deducao: faixa?.deducao ?? new Decimal(0),
      aliquotaEfetiva: aliquotaEfetiva.times(100).toDecimalPlaces(4),
      valorDAS,
      receitas,
      fatorR,
    }

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'PGDAS',
        },
      },
      update: { dados: resultado as any, status: 'CALCULADO' },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'PGDAS',
        dados: resultado as any,
        status: 'CALCULADO',
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL',
      entidadeId: empresaId,
      evento: 'PGDAS_APURADO',
      estadoNovo: resultado,
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    await this.verificarSublimites(tenantId, empresaId, empresa.cnpj, rb12)

    return resultado
  }

  private segregarReceitas(docs: any[], cnpj: string, competencia: string): ReceitaSegregada {
    let anexoI = new Decimal(0)
    let anexoIII = new Decimal(0)
    let anexoV = new Decimal(0)

    for (const doc of docs) {
      const valor = new Decimal(doc.valorTotal.toString())
      if (doc.tipo === 'NFCE' || (doc.tipo === 'NFE' && doc.cfop?.startsWith('5'))) {
        anexoI = anexoI.plus(valor)
      } else if (doc.tipo === 'NFSE_EMITIDA') {
        anexoIII = anexoIII.plus(valor)
      }
    }

    return {
      cnpj,
      competencia,
      anexoI,
      anexoII: new Decimal(0),
      anexoIII,
      anexoIV: new Decimal(0),
      anexoV,
      exportacao: new Decimal(0),
      substituicaoTributaria: new Decimal(0),
      imunes: new Decimal(0),
      isentas: new Decimal(0),
      total: anexoI.plus(anexoIII).plus(anexoV),
    }
  }

  private async calcularRB12Meses(tenantId: string, empresaId: string, competencia: string): Promise<Decimal> {
    const competencias = competencias12Meses(competencia)
    const primeiro = competencias[0]
    const { inicio } = parsePeriodo(primeiro ?? competencia)
    const { fim } = parsePeriodo(competencia)

    const result = await this.db.documentoFiscal.aggregate({
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

    return new Decimal(result._sum.valorTotal?.toString() ?? '0')
  }

  private determinarAnexoPrincipal(receitas: ReceitaSegregada, fatorR: Decimal): string {
    if (receitas.anexoI.gt(receitas.anexoIII) && receitas.anexoI.gt(receitas.anexoV)) {
      return 'ANEXO_I'
    }
    if (fatorR.gte(28)) return 'ANEXO_III'
    return 'ANEXO_V'
  }

  private buscarFaixa(rb12: Decimal, anexo: string) {
    const tabela = TABELA_SIMPLES_NACIONAL[anexo as keyof typeof TABELA_SIMPLES_NACIONAL]
    if (!tabela) return null
    return tabela.find((f) => rb12.gte(f.limiteInferior) && rb12.lte(f.limiteSuperior))
  }

  private async verificarSublimites(tenantId: string, empresaId: string, cnpj: string, rb12: Decimal): Promise<void> {
    if (rb12.gte(LIMITES_SIMPLES_NACIONAL.alertaPreventivo)) {
      await this.db.alerta.create({
        data: {
          tenantId,
          empresaId,
          tipo: rb12.gte(LIMITES_SIMPLES_NACIONAL.limiteExclusao) ? 'RISCO_EXCLUSAO_SN' : 'SUBLIMITE_ESTADUAL',
          mensagem: `Receita bruta 12 meses: R$ ${rb12.toFixed(2)} — ${rb12.gte(LIMITES_SIMPLES_NACIONAL.limiteExclusao) ? 'RISCO DE EXCLUSÃO DO SIMPLES' : 'Atenção ao sublimite estadual'}`,
          dados: { rb12: rb12.toFixed(2), cnpj },
        },
      })
    }
  }
}
