import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// IRPJ e CSLL — Lucro Real
// Base legal: RIR/2018 (Decreto 9.580/2018), Lei 9.430/96
// Apuração trimestral (padrão) ou anual com estimativa mensal
// IRPJ: 15% sobre o lucro real + 10% adicional sobre base > R$60.000/trimestre
// CSLL: 9% sobre o lucro real (base = lucro contábil ajustado pelas adições e exclusões)
// Diferente do LP: não há percentual de presunção — a base é o lucro contábil ajustado

function trimestDeCompetencia(competencia: string): {
  trimestreLabel: string
  inicio: Date
  fim: Date
  numero: 1 | 2 | 3 | 4
} {
  const [anoStr, mesStr] = competencia.split('-')
  const ano = parseInt(anoStr!, 10)
  const mes = parseInt(mesStr!, 10)

  if (mes >= 1 && mes <= 3)
    return {
      trimestreLabel: `${ano}-T1`,
      inicio: new Date(ano, 0, 1),
      fim: new Date(ano, 2, 31),
      numero: 1,
    }
  if (mes >= 4 && mes <= 6)
    return {
      trimestreLabel: `${ano}-T2`,
      inicio: new Date(ano, 3, 1),
      fim: new Date(ano, 5, 30),
      numero: 2,
    }
  if (mes >= 7 && mes <= 9)
    return {
      trimestreLabel: `${ano}-T3`,
      inicio: new Date(ano, 6, 1),
      fim: new Date(ano, 8, 30),
      numero: 3,
    }
  return {
    trimestreLabel: `${ano}-T4`,
    inicio: new Date(ano, 9, 1),
    fim: new Date(ano, 11, 31),
    numero: 4,
  }
}

// Prazo de recolhimento: último dia útil do mês seguinte ao trimestre
// T1 (jan-mar) → 30/04; T2 (abr-jun) → 31/07; T3 (jul-set) → 31/10; T4 (out-dez) → 31/01
function prazoTrimestre(trimestreLabel: string): string {
  const [anoStr, t] = trimestreLabel.split('-')
  const ano = parseInt(anoStr!, 10)
  if (t === 'T1') return `${ano}-04-30`
  if (t === 'T2') return `${ano}-07-31`
  if (t === 'T3') return `${ano}-10-31`
  return `${ano + 1}-01-31`
}

export type ResultadoIrpjCsllLR = {
  cnpj: string
  competencia: string
  trimestreLabel: string
  lucroContabilTrimestral: Decimal
  adicoesLALUR: Decimal
  exclusoesLALUR: Decimal
  lucroRealTrimestral: Decimal
  baseCalculoIRPJ: Decimal
  baseCalculoCSLL: Decimal
  irpjNormal: Decimal
  irpjAdicional: Decimal
  irpjTotal: Decimal
  csllTotal: Decimal
  totalDevido: Decimal
  prazoRecolhimento: string
}

export class IrpjCsllLRService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async apurar(
    tenantId: string,
    empresaId: string,
    competencia: string,
    lucroContabilTrimestral: Decimal = new Decimal(0),
    adicoesLALUR: Decimal = new Decimal(0),
    exclusoesLALUR: Decimal = new Decimal(0)
  ): Promise<ResultadoIrpjCsllLR> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_REAL') throw new Error('Empresa não é Lucro Real')

    const { trimestreLabel } = trimestDeCompetencia(competencia)
    const prazoRecolhimento = prazoTrimestre(trimestreLabel)

    // Lucro Real = Lucro Contábil + Adições - Exclusões (LALUR)
    const lucroRealTrimestral = lucroContabilTrimestral
      .plus(adicoesLALUR)
      .minus(exclusoesLALUR)
      .toDecimalPlaces(2)

    // Base negativa ou zero → contribuições zeradas
    const basePositiva = lucroRealTrimestral.gt(0) ? lucroRealTrimestral : new Decimal(0)
    const baseCalculoIRPJ = basePositiva
    const baseCalculoCSLL = basePositiva

    // IRPJ: 15% + 10% adicional sobre base > R$60.000/trimestre
    const irpjNormal = baseCalculoIRPJ.times('0.15').toDecimalPlaces(2)
    const limiteAdicional = new Decimal('60000')
    const baseAdicional = baseCalculoIRPJ.minus(limiteAdicional)
    const irpjAdicional = baseAdicional.gt(0)
      ? baseAdicional.times('0.10').toDecimalPlaces(2)
      : new Decimal(0)
    const irpjTotal = irpjNormal.plus(irpjAdicional)

    // CSLL: 9%
    const csllTotal = baseCalculoCSLL.times('0.09').toDecimalPlaces(2)

    const totalDevido = irpjTotal.plus(csllTotal)

    const resultado: ResultadoIrpjCsllLR = {
      cnpj: empresa.cnpj,
      competencia,
      trimestreLabel,
      lucroContabilTrimestral,
      adicoesLALUR,
      exclusoesLALUR,
      lucroRealTrimestral,
      baseCalculoIRPJ,
      baseCalculoCSLL,
      irpjNormal,
      irpjAdicional,
      irpjTotal,
      csllTotal,
      totalDevido,
      prazoRecolhimento,
    }

    await Promise.all([
      this.db.apuracaoFiscal.upsert({
        where: {
          tenantId_empresaId_competencia_tipo: {
            tenantId,
            empresaId,
            competencia: trimestreLabel,
            tipo: 'IRPJ_LR',
          },
        },
        update: { dados: resultado as any, status: 'CALCULADO' },
        create: {
          tenantId,
          empresaId,
          competencia: trimestreLabel,
          tipo: 'IRPJ_LR',
          dados: resultado as any,
          status: 'CALCULADO',
        },
      }),
      this.db.apuracaoFiscal.upsert({
        where: {
          tenantId_empresaId_competencia_tipo: {
            tenantId,
            empresaId,
            competencia: trimestreLabel,
            tipo: 'CSLL_LR',
          },
        },
        update: { dados: resultado as any, status: 'CALCULADO' },
        create: {
          tenantId,
          empresaId,
          competencia: trimestreLabel,
          tipo: 'CSLL_LR',
          dados: resultado as any,
          status: 'CALCULADO',
        },
      }),
    ])

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'IRPJ_CSLL_LR_APURADO',
      estadoNovo: {
        trimestreLabel,
        lucroRealTrimestral: lucroRealTrimestral.toString(),
        irpjTotal: irpjTotal.toString(),
        csllTotal: csllTotal.toString(),
        totalDevido: totalDevido.toString(),
        prazoRecolhimento,
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
