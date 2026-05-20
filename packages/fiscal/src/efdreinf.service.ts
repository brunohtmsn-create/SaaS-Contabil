import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo } from '@saas-contabil/shared'
import type { R2010, R4020, R4080 } from './types.js'

export class EFDReinfService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async processar(tenantId: string, empresaId: string, competencia: string): Promise<void> {
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

    const r2010: R2010[] = []
    const r4020: R4020[] = []
    const r4080: R4080[] = []

    for (const doc of docs) {
      const valorInss = new Decimal(doc.valorInss.toString())
      const valorIrrf = new Decimal(doc.valorIrrf.toString())
      const valorIssRetido = new Decimal(doc.valorIssRetido.toString())

      if (doc.tipo === 'NFSE_TOMADA' && valorInss.gt(0)) {
        r2010.push({
          cnpjPrestador: doc.cnpjEmitente,
          classificacaoServ: '01',
          indObra: '0',
          vrBcCpContrib: new Decimal(doc.valorServicos.toString()),
          aliqRet: new Decimal(11),
          vrRetencao: valorInss,
          documentoIds: [doc.id],
        })
      }

      if (doc.tipo === 'NFSE_TOMADA' && valorIrrf.gt(0)) {
        r4020.push({
          cnpjBenef: doc.cnpjEmitente,
          natRend: '01',
          dtFG: doc.dataEmissao,
          vrBruto: new Decimal(doc.valorTotal.toString()),
          vrBaseIR: new Decimal(doc.valorTotal.toString()),
          aliqIR: new Decimal(1.5),
          vrIR: valorIrrf,
          vrBaseCSLL: new Decimal(0),
          aliqCSLL: new Decimal(0),
          vrCSLL: new Decimal(doc.valorCsll.toString()),
        })
      }

      if (doc.tipo === 'NFSE_EMITIDA' && valorIrrf.gt(0)) {
        r4080.push({
          cnpjRetenteFonte: doc.cnpjDestinatario,
          natRend: '01',
          dtFG: doc.dataEmissao,
          vrBruto: new Decimal(doc.valorTotal.toString()),
          vrIR: valorIrrf,
          vrCSLL: new Decimal(doc.valorCsll.toString()),
          vrPIS: new Decimal(doc.valorPis.toString()),
          vrCOFINS: new Decimal(doc.valorCofins.toString()),
          nfseNumero: doc.numero,
        })
      }
    }

    await this.db.apuracaoFiscal.upsert({
      where: { tenantId_empresaId_competencia_tipo: { tenantId, empresaId, competencia, tipo: 'EFD_REINF' } },
      update: { dados: { r2010, r4020, r4080 } as any, status: 'CALCULADO' },
      create: { tenantId, empresaId, competencia, tipo: 'EFD_REINF', dados: { r2010, r4020, r4080 } as any, status: 'CALCULADO' },
    })

    await this.audit.registrar({
      tenantId, cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL', entidadeId: empresaId,
      evento: 'EFDREINF_TRANSMITIDA',
      estadoNovo: { r2010Count: r2010.length, r4020Count: r4020.length, r4080Count: r4080.length },
      responsavel: 'sistema', responsavelTipo: 'SISTEMA',
    })
  }
}
