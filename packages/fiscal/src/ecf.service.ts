import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// ECF — Escrituração Contábil Fiscal
// Prazo: 31/07 do ano seguinte ao período de apuração
// Base legal: IN RFB 1.422/2013 e atualizações

export type TrimestralECF = {
  trimestre: string // ex: "2025-T1"
  receita: Decimal
  baseIRPJ: Decimal
  baseCSLL: Decimal
  irpjNormal: Decimal
  irpjAdicional: Decimal
  irpjTotal: Decimal
  csllTotal: Decimal
  totalDevido: Decimal
}

export type ResultadoECF = {
  cnpj: string
  ano: number
  regime: string
  receitaBrutaAnual: Decimal
  baseIRPJAnual: Decimal
  baseCSLLAnual: Decimal
  irpjAnual: Decimal
  csllAnual: Decimal
  totalDevidoAnual: Decimal
  trimestres: TrimestralECF[]
  dataEntrega: string // YYYY-MM-DD
  situacao: 'PENDENTE' | 'GERADO'
}

export class ECFService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async gerar(tenantId: string, empresaId: string, ano: number): Promise<ResultadoECF> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_PRESUMIDO' && empresa.regime !== 'LUCRO_REAL')
      throw new Error('ECF é obrigatória apenas para Lucro Presumido ou Lucro Real')

    // Busca os 4 trimestres de IRPJ já apurados no ano
    const trimestresLabel = [`${ano}-T1`, `${ano}-T2`, `${ano}-T3`, `${ano}-T4`]
    const apuracoes = await this.db.apuracaoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        tipo: 'IRPJ_LP',
        competencia: { in: trimestresLabel },
      },
    })

    const trimestres: TrimestralECF[] = trimestresLabel.map((label) => {
      const ap = apuracoes.find((a) => a.competencia === label)
      if (!ap) {
        return {
          trimestre: label,
          receita: new Decimal(0),
          baseIRPJ: new Decimal(0),
          baseCSLL: new Decimal(0),
          irpjNormal: new Decimal(0),
          irpjAdicional: new Decimal(0),
          irpjTotal: new Decimal(0),
          csllTotal: new Decimal(0),
          totalDevido: new Decimal(0),
        }
      }
      const d = ap.dados as any
      return {
        trimestre: label,
        receita: new Decimal(d.receitaBrutaTrimestral?.toString() ?? '0'),
        baseIRPJ: new Decimal(d.baseCalculoIRPJ?.toString() ?? '0'),
        baseCSLL: new Decimal(d.baseCalculoCSLL?.toString() ?? '0'),
        irpjNormal: new Decimal(d.irpjNormal?.toString() ?? '0'),
        irpjAdicional: new Decimal(d.irpjAdicional?.toString() ?? '0'),
        irpjTotal: new Decimal(d.irpjTotal?.toString() ?? '0'),
        csllTotal: new Decimal(d.csllTotal?.toString() ?? '0'),
        totalDevido: new Decimal(d.totalDevido?.toString() ?? '0'),
      }
    })

    const receitaBrutaAnual = trimestres.reduce((s, t) => s.plus(t.receita), new Decimal(0))
    const baseIRPJAnual = trimestres.reduce((s, t) => s.plus(t.baseIRPJ), new Decimal(0))
    const baseCSLLAnual = trimestres.reduce((s, t) => s.plus(t.baseCSLL), new Decimal(0))
    const irpjAnual = trimestres.reduce((s, t) => s.plus(t.irpjTotal), new Decimal(0))
    const csllAnual = trimestres.reduce((s, t) => s.plus(t.csllTotal), new Decimal(0))
    const totalDevidoAnual = irpjAnual.plus(csllAnual)

    // Prazo ECF: 31/07 do ano seguinte
    const dataEntrega = `${ano + 1}-07-31`

    const resultado: ResultadoECF = {
      cnpj: empresa.cnpj,
      ano,
      regime: empresa.regime,
      receitaBrutaAnual,
      baseIRPJAnual,
      baseCSLLAnual,
      irpjAnual,
      csllAnual,
      totalDevidoAnual,
      trimestres,
      dataEntrega,
      situacao: 'GERADO',
    }

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia: `${ano}`,
          tipo: 'ECF',
        },
      },
      update: { dados: resultado as any, status: 'CALCULADO' },
      create: {
        tenantId,
        empresaId,
        competencia: `${ano}`,
        tipo: 'ECF',
        dados: resultado as any,
        status: 'CALCULADO',
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'ECF_GERADO',
      estadoNovo: {
        ano,
        receitaBrutaAnual: receitaBrutaAnual.toString(),
        irpjAnual: irpjAnual.toString(),
        csllAnual: csllAnual.toString(),
        totalDevidoAnual: totalDevidoAnual.toString(),
        dataEntrega,
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
