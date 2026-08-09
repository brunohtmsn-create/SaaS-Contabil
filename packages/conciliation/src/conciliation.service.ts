import { getPrismaClient, TipoEventoAudit } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { parsePeriodo } from '@saas-contabil/shared'
import { NFSeTomadaReconciler } from './nfse-tomada.reconciler.js'
import { NFSeEmitidaReconciler } from './nfse-emitida.reconciler.js'
import type { ResultadoConciliacao } from './types.js'

type TipoNFSe = 'NFSE_TOMADA' | 'NFSE_EMITIDA'

const STATUS_DB: Record<ResultadoConciliacao['status'], string> = {
  CONCILIADA: 'CONCILIADO',
  PENDENTE_REVISAO: 'PENDENTE_REVISAO',
  DIVERGENTE: 'DIVERGENTE',
}

const EVENTO_AUDIT: Record<ResultadoConciliacao['status'], TipoEventoAudit> = {
  CONCILIADA: 'CONCILIADA_AUTOMATICO',
  PENDENTE_REVISAO: 'PENDENTE_REVISAO_HUMANA',
  DIVERGENTE: 'DIVERGENCIA_DETECTADA',
}

export class ConciliationService {
  private db = getPrismaClient()
  private audit = new AuditService()
  private nfseTomadaReconciler = new NFSeTomadaReconciler()
  private nfseEmitidaReconciler = new NFSeEmitidaReconciler()

  async conciliarNFSeTomadas(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoConciliacao[]> {
    return this.conciliarNFSe(
      'NFSE_TOMADA',
      this.nfseTomadaReconciler,
      tenantId,
      empresaId,
      competencia
    )
  }

  async conciliarNFSeEmitidas(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoConciliacao[]> {
    return this.conciliarNFSe(
      'NFSE_EMITIDA',
      this.nfseEmitidaReconciler,
      tenantId,
      empresaId,
      competencia
    )
  }

  async conciliarNFCe(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoConciliacao[]> {
    const { inicio, fim } = parsePeriodo(competencia)

    const docs = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        tipo: 'NFCE',
        dataCompetencia: { gte: inicio, lte: fim },
        status: { in: ['NORMALIZADO', 'VALIDADO'] },
      },
    })

    if (docs.length > 0) {
      await this.db.documentoFiscal.updateMany({
        where: { id: { in: docs.map((d) => d.id) } },
        data: { status: 'CONCILIADO' },
      })
    }

    return docs.map((doc) => ({
      documentoId: doc.id,
      score: 100,
      status: 'CONCILIADA' as const,
      detalhes: { cnpjPrestador: 30, valorServico: 35, competencia: 20, numero: 15, total: 100 },
      mensagem: 'NFC-e validada',
    }))
  }

  private async conciliarNFSe(
    tipo: TipoNFSe,
    reconciler: NFSeTomadaReconciler | NFSeEmitidaReconciler,
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoConciliacao[]> {
    const { inicio, fim } = parsePeriodo(competencia)
    const empresa = await this.db.empresaCliente.findUnique({
      where: { id: empresaId },
      select: { cnpj: true },
    })
    const cnpj = empresa?.cnpj ?? ''

    const docs = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        tipo,
        dataCompetencia: { gte: inicio, lte: fim },
        status: { in: ['NORMALIZADO', 'VALIDADO'] },
      },
    })

    const resultados: ResultadoConciliacao[] = []
    const alertas: Array<{ doc: (typeof docs)[0]; resultado: ResultadoConciliacao }> = []

    for (const doc of docs) {
      const resultado = await reconciler.reconciliar(doc, tenantId)
      resultados.push(resultado)
      if (resultado.status === 'PENDENTE_REVISAO' || resultado.status === 'DIVERGENTE') {
        alertas.push({ doc, resultado })
      }
    }

    await Promise.all([
      ...resultados.map((resultado, i) =>
        this.db.documentoFiscal.update({
          where: { id: docs[i]!.id },
          data: { status: STATUS_DB[resultado.status] as any },
        })
      ),
      ...resultados.map((resultado, i) =>
        this.audit.registrar({
          tenantId,
          cnpj,
          entidadeTipo: 'DOCUMENTO_FISCAL',
          entidadeId: docs[i]!.id,
          evento: EVENTO_AUDIT[resultado.status],
          estadoNovo: resultado,
          responsavel: 'sistema',
          responsavelTipo: 'SISTEMA',
          score: resultado.score,
        })
      ),
      alertas.length > 0
        ? this.db.alerta.createMany({
            data: alertas.map(({ doc, resultado }) => ({
              tenantId,
              empresaId,
              tipo: 'DIVERGENCIA_CONCILIACAO',
              mensagem: `Divergência na conciliação do documento ${doc.id}: ${resultado.mensagem}`,
              dados: resultado as any,
            })),
          })
        : Promise.resolve(),
    ])

    return resultados
  }
}
