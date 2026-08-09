import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo } from '@saas-contabil/shared'

export type LinhaLivro = {
  data: string
  tipo: string
  numero: string
  cnpjContraparte: string
  nomeContraparte: string
  cfop: string
  valorTotal: string
  valorIcms: string
  valorIss: string
  valorPis: string
  valorCofins: string
  valorIrrf: string
  status: string
}

export type LivroFiscal = {
  competencia: string
  cnpj: string
  entradas: LinhaLivro[]
  saidas: LinhaLivro[]
  servicos: LinhaLivro[]
  servicosTomados: LinhaLivro[]
  totaisEntradas: {
    valorTotal: string
    valorIcms: string
    valorIss: string
    valorPis: string
    valorCofins: string
  }
  totaisSaidas: {
    valorTotal: string
    valorIcms: string
    valorIss: string
    valorPis: string
    valorCofins: string
  }
  totalServicosEmitidos: string
  totalServicosTomados: string
}

type TotaisAcumulados = {
  valorTotal: Decimal
  valorIcms: Decimal
  valorIss: Decimal
  valorPis: Decimal
  valorCofins: Decimal
}

function totaisZero(): TotaisAcumulados {
  return {
    valorTotal: new Decimal(0),
    valorIcms: new Decimal(0),
    valorIss: new Decimal(0),
    valorPis: new Decimal(0),
    valorCofins: new Decimal(0),
  }
}

function serializarTotais(t: TotaisAcumulados) {
  return {
    valorTotal: t.valorTotal.toFixed(2),
    valorIcms: t.valorIcms.toFixed(2),
    valorIss: t.valorIss.toFixed(2),
    valorPis: t.valorPis.toFixed(2),
    valorCofins: t.valorCofins.toFixed(2),
  }
}

function acumularTotais(acc: TotaisAcumulados, doc: any): TotaisAcumulados {
  return {
    valorTotal: acc.valorTotal.plus(new Decimal(doc.valorTotal?.toString() ?? '0')),
    valorIcms: acc.valorIcms.plus(new Decimal(doc.valorIcms?.toString() ?? '0')),
    valorIss: acc.valorIss.plus(new Decimal(doc.valorIss?.toString() ?? '0')),
    valorPis: acc.valorPis.plus(new Decimal(doc.valorPis?.toString() ?? '0')),
    valorCofins: acc.valorCofins.plus(new Decimal(doc.valorCofins?.toString() ?? '0')),
  }
}

function mapearLinha(doc: any, cnpjContraparte: string, nomeContraparte: string): LinhaLivro {
  return {
    data: doc.dataEmissao instanceof Date ? doc.dataEmissao.toISOString() : String(doc.dataEmissao),
    tipo: doc.tipo,
    numero: doc.numero,
    cnpjContraparte,
    nomeContraparte,
    cfop: doc.cfop ?? '',
    valorTotal: new Decimal(doc.valorTotal?.toString() ?? '0').toFixed(2),
    valorIcms: new Decimal(doc.valorIcms?.toString() ?? '0').toFixed(2),
    valorIss: new Decimal(doc.valorIss?.toString() ?? '0').toFixed(2),
    valorPis: new Decimal(doc.valorPis?.toString() ?? '0').toFixed(2),
    valorCofins: new Decimal(doc.valorCofins?.toString() ?? '0').toFixed(2),
    valorIrrf: new Decimal(doc.valorIrrf?.toString() ?? '0').toFixed(2),
    status: doc.status,
  }
}

export class LivroFiscalService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async gerar(tenantId: string, empresaId: string, competencia: string): Promise<LivroFiscal> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const { inicio, fim } = parsePeriodo(competencia)

    // Livro fiscal inclui todos os status — não só CONCILIADO
    const docs = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
      },
      orderBy: { dataEmissao: 'asc' },
    })

    const entradas: LinhaLivro[] = []
    const saidas: LinhaLivro[] = []
    const servicos: LinhaLivro[] = []
    const servicosTomados: LinhaLivro[] = []

    let totaisEntradas = totaisZero()
    let totaisSaidas = totaisZero()
    let totalServicosEmitidos = new Decimal(0)
    let totalServicosTomados = new Decimal(0)

    for (const doc of docs) {
      switch (doc.tipo) {
        case 'NFSE_EMITIDA': {
          // Para NFSe emitida: empresa é o prestador (emitente), contraparte é o tomador (destinatário)
          const linha = mapearLinha(doc, doc.cnpjDestinatario, '')
          servicos.push(linha)
          totalServicosEmitidos = totalServicosEmitidos.plus(
            new Decimal(doc.valorTotal?.toString() ?? '0')
          )
          break
        }
        case 'NFSE_TOMADA': {
          // Para NFSe tomada: empresa é o tomador (destinatário), contraparte é o prestador (emitente)
          const linha = mapearLinha(doc, doc.cnpjEmitente, doc.nomeEmitente)
          servicosTomados.push(linha)
          totalServicosTomados = totalServicosTomados.plus(
            new Decimal(doc.valorTotal?.toString() ?? '0')
          )
          break
        }
        default: {
          if (doc.direcao === 'ENTRADA') {
            const linha = mapearLinha(doc, doc.cnpjEmitente, doc.nomeEmitente)
            entradas.push(linha)
            totaisEntradas = acumularTotais(totaisEntradas, doc)
          } else {
            // SAIDA ou PRESTACAO de NF-e / NFC-e
            const linha = mapearLinha(doc, doc.cnpjDestinatario, '')
            saidas.push(linha)
            totaisSaidas = acumularTotais(totaisSaidas, doc)
          }
        }
      }
    }

    const totalGeral = totaisEntradas.valorTotal
      .plus(totaisSaidas.valorTotal)
      .plus(totalServicosEmitidos)
      .plus(totalServicosTomados)

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'ISS',
        },
      },
      update: {
        dados: {
          competencia,
          totalDocumentos: docs.length,
          totalGeral: totalGeral.toFixed(2),
          totalServicosEmitidos: totalServicosEmitidos.toFixed(2),
          totalServicosTomados: totalServicosTomados.toFixed(2),
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'ISS',
        dados: {
          competencia,
          totalDocumentos: docs.length,
          totalGeral: totalGeral.toFixed(2),
          totalServicosEmitidos: totalServicosEmitidos.toFixed(2),
          totalServicosTomados: totalServicosTomados.toFixed(2),
        } as any,
        status: 'CALCULADO',
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL',
      entidadeId: empresaId,
      evento: 'LANCAMENTO_GERADO',
      estadoNovo: {
        competencia,
        totalDocumentos: docs.length,
        totalEntradas: entradas.length,
        totalSaidas: saidas.length,
        totalServicosEmitidos: totalServicosEmitidos.toFixed(2),
        totalServicosTomados: totalServicosTomados.toFixed(2),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return {
      competencia,
      cnpj: empresa.cnpj,
      entradas,
      saidas,
      servicos,
      servicosTomados,
      totaisEntradas: serializarTotais(totaisEntradas),
      totaisSaidas: serializarTotais(totaisSaidas),
      totalServicosEmitidos: totalServicosEmitidos.toFixed(2),
      totalServicosTomados: totalServicosTomados.toFixed(2),
    }
  }
}
