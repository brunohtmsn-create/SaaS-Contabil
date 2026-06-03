import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// Compensação de Prejuízos Fiscais — Lucro Real
// Base legal: art. 42 e 58 da Lei 8.981/95, art. 15 da Lei 9.065/95
// Regras:
//   - Prejuízo fiscal (IRPJ) e base negativa CSLL podem ser compensados em períodos futuros
//   - Limite de compensação: 30% do lucro real (ou base CSLL) do período
//   - Não há prazo de validade para compensação (extinção apenas por decadência 5 anos do lançamento)
//   - Prejuízos não-operacionais somente compensam lucros não-operacionais
//   - Controle por competência e saldo acumulado

const LIMITE_COMPENSACAO = new Decimal('0.30') // 30%

export type PrejuizoAcumulado = {
  competencia: string
  prejuizoOriginal: Decimal
  prejuizoCompensado: Decimal
  saldoDisponivel: Decimal
  tipo: 'IRPJ' | 'CSLL'
}

export type ResultadoCompensacaoPrejuizo = {
  cnpj: string
  competencia: string
  lucroRealDoperiodo: Decimal
  baseCSLLdoPeriodo: Decimal
  // IRPJ
  limiteCompensacaoIRPJ: Decimal
  compensacaoIRPJUtilizada: Decimal
  baseIRPJAposCompensacao: Decimal
  // CSLL
  limiteCompensacaoCSLL: Decimal
  compensacaoCSLLUtilizada: Decimal
  baseCSLLAposCompensacao: Decimal
  // Saldos
  saldoPrejuizoIRPJAntes: Decimal
  saldoPrejuizoIRPJDepois: Decimal
  saldoPrejuizoCSLLAntes: Decimal
  saldoPrejuizoCSLLDepois: Decimal
  // Histórico
  prejuizosIRPJ: PrejuizoAcumulado[]
  prejuizosCSLL: PrejuizoAcumulado[]
}

function calcularCompensacao(
  lucro: Decimal,
  prejuizos: PrejuizoAcumulado[]
): { compensada: Decimal; saldoTotal: Decimal; updatedPrejuizos: PrejuizoAcumulado[] } {
  if (lucro.lte(0))
    return {
      compensada: new Decimal(0),
      saldoTotal: prejuizos.reduce((acc, p) => acc.plus(p.saldoDisponivel), new Decimal(0)),
      updatedPrejuizos: prejuizos,
    }

  const limite = lucro.times(LIMITE_COMPENSACAO)
  let restanteParaCompensar = limite
  let totalCompensada = new Decimal(0)

  const updated: PrejuizoAcumulado[] = []

  for (const prej of prejuizos) {
    if (restanteParaCompensar.lte(0)) {
      updated.push({ ...prej })
      continue
    }

    const compensarAgora = Decimal.min(prej.saldoDisponivel, restanteParaCompensar)
    const novoSaldo = prej.saldoDisponivel.minus(compensarAgora)

    updated.push({
      ...prej,
      prejuizoCompensado: prej.prejuizoCompensado.plus(compensarAgora),
      saldoDisponivel: novoSaldo,
    })

    restanteParaCompensar = restanteParaCompensar.minus(compensarAgora)
    totalCompensada = totalCompensada.plus(compensarAgora)
  }

  const saldoTotal = updated.reduce((acc, p) => acc.plus(p.saldoDisponivel), new Decimal(0))

  return { compensada: totalCompensada, saldoTotal, updatedPrejuizos: updated }
}

