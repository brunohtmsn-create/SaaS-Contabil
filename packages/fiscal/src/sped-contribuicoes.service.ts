import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// SPED Contribuições — EFD PIS/COFINS
// Base legal: IN RFB 1.252/2012 e atualizações
// Obrigatória para LP (cumulativo) e LR (não-cumulativo)
// Prazo: até o 10º dia útil do 2º mês seguinte à competência
// LP: PIS 0,65% / COFINS 3% (cumulativo, sem créditos)
// LR: PIS 1,65% / COFINS 7,6% (não-cumulativo, com aproveitamento de créditos)

export type ResultadoSpedContribuicoes = {
  cnpj: string
  competencia: string
  regime: string
  totalDocumentos: number
  receitaBruta: Decimal
  totalPIS: Decimal
  totalCOFINS: Decimal
  totalContribuicoes: Decimal
  prazoEntrega: string
  conteudoSPED: string
}

const ALIQUOTA_PIS_LP = new Decimal('0.0065')
const ALIQUOTA_COFINS_LP = new Decimal('0.03')
const ALIQUOTA_PIS_LR = new Decimal('0.0165')
const ALIQUOTA_COFINS_LR = new Decimal('0.076')

function prazo(competencia: string): string {
  const [anoStr, mesStr] = competencia.split('-')
  let ano = parseInt(anoStr!, 10)
  let mes = parseInt(mesStr!, 10) + 2
  if (mes > 12) {
    mes -= 12
    ano += 1
  }
  return `${ano}-${String(mes).padStart(2, '0')}-10`
}

export class SpedContribuicoesService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async gerar(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoSpedContribuicoes> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_PRESUMIDO' && empresa.regime !== 'LUCRO_REAL')
      throw new Error('SPED Contribuições é aplicável apenas para Lucro Presumido ou Lucro Real')

    const [anoStr, mesStr] = competencia.split('-')
    const ano = parseInt(anoStr!, 10)
    const mes = parseInt(mesStr!, 10)
    const inicio = new Date(ano, mes - 1, 1)
    const fim = new Date(ano, mes, 0, 23, 59, 59)

    // Busca documentos fiscais CONCILIADOS (emitidos e tomados)
    const documentos = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: 'CONCILIADO',
        tipo: { in: ['NFE', 'NFCE', 'NFSE_EMITIDA'] },
        direcao: { in: ['SAIDA', 'PRESTACAO'] },
      },
      orderBy: { dataEmissao: 'asc' },
    })

    const receitaBruta = documentos.reduce(
      (s, d) => s.plus(new Decimal(d.valorTotal.toString())),
      new Decimal(0)
    )

    const isLP = empresa.regime === 'LUCRO_PRESUMIDO'
    const aliqPIS = isLP ? ALIQUOTA_PIS_LP : ALIQUOTA_PIS_LR
    const aliqCOFINS = isLP ? ALIQUOTA_COFINS_LP : ALIQUOTA_COFINS_LR

    const totalPIS = receitaBruta.times(aliqPIS).toDecimalPlaces(2)
    const totalCOFINS = receitaBruta.times(aliqCOFINS).toDecimalPlaces(2)
    const totalContribuicoes = totalPIS.plus(totalCOFINS)

    const prazoEntrega = prazo(competencia)
    const anoMes = competencia.replace('-', '')

    // Geração do arquivo EFD Contribuições (simplificado)
    const linhas: string[] = []

    // Bloco 0 — Abertura
    linhas.push(
      `|0000|006|${anoMes}01|${anoMes}${String(fim.getDate()).padStart(2, '0')}|${empresa.cnpj}|${empresa.razaoSocial}|||${empresa.uf}|||0|${isLP ? '1' : '2'}||`
    )
    linhas.push(`|0001|0|`)
    linhas.push(`|0990|2|`)

    // Bloco A — NFS-e
    linhas.push(`|A001|1|`)
    const nfse = documentos.filter((d) => d.tipo === 'NFSE_EMITIDA')
    for (const doc of nfse) {
      const dataStr = doc.dataEmissao.toISOString().split('T')[0]!.replace(/-/g, '')
      const valor = new Decimal(doc.valorTotal.toString()).toFixed(2)
      linhas.push(
        `|A100|0|${doc.cnpjDestinatario}||${doc.numero}|${dataStr}|${valor}|${new Decimal(doc.valorPis.toString()).toFixed(2)}|${new Decimal(doc.valorCofins.toString()).toFixed(2)}|`
      )
    }
    linhas.push(`|A990|${nfse.length + 2}|`)

    // Bloco C — NF-e e NFC-e
    linhas.push(`|C001|1|`)
    const nfe = documentos.filter((d) => d.tipo === 'NFE' || d.tipo === 'NFCE')
    for (const doc of nfe) {
      const dataStr = doc.dataEmissao.toISOString().split('T')[0]!.replace(/-/g, '')
      const valor = new Decimal(doc.valorTotal.toString()).toFixed(2)
      linhas.push(
        `|C100|0|1|${doc.chaveAcesso ?? ''}|55|${doc.serie ?? '000'}|${doc.numero}|${dataStr}|${valor}|${new Decimal(doc.valorPis.toString()).toFixed(2)}|${new Decimal(doc.valorCofins.toString()).toFixed(2)}|`
      )
    }
    linhas.push(`|C990|${nfe.length + 2}|`)

    // Bloco M — Apurações PIS e COFINS
    linhas.push(`|M001|1|`)
    linhas.push(
      `|M100|${isLP ? '01' : '70'}|${totalPIS.toFixed(2)}|0.00|0.00|${totalPIS.toFixed(2)}|0.00|`
    )
    linhas.push(`|M200|${totalPIS.toFixed(2)}|0.00|0.00|${totalPIS.toFixed(2)}|0.00|`)
    linhas.push(
      `|M500|${isLP ? '01' : '70'}|${totalCOFINS.toFixed(2)}|0.00|0.00|${totalCOFINS.toFixed(2)}|0.00|`
    )
    linhas.push(`|M600|${totalCOFINS.toFixed(2)}|0.00|0.00|${totalCOFINS.toFixed(2)}|0.00|`)
    linhas.push(`|M990|5|`)

    // Bloco 9 — Encerramento
    linhas.push(`|9001|0|`)
    linhas.push(`|9900|0000|1|`)
    linhas.push(`|9900|C100|${nfe.length}|`)
    linhas.push(`|9900|M200|1|`)
    linhas.push(`|9999|${linhas.length + 1}|`)

    const conteudoSPED = linhas.join('\r\n')

    const resultado: ResultadoSpedContribuicoes = {
      cnpj: empresa.cnpj,
      competencia,
      regime: empresa.regime,
      totalDocumentos: documentos.length,
      receitaBruta,
      totalPIS,
      totalCOFINS,
      totalContribuicoes,
      prazoEntrega,
      conteudoSPED,
    }

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'PIS',
        },
      },
      update: {
        dados: {
          totalPIS: totalPIS.toString(),
          totalCOFINS: totalCOFINS.toString(),
          totalDocumentos: documentos.length,
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'PIS',
        dados: {
          totalPIS: totalPIS.toString(),
          totalCOFINS: totalCOFINS.toString(),
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
      evento: 'PIS_COFINS_LP_APURADO',
      estadoNovo: {
        competencia,
        regime: empresa.regime,
        totalPIS: totalPIS.toString(),
        totalCOFINS: totalCOFINS.toString(),
        prazoEntrega,
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
