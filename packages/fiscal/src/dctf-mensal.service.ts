import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// DCTF Mensal — Declaração de Débitos e Créditos Tributários Federais
// Prazo: até o 15º dia útil do 2º mês seguinte ao de apuração
// Base legal: IN RFB 2.005/2021 e atualizações
// Obrigatória para LP/LR: agrega PIS, COFINS e estimativas mensais de IRPJ/CSLL

export type ItemDCTF = {
  codigoReceita: string
  descricao: string
  valorDebito: Decimal
  valorCredito: Decimal
  valorLiquido: Decimal
}

export type ResultadoDCTFMensal = {
  cnpj: string
  competencia: string
  regime: string
  itens: ItemDCTF[]
  totalDebitos: Decimal
  totalCreditos: Decimal
  saldoDevedor: Decimal
  prazoEntrega: string
}

// Prazo: 15º dia do 2º mês seguinte à competência (simplificado: dia 15 do mês M+2)
function calcularPrazo(competencia: string): string {
  const [anoStr, mesStr] = competencia.split('-')
  let ano = parseInt(anoStr!, 10)
  let mes = parseInt(mesStr!, 10) + 2
  if (mes > 12) {
    mes -= 12
    ano += 1
  }
  return `${ano}-${String(mes).padStart(2, '0')}-15`
}

export class DCTFMensalService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async gerar(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoDCTFMensal> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_PRESUMIDO' && empresa.regime !== 'LUCRO_REAL')
      throw new Error('DCTF Mensal é obrigatória apenas para Lucro Presumido ou Lucro Real')

    // Busca apurações PIS e COFINS do período
    const [apuracaoPIS, apuracaoCOFINS] = await Promise.all([
      this.db.apuracaoFiscal.findFirst({
        where: { tenantId, empresaId, competencia, tipo: 'PIS' },
      }),
      this.db.apuracaoFiscal.findFirst({
        where: { tenantId, empresaId, competencia, tipo: 'COFINS' },
      }),
    ])

    const itens: ItemDCTF[] = []

    // PIS — código 6912 (LP) ou 5856 (LR não-cumulativo)
    const codigoPIS = empresa.regime === 'LUCRO_PRESUMIDO' ? '6912' : '5856'
    const valorPIS = apuracaoPIS?.dados
      ? new Decimal((apuracaoPIS.dados as any).pis?.toString() ?? '0')
      : new Decimal(0)
    itens.push({
      codigoReceita: codigoPIS,
      descricao: `PIS/Pasep — Regime ${empresa.regime === 'LUCRO_PRESUMIDO' ? 'Cumulativo' : 'Não-Cumulativo'}`,
      valorDebito: valorPIS,
      valorCredito: new Decimal(0),
      valorLiquido: valorPIS,
    })

    // COFINS — código 2172 (LP) ou 5960 (LR não-cumulativo)
    const codigoCOFINS = empresa.regime === 'LUCRO_PRESUMIDO' ? '2172' : '5960'
    const valorCOFINS = apuracaoCOFINS?.dados
      ? new Decimal((apuracaoCOFINS.dados as any).cofins?.toString() ?? '0')
      : new Decimal(0)
    itens.push({
      codigoReceita: codigoCOFINS,
      descricao: `COFINS — Regime ${empresa.regime === 'LUCRO_PRESUMIDO' ? 'Cumulativo' : 'Não-Cumulativo'}`,
      valorDebito: valorCOFINS,
      valorCredito: new Decimal(0),
      valorLiquido: valorCOFINS,
    })

    const totalDebitos = itens.reduce((s, i) => s.plus(i.valorDebito), new Decimal(0))
    const totalCreditos = itens.reduce((s, i) => s.plus(i.valorCredito), new Decimal(0))
    const saldoDevedor = totalDebitos.minus(totalCreditos)

    const prazoEntrega = calcularPrazo(competencia)

    const resultado: ResultadoDCTFMensal = {
      cnpj: empresa.cnpj,
      competencia,
      regime: empresa.regime,
      itens,
      totalDebitos,
      totalCreditos,
      saldoDevedor,
      prazoEntrega,
    }

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'DCTFWEB',
        },
      },
      update: { dados: resultado as any, status: 'CALCULADO' },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'DCTFWEB',
        dados: resultado as any,
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
        totalDebitos: totalDebitos.toString(),
        saldoDevedor: saldoDevedor.toString(),
        prazoEntrega,
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