export class PrejuizosFiscaisLRService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async registrarPrejuizo(
    tenantId: string,
    empresaId: string,
    competencia: string,
    prejuizoIRPJ: Decimal,
    prejuizoCSLL: Decimal
  ): Promise<void> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_REAL')
      throw new Error('Controle de prejuízos fiscais é exclusivo do Lucro Real')

    // Persiste o prejuízo como apuração negativa
    if (prejuizoIRPJ.gt(0)) {
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
            prejuizoIRPJ: prejuizoIRPJ.toString(),
            saldoDisponivel: prejuizoIRPJ.toString(),
            prejuizoCompensado: '0',
            tipo: 'PREJUIZO',
          } as any,
          status: 'CALCULADO',
        },
        create: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'IRPJ_LR',
          dados: {
            prejuizoIRPJ: prejuizoIRPJ.toString(),
            saldoDisponivel: prejuizoIRPJ.toString(),
            prejuizoCompensado: '0',
            tipo: 'PREJUIZO',
          } as any,
          status: 'CALCULADO',
        },
      })
    }

    if (prejuizoCSLL.gt(0)) {
      await this.db.apuracaoFiscal.upsert({
        where: {
          tenantId_empresaId_competencia_tipo: {
            tenantId,
            empresaId,
            competencia,
            tipo: 'CSLL_LR',
          },
        },
        update: {
          dados: {
            prejuizoCSLL: prejuizoCSLL.toString(),
            saldoDisponivel: prejuizoCSLL.toString(),
            prejuizoCompensado: '0',
            tipo: 'PREJUIZO',
          } as any,
          status: 'CALCULADO',
        },
        create: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'CSLL_LR',
          dados: {
            prejuizoCSLL: prejuizoCSLL.toString(),
            saldoDisponivel: prejuizoCSLL.toString(),
            prejuizoCompensado: '0',
            tipo: 'PREJUIZO',
          } as any,
          status: 'CALCULADO',
        },
      })
    }

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'IRPJ_CSLL_LR_APURADO',
      estadoNovo: {
        competencia,
        tipo: 'REGISTRO_PREJUIZO',
        prejuizoIRPJ: prejuizoIRPJ.toString(),
        prejuizoCSLL: prejuizoCSLL.toString(),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })
  }

  async compensar(
    tenantId: string,
    empresaId: string,
    competencia: string,
    lucroRealDoperiodo: Decimal,
    baseCSLLdoPeriodo: Decimal
  ): Promise<ResultadoCompensacaoPrejuizo> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_REAL')
      throw new Error('Compensação de prejuízos é exclusiva do Lucro Real')

    // Busca histórico de prejuízos anteriores persistidos
    const apuracoesIRPJ = await this.db.apuracaoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        tipo: 'IRPJ_LR',
        competencia: { lt: competencia },
        status: 'CALCULADO',
      },
      orderBy: { competencia: 'asc' },
    })

    const apuracoesCSLL = await this.db.apuracaoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        tipo: 'CSLL_LR',
        competencia: { lt: competencia },
        status: 'CALCULADO',
      },
      orderBy: { competencia: 'asc' },
    })

    // Filtra apenas os que têm prejuízo com saldo disponível
    const prejuizosIRPJ: PrejuizoAcumulado[] = apuracoesIRPJ
      .filter(
        (a) =>
          (a.dados as any)?.tipo === 'PREJUIZO' &&
          parseFloat((a.dados as any)?.saldoDisponivel ?? '0') > 0
      )
      .map((a) => ({
        competencia: a.competencia,
        prejuizoOriginal: new Decimal((a.dados as any).prejuizoIRPJ ?? '0'),
        prejuizoCompensado: new Decimal((a.dados as any).prejuizoCompensado ?? '0'),
        saldoDisponivel: new Decimal((a.dados as any).saldoDisponivel ?? '0'),
        tipo: 'IRPJ' as const,
      }))

    const prejuizosCSLL: PrejuizoAcumulado[] = apuracoesCSLL
      .filter(
        (a) =>
          (a.dados as any)?.tipo === 'PREJUIZO' &&
          parseFloat((a.dados as any)?.saldoDisponivel ?? '0') > 0
      )
      .map((a) => ({
        competencia: a.competencia,
        prejuizoOriginal: new Decimal((a.dados as any).prejuizoCSLL ?? '0'),
        prejuizoCompensado: new Decimal((a.dados as any).prejuizoCompensado ?? '0'),
        saldoDisponivel: new Decimal((a.dados as any).saldoDisponivel ?? '0'),
        tipo: 'CSLL' as const,
      }))

    const saldoIRPJAntes = prejuizosIRPJ.reduce((a, p) => a.plus(p.saldoDisponivel), new Decimal(0))
    const saldoCSLLAntes = prejuizosCSLL.reduce((a, p) => a.plus(p.saldoDisponivel), new Decimal(0))

    // Calcula compensação IRPJ
    const limiteIRPJ = lucroRealDoperiodo.gt(0)
      ? lucroRealDoperiodo.times(LIMITE_COMPENSACAO).toDecimalPlaces(2)
      : new Decimal(0)
    const resultIRPJ = calcularCompensacao(lucroRealDoperiodo, prejuizosIRPJ)

    // Calcula compensação CSLL
    const limiteCSLL = baseCSLLdoPeriodo.gt(0)
      ? baseCSLLdoPeriodo.times(LIMITE_COMPENSACAO).toDecimalPlaces(2)
      : new Decimal(0)
    const resultCSLL = calcularCompensacao(baseCSLLdoPeriodo, prejuizosCSLL)

    const baseIRPJAposCompensacao = Decimal.max(
      lucroRealDoperiodo.minus(resultIRPJ.compensada),
      new Decimal(0)
    )
    const baseCSLLAposCompensacao = Decimal.max(
      baseCSLLdoPeriodo.minus(resultCSLL.compensada),
      new Decimal(0)
    )

    const resultado: ResultadoCompensacaoPrejuizo = {
      cnpj: empresa.cnpj,
      competencia,
      lucroRealDoperiodo,
      baseCSLLdoPeriodo,
      limiteCompensacaoIRPJ: limiteIRPJ,
      compensacaoIRPJUtilizada: resultIRPJ.compensada,
      baseIRPJAposCompensacao,
      limiteCompensacaoCSLL: limiteCSLL,
      compensacaoCSLLUtilizada: resultCSLL.compensada,
      baseCSLLAposCompensacao,
      saldoPrejuizoIRPJAntes: saldoIRPJAntes,
      saldoPrejuizoIRPJDepois: resultIRPJ.saldoTotal,
      saldoPrejuizoCSLLAntes: saldoCSLLAntes,
      saldoPrejuizoCSLLDepois: resultCSLL.saldoTotal,
      prejuizosIRPJ: resultIRPJ.updatedPrejuizos,
      prejuizosCSLL: resultCSLL.updatedPrejuizos,
    }

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'IRPJ_CSLL_LR_APURADO',
      estadoNovo: {
        competencia,
        tipo: 'COMPENSACAO_PREJUIZO',
        compensacaoIRPJUtilizada: resultIRPJ.compensada.toString(),
        compensacaoCSLLUtilizada: resultCSLL.compensada.toString(),
        saldoIRPJRestante: resultIRPJ.saldoTotal.toString(),
        saldoCSLLRestante: resultCSLL.saldoTotal.toString(),
        baseIRPJAposCompensacao: baseIRPJAposCompensacao.toString(),
        baseCSLLAposCompensacao: baseCSLLAposCompensacao.toString(),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
