import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// Ajuste Anual IRPJ/CSLL — Lucro Real (apuração anual com estimativa mensal)
// Base legal: Lei 9.430/96, arts. 1°-3°; RIR/2018 (Decreto 9.580/2018), arts. 217-221
//
// Fluxo:
//  1. Empresas LR tributadas por estimativa pagam IRPJ+CSLL mensais (código DARF 2362/2484)
//  2. Em 31/12, apuram o lucro real anual (LALUR) e calculam o imposto definitivo
//  3. Comparam: imposto definitivo vs soma das estimativas pagas
//     - Saldo positivo (imposto > estimativas) → DARF complementar, prazo 31/03 do ano seguinte
//     - Saldo negativo (estimativas > imposto) → crédito aproveitável em períodos seguintes ou pedido de restituição
//
// IRPJ: 15% sobre lucro real anual + 10% adicional sobre base > R$240.000/ano
// CSLL: 9% sobre lucro real anual
// Limite adicional anual: R$240.000 (= R$20.000/mês × 12)

const IRPJ_ALIQUOTA = new Decimal('0.15')
const IRPJ_ADICIONAL = new Decimal('0.10')
const CSLL_ALIQUOTA = new Decimal('0.09')
const LIMITE_ADICIONAL_ANUAL = new Decimal('240000')

export type MesEstimativaIRPJ = {
  competencia: string
  irpjPago: Decimal
  csllPago: Decimal
}

export type ResultadoAjusteAnualLR = {
  cnpj: string
  ano: number
  lucroRealAnual: Decimal
  baseIRPJ: Decimal
  baseCSLL: Decimal
  irpjDevido: Decimal
  irpjAdicional: Decimal
  irpjTotal: Decimal
  csllDevida: Decimal
  totalEstimativasIRPJ: Decimal
  totalEstimativasCSLL: Decimal
  saldoIRPJ: Decimal
  saldoCSLL: Decimal
  situacaoIRPJ: 'COMPLEMENTAR' | 'CREDITO' | 'QUITADO'
  situacaoCSLL: 'COMPLEMENTAR' | 'CREDITO' | 'QUITADO'
  prazoComplementar: string
  estimativasPorMes: MesEstimativaIRPJ[]
}

function prazoComplementar(ano: number): string {
  return `${ano + 1}-03-31`
}

export class AjusteAnualLRService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async apurar(
    tenantId: string,
    empresaId: string,
    ano: number,
    lucroRealAnual: Decimal,
    adicoesLALUR: Decimal = new Decimal(0),
    exclusoesLALUR: Decimal = new Decimal(0)
  ): Promise<ResultadoAjusteAnualLR> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_REAL') throw new Error('Ajuste anual somente para Lucro Real')

    const baseIRPJ = Decimal.max(
      new Decimal(0),
      lucroRealAnual.plus(adicoesLALUR).minus(exclusoesLALUR)
    )
    const baseCSLL = Decimal.max(
      new Decimal(0),
      lucroRealAnual.plus(adicoesLALUR).minus(exclusoesLALUR)
    )

    const irpjDevido = baseIRPJ.times(IRPJ_ALIQUOTA).toDecimalPlaces(2)
    const baseAdicional = Decimal.max(new Decimal(0), baseIRPJ.minus(LIMITE_ADICIONAL_ANUAL))
    const irpjAdicional = baseAdicional.times(IRPJ_ADICIONAL).toDecimalPlaces(2)
    const irpjTotal = irpjDevido.plus(irpjAdicional)
    const csllDevida = baseCSLL.times(CSLL_ALIQUOTA).toDecimalPlaces(2)

    // Busca estimativas pagas no ano (competencias YYYY-01 até YYYY-12)
    const anoStr = String(ano)
    const apuracoes = await this.db.apuracaoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        competencia: {
          gte: `${anoStr}-01`,
          lte: `${anoStr}-12`,
        },
        tipo: 'IRPJ_LR',
      },
    })

    const estimativasPorMes: MesEstimativaIRPJ[] = []
    let totalEstimativasIRPJ = new Decimal(0)
    let totalEstimativasCSLL = new Decimal(0)

    for (const ap of apuracoes) {
      const dados = ap.dados as any
      if (dados?.modalidade !== 'ESTIMATIVA') continue

      const irpjPago = new Decimal(dados.irpjTotal ?? dados.irpjDevido ?? '0')
      const csllPago = new Decimal(dados.csllDevida ?? '0')

      estimativasPorMes.push({
        competencia: ap.competencia,
        irpjPago,
        csllPago,
      })
      totalEstimativasIRPJ = totalEstimativasIRPJ.plus(irpjPago)
      totalEstimativasCSLL = totalEstimativasCSLL.plus(csllPago)
    }

    // Saldo: positivo = empresa deve complementar; negativo = crédito a favor
    const saldoIRPJ = irpjTotal.minus(totalEstimativasIRPJ).toDecimalPlaces(2)
    const saldoCSLL = csllDevida.minus(totalEstimativasCSLL).toDecimalPlaces(2)

    const situacaoIRPJ: ResultadoAjusteAnualLR['situacaoIRPJ'] = saldoIRPJ.greaterThan(0)
      ? 'COMPLEMENTAR'
      : saldoIRPJ.lessThan(0)
        ? 'CREDITO'
        : 'QUITADO'

    const situacaoCSLL: ResultadoAjusteAnualLR['situacaoCSLL'] = saldoCSLL.greaterThan(0)
      ? 'COMPLEMENTAR'
      : saldoCSLL.lessThan(0)
        ? 'CREDITO'
        : 'QUITADO'

    const resultado: ResultadoAjusteAnualLR = {
      cnpj: empresa.cnpj,
      ano,
      lucroRealAnual,
      baseIRPJ,
      baseCSLL,
      irpjDevido,
      irpjAdicional,
      irpjTotal,
      csllDevida,
      totalEstimativasIRPJ,
      totalEstimativasCSLL,
      saldoIRPJ,
      saldoCSLL,
      situacaoIRPJ,
      situacaoCSLL,
      prazoComplementar: prazoComplementar(ano),
      estimativasPorMes: estimativasPorMes.sort((a, b) =>
        a.competencia.localeCompare(b.competencia)
      ),
    }

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia: `${anoStr}-12`,
          tipo: 'IRPJ_LR',
        },
      },
      update: {
        dados: {
          tipo: 'AJUSTE_ANUAL_LR',
          irpjTotal: irpjTotal.toString(),
          csllDevida: csllDevida.toString(),
          saldoIRPJ: saldoIRPJ.toString(),
          saldoCSLL: saldoCSLL.toString(),
          situacaoIRPJ,
          situacaoCSLL,
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia: `${anoStr}-12`,
        tipo: 'IRPJ_LR',
        dados: {
          tipo: 'AJUSTE_ANUAL_LR',
          irpjTotal: irpjTotal.toString(),
          csllDevida: csllDevida.toString(),
          saldoIRPJ: saldoIRPJ.toString(),
          saldoCSLL: saldoCSLL.toString(),
          situacaoIRPJ,
          situacaoCSLL,
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
        tipo: 'AJUSTE_ANUAL_LR',
        ano,
        irpjTotal: irpjTotal.toString(),
        csllDevida: csllDevida.toString(),
        situacaoIRPJ,
        situacaoCSLL,
        prazoComplementar: prazoComplementar(ano),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
