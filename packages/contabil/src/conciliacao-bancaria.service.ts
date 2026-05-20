import { getPrismaClient, TransacaoBancaria, DocumentoFiscal } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo } from '@saas-contabil/shared'

export class ConciliacaoBancariaService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async conciliar(tenantId: string, empresaId: string, competencia: string): Promise<void> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const { inicio, fim } = parsePeriodo(competencia)

    const transacoes = await this.db.transacaoBancaria.findMany({
      where: { tenantId, empresaId, data: { gte: inicio, lte: fim }, status: 'NAO_CONCILIADA' },
    })

    const docs = await this.db.documentoFiscal.findMany({
      where: { tenantId, empresaId, dataCompetencia: { gte: inicio, lte: fim }, status: 'CONCILIADO' },
    })

    for (const tx of transacoes) {
      const match = this.encontrarMatch(tx, docs)
      if (match) {
        await this.db.transacaoBancaria.update({
          where: { id: tx.id },
          data: { status: 'CONCILIADA', documentoId: match.id },
        })

        await this.audit.registrar({
          tenantId,
          cnpj: empresa.cnpj,
          entidadeTipo: 'LANCAMENTO_CONTABIL',
          entidadeId: tx.id,
          evento: 'CONCILIACAO_BANCARIA',
          estadoNovo: { transacaoId: tx.id, documentoId: match.id },
          responsavel: 'sistema',
          responsavelTipo: 'SISTEMA',
        })
      }
    }
  }

  private encontrarMatch(tx: TransacaoBancaria, docs: DocumentoFiscal[]): DocumentoFiscal | null {
    const valorTx = new Decimal(tx.valor.toString())
    const TOLERANCIA_DIAS = 2

    for (const doc of docs) {
      const valorDoc = new Decimal(doc.valorTotal.toString())

      if (!valorTx.minus(valorDoc).abs().lte(new Decimal('0.02'))) continue

      const diffDias = Math.abs(
        (tx.data.getTime() - doc.dataEmissao.getTime()) / (1000 * 60 * 60 * 24)
      )

      if (diffDias <= TOLERANCIA_DIAS) return doc
    }

    return null
  }
}
