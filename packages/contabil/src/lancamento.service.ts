import { getPrismaClient, DocumentoFiscal } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo, nowBR, MAPA_CFOP_CONTA } from '@saas-contabil/shared'
import type { Lancamento, Partida } from './types.js'

export class LancamentoService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async gerarLancamentos(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<Lancamento[]> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const { inicio, fim } = parsePeriodo(competencia)

    const docs = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: 'CONCILIADO',
      },
    })

    const lancamentos: Lancamento[] = []

    for (const doc of docs) {
      const lancamento = this.docToLancamento(doc)
      if (!lancamento) continue

      const saved = await this.db.lancamentoContabil.create({
        data: {
          tenantId,
          empresaId,
          competencia,
          data: doc.dataEmissao,
          historico: lancamento.historico,
          documentoId: doc.id,
          partidas: lancamento.partidas as any,
        },
      })

      await this.audit.registrar({
        tenantId,
        cnpj: empresa.cnpj,
        entidadeTipo: 'LANCAMENTO_CONTABIL',
        entidadeId: saved.id,
        evento: 'LANCAMENTO_GERADO',
        estadoNovo: { documentoId: doc.id, tipo: doc.tipo },
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
      })

      lancamentos.push({ ...lancamento, data: doc.dataEmissao, id: saved.id })
    }

    return lancamentos
  }

  private docToLancamento(doc: DocumentoFiscal): Omit<Lancamento, 'data'> | null {
    const valorTotal = new Decimal(doc.valorTotal.toString())
    const valorProdutos = new Decimal(doc.valorProdutos.toString())
    const valorServicos = new Decimal(doc.valorServicos.toString())
    const valorIcms = new Decimal(doc.valorIcms.toString())
    const valorIss = new Decimal(doc.valorIss.toString())
    const valorIssRetido = new Decimal(doc.valorIssRetido.toString())

    switch (doc.tipo) {
      case 'NFE': {
        if (doc.direcao === 'ENTRADA') {
          const contaCfop = doc.cfop ? MAPA_CFOP_CONTA[doc.cfop] : null
          return {
            historico: `Compra NF-e ${doc.numero} — ${doc.nomeEmitente}`,
            partidas: [
              {
                conta: contaCfop?.debito ?? '1.1.3.01',
                descricao: 'Estoque/Despesa',
                valor: valorProdutos,
                tipo: 'DEBITO',
              },
              {
                conta: '1.1.5.01',
                descricao: 'ICMS a recuperar',
                valor: valorIcms,
                tipo: 'DEBITO',
              },
              { conta: '2.1.1.01', descricao: 'Fornecedores', valor: valorTotal, tipo: 'CREDITO' },
            ],
          }
        }
        return {
          historico: `Venda NF-e ${doc.numero}`,
          partidas: [
            { conta: '1.1.2.01', descricao: 'Clientes', valor: valorTotal, tipo: 'DEBITO' },
            {
              conta: '3.1.1.01',
              descricao: 'Receita de vendas',
              valor: valorProdutos,
              tipo: 'CREDITO',
            },
            { conta: '2.1.4.01', descricao: 'ICMS a recolher', valor: valorIcms, tipo: 'CREDITO' },
          ],
        }
      }

      case 'NFCE': {
        return {
          historico: `Venda NFC-e ${doc.numero} — consumidor`,
          partidas: [
            { conta: '1.1.2.01', descricao: 'Caixa/PDV', valor: valorTotal, tipo: 'DEBITO' },
            {
              conta: '3.1.1.01',
              descricao: 'Receita de vendas',
              valor: valorProdutos,
              tipo: 'CREDITO',
            },
            { conta: '2.1.4.01', descricao: 'ICMS a recolher', valor: valorIcms, tipo: 'CREDITO' },
          ],
        }
      }

      case 'NFSE_TOMADA': {
        return {
          historico: `Serviço tomado NFSe ${doc.numero} — ${doc.nomeEmitente}`,
          partidas: [
            {
              conta: '4.1.2.01',
              descricao: 'Despesa de serviços',
              valor: valorServicos,
              tipo: 'DEBITO',
            },
            {
              conta: '2.1.1.02',
              descricao: 'Fornecedores de serviço',
              valor: valorTotal,
              tipo: 'CREDITO',
            },
            ...(valorIssRetido.gt(0)
              ? [
                  {
                    conta: '2.1.4.03',
                    descricao: 'ISS retido a recolher',
                    valor: valorIssRetido,
                    tipo: 'CREDITO' as const,
                  },
                ]
              : []),
          ],
        }
      }

      case 'NFSE_EMITIDA': {
        return {
          historico: `Serviço prestado NFSe ${doc.numero}`,
          partidas: [
            { conta: '1.1.2.02', descricao: 'Clientes', valor: valorTotal, tipo: 'DEBITO' },
            {
              conta: '3.1.2.01',
              descricao: 'Receita de serviços',
              valor: valorServicos,
              tipo: 'CREDITO',
            },
            ...(valorIss.gt(0)
              ? [
                  {
                    conta: '2.1.4.04',
                    descricao: 'ISS a recolher',
                    valor: valorIss,
                    tipo: 'CREDITO' as const,
                  },
                ]
              : []),
          ],
        }
      }

      default:
        return null
    }
  }

  async lancarImpostos(tenantId: string, empresaId: string, competencia: string): Promise<void> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const apuracaoPGDAS = await this.db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'PGDAS' },
    })

    if (apuracaoPGDAS?.dados) {
      const dados = apuracaoPGDAS.dados as any
      const valorDAS = new Decimal(dados.valorDAS ?? 0)

      if (valorDAS.gt(0)) {
        await this.db.lancamentoContabil.create({
          data: {
            tenantId,
            empresaId,
            competencia,
            data: nowBR(),
            historico: `DAS Simples Nacional ${competencia}`,
            partidas: [
              {
                conta: '6.1.1.01',
                descricao: 'Simples Nacional (DAS)',
                valor: valorDAS.toString(),
                tipo: 'DEBITO',
              },
              {
                conta: '2.1.4.05',
                descricao: 'Simples Nacional a recolher',
                valor: valorDAS.toString(),
                tipo: 'CREDITO',
              },
            ] as any,
          },
        })
      }
    }
  }
}
