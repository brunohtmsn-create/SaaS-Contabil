import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// LALUR / LACS — Livro de Apuração do Lucro Real / Contribuição Social sobre o Lucro
// Base legal: RIR/2018 (Decreto 9.580/2018), arts. 175–221; IN RFB 1.422/2013 (ECF)
//
// Estrutura do LALUR (Parte A e Parte B):
//  Parte A — lançamentos de ajuste ao lucro líquido:
//    - Adições (despesas não dedutíveis, provisões não permitidas etc.)
//    - Exclusões (receitas não tributáveis, incentivos fiscais etc.)
//    - Compensações de prejuízos fiscais (limitado a 30% do lucro antes da compensação)
//  Parte B — controle de valores sem reflexo imediato na apuração:
//    - Prejuízos a compensar
//    - Diferenças temporárias (deprec. acelerada, provisões dedutíveis futuramente)
//
// Saída: lucro real = lucroLiquido + totalAdicoes - totalExclusoes - totalCompensacoes

export type ItemAdicao = {
  descricao: string
  codigoECF?: string
  valor: Decimal
}

export type ItemExclusao = {
  descricao: string
  codigoECF?: string
  valor: Decimal
}

export type ItemCompensacao = {
  competenciaOrigem: string
  valorDisponivel: Decimal
  valorUtilizado: Decimal
}

export type ResultadoLALUR = {
  cnpj: string
  competencia: string
  lucroLiquidoAntesCSTLL: Decimal
  adicoes: ItemAdicao[]
  exclusoes: ItemExclusao[]
  compensacoes: ItemCompensacao[]
  totalAdicoes: Decimal
  totalExclusoes: Decimal
  totalCompensacoes: Decimal
  lucroReal: Decimal
  baseCSLL: Decimal
  limiteCompensacao: Decimal
  saldoPrejuizosRemanescentes: Decimal
}

const LIMITE_COMPENSACAO_PERC = new Decimal('0.30')

export class LALURService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async apurar(
    tenantId: string,
    empresaId: string,
    competencia: string,
    lucroLiquido: Decimal,
    adicoes: ItemAdicao[] = [],
    exclusoes: ItemExclusao[] = []
  ): Promise<ResultadoLALUR> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_REAL') throw new Error('LALUR somente para Lucro Real')

    const totalAdicoes = adicoes.reduce((acc, item) => acc.plus(item.valor), new Decimal(0))
    const totalExclusoes = exclusoes.reduce((acc, item) => acc.plus(item.valor), new Decimal(0))

    // Lucro ajustado antes da compensação de prejuízos
    const lucroAjustado = lucroLiquido.plus(totalAdicoes).minus(totalExclusoes)

    // Busca prejuízos acumulados disponíveis para compensação
    const prejuizosDb = await this.db.apuracaoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        tipo: 'IRPJ_LR',
        dados: { path: ['tipo'], equals: 'PREJUIZO' },
      },
      orderBy: { competencia: 'asc' }, // FIFO
    })

    // Limite de compensação = 30% do lucro ajustado (antes da compensação)
    const limiteCompensacao = Decimal.max(
      new Decimal(0),
      lucroAjustado.times(LIMITE_COMPENSACAO_PERC).toDecimalPlaces(2)
    )

    const compensacoes: ItemCompensacao[] = []
    let totalCompensacoes = new Decimal(0)
    let saldoRemanescente = new Decimal(0)

    if (lucroAjustado.greaterThan(0)) {
      let limiteRestante = limiteCompensacao

      for (const ap of prejuizosDb) {
        if (limiteRestante.lessThanOrEqualTo(0)) break

        const dados = ap.dados as any
        const disponivel = new Decimal(dados.saldoRemanescente ?? dados.valorPrejuizo ?? '0')
        if (disponivel.lessThanOrEqualTo(0)) continue

        const utilizado = Decimal.min(disponivel, limiteRestante).toDecimalPlaces(2)
        compensacoes.push({
          competenciaOrigem: ap.competencia,
          valorDisponivel: disponivel,
          valorUtilizado: utilizado,
        })

        totalCompensacoes = totalCompensacoes.plus(utilizado)
        limiteRestante = limiteRestante.minus(utilizado)
      }

      // Saldo de prejuízos remanescentes = total disponível - total utilizado
      for (const ap of prejuizosDb) {
        const dados = ap.dados as any
        const disponivel = new Decimal(dados.saldoRemanescente ?? dados.valorPrejuizo ?? '0')
        const comp = compensacoes.find((c) => c.competenciaOrigem === ap.competencia)
        const utilizado = comp ? comp.valorUtilizado : new Decimal(0)
        saldoRemanescente = saldoRemanescente.plus(disponivel.minus(utilizado))
      }
    } else {
      for (const ap of prejuizosDb) {
        const dados = ap.dados as any
        saldoRemanescente = saldoRemanescente.plus(
          new Decimal(dados.saldoRemanescente ?? dados.valorPrejuizo ?? '0')
        )
      }
    }

    const lucroReal = Decimal.max(
      new Decimal(0),
      lucroAjustado.minus(totalCompensacoes).toDecimalPlaces(2)
    )
    const baseCSLL = lucroReal

    const resultado: ResultadoLALUR = {
      cnpj: empresa.cnpj,
      competencia,
      lucroLiquidoAntesCSTLL: lucroLiquido,
      adicoes,
      exclusoes,
      compensacoes,
      totalAdicoes,
      totalExclusoes,
      totalCompensacoes,
      lucroReal,
      baseCSLL,
      limiteCompensacao,
      saldoPrejuizosRemanescentes: saldoRemanescente,
    }

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'IRPJ_LR',
        },
      },
      update: {
        dados: {
          tipo: 'LALUR',
          lucroLiquido: lucroLiquido.toString(),
          totalAdicoes: totalAdicoes.toString(),
          totalExclusoes: totalExclusoes.toString(),
          totalCompensacoes: totalCompensacoes.toString(),
          lucroReal: lucroReal.toString(),
          baseCSLL: baseCSLL.toString(),
          adicoes: adicoes.map((a) => ({ ...a, valor: a.valor.toString() })),
          exclusoes: exclusoes.map((e) => ({ ...e, valor: e.valor.toString() })),
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'IRPJ_LR',
        dados: {
          tipo: 'LALUR',
          lucroLiquido: lucroLiquido.toString(),
          totalAdicoes: totalAdicoes.toString(),
          totalExclusoes: totalExclusoes.toString(),
          totalCompensacoes: totalCompensacoes.toString(),
          lucroReal: lucroReal.toString(),
          baseCSLL: baseCSLL.toString(),
          adicoes: adicoes.map((a) => ({ ...a, valor: a.valor.toString() })),
          exclusoes: exclusoes.map((e) => ({ ...e, valor: e.valor.toString() })),
        } as any,
        status: 'CALCULADO',
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'IRPJ_CSLL_LR_APURADO',
      estadoNovo: {
        tipo: 'LALUR',
        competencia,
        lucroReal: lucroReal.toString(),
        totalAdicoes: totalAdicoes.toString(),
        totalExclusoes: totalExclusoes.toString(),
        totalCompensacoes: totalCompensacoes.toString(),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
