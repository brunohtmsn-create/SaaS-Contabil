import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// SPED Fiscal — EFD ICMS/IPI
// Base legal: Ajuste SINIEF 02/2009 e atualizações
// Obrigatória para contribuintes do ICMS (LP e LR com operações sujeitas a ICMS)
// Prazo: até o 15º dia do 2º mês seguinte à competência (Confaz)

export type ResultadoSpedFiscal = {
  cnpj: string
  competencia: string
  regime: string
  totalRegistros: number
  totalDocumentos: number
  totalICMS: Decimal
  totalIPI: Decimal
  prazoEntrega: string
  conteudoSPED: string
}

function prazoEFD(competencia: string): string {
  const [anoStr, mesStr] = competencia.split('-')
  let ano = parseInt(anoStr!, 10)
  let mes = parseInt(mesStr!, 10) + 2
  if (mes > 12) {
    mes -= 12
    ano += 1
  }
  return `${ano}-${String(mes).padStart(2, '0')}-15`
}

export class SpedFiscalService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async gerar(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoSpedFiscal> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_PRESUMIDO' && empresa.regime !== 'LUCRO_REAL')
      throw new Error('SPED Fiscal é aplicável apenas para Lucro Presumido ou Lucro Real')

    const [anoStr, mesStr] = competencia.split('-')
    const ano = parseInt(anoStr!, 10)
    const mes = parseInt(mesStr!, 10)
    const inicio = new Date(ano, mes - 1, 1)
    const fim = new Date(ano, mes, 0, 23, 59, 59)

    // Busca documentos fiscais CONCILIADOS do período (NF-e e NFC-e sujeitas a ICMS)
    const documentos = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: 'CONCILIADO',
        tipo: { in: ['NFE', 'NFCE'] },
      },
      orderBy: { dataEmissao: 'asc' },
    })

    const totalICMS = documentos.reduce(
      (s, d) => s.plus(new Decimal(d.valorIcms.toString())),
      new Decimal(0)
    )

    const totalIPI = documentos.reduce(
      (s, d) => s.plus(new Decimal(d.valorIpi.toString())),
      new Decimal(0)
    )

    const prazoEntrega = prazoEFD(competencia)
    const anoMes = competencia.replace('-', '')
    const diaFim = String(fim.getDate()).padStart(2, '0')

    // Geração do arquivo EFD (simplificado)
    const linhas: string[] = []

    // Bloco 0 — Abertura e identificação
    linhas.push(
      `|0000|015|0|01${anoMes}|${diaFim}${anoMes}|${empresa.cnpj}|${empresa.razaoSocial}|||${empresa.uf}|||0||`
    )
    linhas.push(`|0001|0|`)
    linhas.push(`|0005|${empresa.razaoSocial}|||`)
    linhas.push(`|0990|3|`)

    // Bloco C — Documentos fiscais (NF-e/NFC-e)
    linhas.push(`|C001|1|`)
    for (const doc of documentos) {
      const dataStr = doc.dataEmissao.toISOString().split('T')[0]!.replace(/-/g, '')
      const valor = new Decimal(doc.valorTotal.toString()).toFixed(2)
      const icms = new Decimal(doc.valorIcms.toString()).toFixed(2)
      linhas.push(
        `|C100|0|1|${doc.chaveAcesso ?? ''}|55|${doc.serie ?? '000'}|${doc.numero}|${dataStr}|${valor}|${icms}|0.00|`
      )
    }
    linhas.push(`|C990|${documentos.length + 2}|`)

    // Bloco E — Apurações ICMS
    linhas.push(`|E001|1|`)
    linhas.push(`|E100|01${anoMes}|${diaFim}${anoMes}|`)
    linhas.push(
      `|E110|${totalICMS.toFixed(2)}|0.00|0.00|${totalICMS.toFixed(2)}|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|0.00|`
    )
    linhas.push(`|E990|3|`)

    // Bloco 9 — Encerramento
    linhas.push(`|9001|0|`)
    linhas.push(`|9900|0000|1|`)
    linhas.push(`|9900|C100|${documentos.length}|`)
    linhas.push(`|9900|E110|1|`)
    linhas.push(`|9999|${linhas.length + 1}|`)

    const conteudoSPED = linhas.join('\r\n')

    const resultado: ResultadoSpedFiscal = {
      cnpj: empresa.cnpj,
      competencia,
      regime: empresa.regime,
      totalRegistros: linhas.length,
      totalDocumentos: documentos.length,
      totalICMS,
      totalIPI,
      prazoEntrega,
      conteudoSPED,
    }

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'DESTDA',
        },
      },
      update: {
        dados: {
          totalICMS: totalICMS.toString(),
          totalDocumentos: documentos.length,
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'DESTDA',
        dados: {
          totalICMS: totalICMS.toString(),
          totalDocumentos: documentos.length,
        } as any,
        status: 'CALCULADO',
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'DESTDA_GERADO',
      estadoNovo: {
        competencia,
        totalDocumentos: documentos.length,
        totalICMS: totalICMS.toString(),
        prazoEntrega,
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
