import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// INSS Patronal — Contribuição Previdenciária do Empregador
// Base legal: Lei 8.212/1991, art. 22
//
// Componentes:
//   1. CPP (Contribuição Patronal Previdenciária): 20% sobre folha salarial
//   2. GILRAT (Grau de Incidência de Incapacidade Laborativa):
//      - Grau 1 (risco leve):    1%
//      - Grau 2 (risco médio):   2%
//      - Grau 3 (risco grave):   3%
//   3. Terceiros (SENAI/SENAC/SESC/SESI/SEBRAE etc.): alíquotas por CNAE
//      - Tabela simplificada: 5,8% (comércio) / 5,1% (serviços) / 1% (geral)
//
// RAT × FAP: GILRAT pode ser reduzido até 50% ou aumentado até 100% pelo FAP
//   - FAP < 1,0 → reduz GILRAT; FAP > 1,0 → aumenta GILRAT
//   - FAP default = 1,0 (sem ajuste)
//
// Dedução de 13° e férias já considerados na folha base
// Recolhimento: GFIP/GPS até dia 20 do mês seguinte

const CPP_ALIQUOTA = new Decimal('0.20') // 20%

// GILRAT por grau de risco (RAT bruto antes do FAP)
const GILRAT_BASE: Record<string, Decimal> = {
  leve: new Decimal('0.01'), // 1%
  medio: new Decimal('0.02'), // 2%
  grave: new Decimal('0.03'), // 3%
}

// Alíquotas terceiros simplificadas por atividade
const TERCEIROS_ALIQUOTA: Record<string, Decimal> = {
  comercio: new Decimal('0.058'), // SENAC 1% + SESC 1,5% + SEBRAE 0,6% + outros ≈ 5,8%
  industria: new Decimal('0.057'), // SENAI 1% + SESI 1,5% + IEL 0,2% + outros ≈ 5,7%
  servicos: new Decimal('0.051'), // SENAC 1% + SESC 1,5% + outros ≈ 5,1%
  outros: new Decimal('0.058'), // padrão comércio
}

export type FuncionarioINSS = {
  id: string
  nome: string
  salarioBase: Decimal
  adicional13?: Decimal
  adicionaisVariaveis?: Decimal // horas extras, comissões etc.
}

export type ItemINSSPatronal = {
  funcionarioId: string
  nome: string
  baseCalculo: Decimal
  cpp: Decimal
  gilrat: Decimal
  terceiros: Decimal
  totalPatronal: Decimal
}

export type ResultadoINSSPatronal = {
  cnpj: string
  competencia: string
  totalFuncionarios: number
  totalFolha: Decimal
  totalCPP: Decimal
  totalGILRAT: Decimal
  totalTerceiros: Decimal
  totalPatronal: Decimal
  grauRisco: string
  fap: Decimal
  gilratEfetivo: Decimal
  prazoRecolhimento: string
  itens: ItemINSSPatronal[]
}

function prazoINSS(competencia: string): string {
  const [anoStr, mesStr] = competencia.split('-')
  let ano = parseInt(anoStr!, 10)
  let mes = parseInt(mesStr!, 10) + 1
  if (mes > 12) {
    mes = 1
    ano += 1
  }
  return `${ano}-${String(mes).padStart(2, '0')}-20`
}

export class INSSPatronalService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async calcular(
    tenantId: string,
    empresaId: string,
    competencia: string,
    funcionarios: FuncionarioINSS[],
    grauRisco: 'leve' | 'medio' | 'grave' = 'medio',
    fap: Decimal = new Decimal('1.0'),
    atividadeTerceiros: string = 'outros'
  ): Promise<ResultadoINSSPatronal> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    // GILRAT efetivo = RAT base × FAP (limitado entre 0,5 e 2× a alíquota base)
    const gilratBase = GILRAT_BASE[grauRisco] ?? GILRAT_BASE['medio']!
    const gilratBruto = gilratBase.times(fap)
    const gilratMin = gilratBase.times(new Decimal('0.5'))
    const gilratMax = gilratBase.times(new Decimal('2.0'))
    const gilratEfetivo = Decimal.max(gilratMin, Decimal.min(gilratMax, gilratBruto))

    const aliquotaTerceiros =
      TERCEIROS_ALIQUOTA[atividadeTerceiros] ?? TERCEIROS_ALIQUOTA['outros']!

    const itens: ItemINSSPatronal[] = []
    let totalFolha = new Decimal(0)
    let totalCPP = new Decimal(0)
    let totalGILRAT = new Decimal(0)
    let totalTerceiros = new Decimal(0)

    for (const func of funcionarios) {
      const baseCalculo = func.salarioBase
        .plus(func.adicional13 ?? new Decimal(0))
        .plus(func.adicionaisVariaveis ?? new Decimal(0))

      const cpp = baseCalculo.times(CPP_ALIQUOTA).toDecimalPlaces(2)
      const gilrat = baseCalculo.times(gilratEfetivo).toDecimalPlaces(2)
      const terceiros = baseCalculo.times(aliquotaTerceiros).toDecimalPlaces(2)
      const totalPatronal = cpp.plus(gilrat).plus(terceiros)

      totalFolha = totalFolha.plus(baseCalculo)
      totalCPP = totalCPP.plus(cpp)
      totalGILRAT = totalGILRAT.plus(gilrat)
      totalTerceiros = totalTerceiros.plus(terceiros)

      itens.push({
        funcionarioId: func.id,
        nome: func.nome,
        baseCalculo,
        cpp,
        gilrat,
        terceiros,
        totalPatronal,
      })
    }

    const totalPatronal = totalCPP.plus(totalGILRAT).plus(totalTerceiros)
    const prazo = prazoINSS(competencia)

    const resultado: ResultadoINSSPatronal = {
      cnpj: empresa.cnpj,
      competencia,
      totalFuncionarios: funcionarios.length,
      totalFolha,
      totalCPP,
      totalGILRAT,
      totalTerceiros,
      totalPatronal,
      grauRisco,
      fap,
      gilratEfetivo,
      prazoRecolhimento: prazo,
      itens,
    }

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
          totalFolha: totalFolha.toString(),
          totalCPP: totalCPP.toString(),
          totalGILRAT: totalGILRAT.toString(),
          totalTerceiros: totalTerceiros.toString(),
          totalPatronal: totalPatronal.toString(),
          grauRisco,
          tipo: 'INSS_PATRONAL',
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'CSLL_LR',
        dados: {
          totalFolha: totalFolha.toString(),
          totalCPP: totalCPP.toString(),
          totalGILRAT: totalGILRAT.toString(),
          totalTerceiros: totalTerceiros.toString(),
          totalPatronal: totalPatronal.toString(),
          grauRisco,
          tipo: 'INSS_PATRONAL',
        } as any,
        status: 'CALCULADO',
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'DCTFWEB_TRANSMITIDA',
      estadoNovo: {
        competencia,
        tipo: 'INSS_PATRONAL',
        totalFuncionarios: funcionarios.length,
        totalFolha: totalFolha.toString(),
        totalPatronal: totalPatronal.toString(),
        prazoRecolhimento: prazo,
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
