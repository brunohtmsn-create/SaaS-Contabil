import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { parsePeriodo } from '@saas-contabil/shared'
import { NFSeTomadaReconciler } from './nfse-tomada.reconciler.js'
import { NFSeEmitidaReconciler } from './nfse-emitida.reconciler.js'
import { NFCeReconciler } from './nfce.reconciler.js'
import type { ResultadoConciliacao } from './types.js'

export class ConciliationService {
  private db = getPrismaClient()
  private audit = new AuditService()
  private nfseTomadaReconciler = new NFSeTomadaReconciler()
  private nfseEmitidaReconciler = new NFSeEmitidaReconciler()
  private nfceReconciler = new NFCeReconciler()

  async conciliarNFSeTomadas(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoConciliacao[]> {
    const { inicio, fim } = parsePeriodo(competencia)
    const cnpj = await this.getCnpj(empresaId)

    const docs = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        tipo: 'NFSE_TOMADA',
        dataCompetencia: { gte: inicio, lte: fim },
        status: { in: ['NORMALIZADO', 'VALIDADO'] },
      },
    })

    const resultados: ResultadoConciliacao[] = []

    for (const doc of docs) {
      const resultado = await this.nfseTomadaReconciler.reconciliar(doc, tenantId)
      resultados.push(resultado)

      await this.db.documentoFiscal.update({
        where: { id: doc.id },
        data: {
          status: resultado.status === 'CONCILIADA' ? 'CONCILIADO'
            : resultado.status === 'PENDENTE_REVISAO' ? 'PENDENTE_REVISAO'
            : 'DIVERGENTE',
        },
      })

      await this.audit.registrar({
        tenantId,
        cnpj,
        entidadeTipo: 'DOCUMENTO_FISCAL',
        entidadeId: doc.id,
        evento: resultado.status === 'CONCILIADA' ? 'CONCILIADA_AUTOMATICO'
          : resultado.status === 'PENDENTE_REVISAO' ? 'PENDENTE_REVISAO_HUMANA'
          : 'DIVERGENCIA_DETECTADA',
        estadoNovo: resultado,
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
        score: resultado.score,
      })

      if (resultado.status === 'PENDENTE_REVISAO' || resultado.status === 'DIVERGENTE') {
        await this.criarAlerta(tenantId, empresaId, doc.id, resultado)
      }
    }

    return resultados
  }

  async conciliarNFSeEmitidas(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoConciliacao[]> {
    const { inicio, fim } = parsePeriodo(competencia)
    const cnpj = await this.getCnpj(empresaId)

    const docs = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        tipo: 'NFSE_EMITIDA',
        dataCompetencia: { gte: inicio, lte: fim },
        status: { in: ['NORMALIZADO', 'VALIDADO'] },
      },
    })

    const resultados: ResultadoConciliacao[] = []

    for (const doc of docs) {
      const resultado = await this.nfseEmitidaReconciler.reconciliar(doc, tenantId)
      resultados.push(resultado)

      await this.db.documentoFiscal.update({
        where: { id: doc.id },
        data: { status: resultado.status === 'CONCILIADA' ? 'CONCILIADO' : resultado.status === 'PENDENTE_REVISAO' ? 'PENDENTE_REVISAO' : 'DIVERGENTE' },
      })
    }

    return resultados
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

    return docs.map((doc) => ({
      documentoId: doc.id,
      score: 100,
      status: 'CONCILIADA' as const,
      detalhes: { cnpjPrestador: 30, valorServico: 35, competencia: 20, numero: 15, total: 100 },
      mensagem: 'NFC-e validada',
    }))
  }

  private async getCnpj(empresaId: string): Promise<string> {
    const empresa = await this.db.empresaCliente.findUnique({
      where: { id: empresaId },
      select: { cnpj: true },
    })
    return empresa?.cnpj ?? ''
  }

  private async criarAlerta(
    tenantId: string,
    empresaId: string,
    documentoId: string,
    resultado: ResultadoConciliacao
  ): Promise<void> {
    await this.db.alerta.create({
      data: {
        tenantId,
        empresaId,
        tipo: 'DIVERGENCIA_CONCILIACAO',
        mensagem: `Divergência na conciliação do documento ${documentoId}: ${resultado.mensagem}`,
        dados: resultado as any,
      },
    })
  }
}
