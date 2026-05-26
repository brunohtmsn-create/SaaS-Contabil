import { getPrismaClient, DocumentoFiscal as PrismaDoc } from '@saas-contabil/database'
import { sha256, limparCNPJ, formatCompetencia, parsePeriodo, Decimal } from '@saas-contabil/shared'
import { AuditService } from '@saas-contabil/audit'
import type { DocumentoRaw } from './types.js'

export class NormalizerService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async normalizar(
    raw: DocumentoRaw,
    tenantId: string,
    empresaId: string
  ): Promise<PrismaDoc | null> {
    const chaveUnica = this.gerarChaveUnica(raw)

    const existing = await this.db.documentoFiscal.findFirst({
      where: { tenantId, chaveUnica },
    })

    if (existing) {
      return existing
    }

    const { inicio: dataCompetencia } = parsePeriodo(formatCompetencia(raw.dataEmissao))

    const doc = await this.db.documentoFiscal.create({
      data: {
        tenantId,
        empresaId,
        chaveUnica,
        tipo: raw.tipo as any,
        direcao: this.inferirDirecao(raw),
        chaveAcesso: raw.chaveAcesso ?? null,
        numero: raw.numero,
        serie: raw.serie ?? null,
        dataEmissao: raw.dataEmissao,
        dataCompetencia,
        cfop: raw.cfop ?? null,
        cst: null,
        cstPis: null,
        cstCofins: null,
        cnpjEmitente: limparCNPJ(raw.cnpjEmitente),
        nomeEmitente: raw.nomeEmitente,
        ufEmitente: raw.ufEmitente ?? 'SP',
        municipioEmitente: raw.municipioEmitente ?? null,
        ibgeEmitente: raw.ibgeEmitente ?? null,
        cnpjDestinatario: limparCNPJ(raw.cnpjDestinatario),
        cpfDestinatario: raw.cpfDestinatario ?? null,
        ufDestinatario: raw.ufDestinatario ?? 'SP',
        valorTotal: raw.valorTotal,
        valorProdutos: raw.valorProdutos ?? new Decimal(0),
        valorServicos: raw.valorServicos ?? new Decimal(0),
        valorIcms: raw.valorIcms ?? new Decimal(0),
        valorIcmsSt: raw.valorIcmsSt ?? new Decimal(0),
        valorIpi: raw.valorIpi ?? new Decimal(0),
        valorPis: raw.valorPis ?? new Decimal(0),
        valorCofins: raw.valorCofins ?? new Decimal(0),
        valorIss: raw.valorIss ?? new Decimal(0),
        valorIssRetido: raw.valorIssRetido ?? new Decimal(0),
        valorIrrf: raw.valorIrrf ?? new Decimal(0),
        valorInss: raw.valorInss ?? new Decimal(0),
        valorCsll: raw.valorCsll ?? new Decimal(0),
        aliquotaIss: raw.aliquotaIss ?? null,
        aliquotaIcms: raw.aliquotaIcms ?? null,
        baseCalcIcms: raw.baseCalcIcms ?? new Decimal(0),
        baseCalcIss: raw.baseCalcIss ?? new Decimal(0),
        operacaoInterestadual: (raw.ufEmitente ?? '') !== (raw.ufDestinatario ?? ''),
        ufOrigem: raw.ufEmitente ?? null,
        ufDestino: raw.ufDestinatario ?? null,
        fonte: raw.fonte as any,
        municipioIBGE: raw.municipioIBGE ?? null,
        xmlS3Key: raw.xmlS3Key ?? null,
        pdfS3Key: raw.pdfS3Key ?? null,
        hashIntegridade: sha256(raw.xmlContent ?? JSON.stringify(raw)),
        status: 'NORMALIZADO',
        capturedAt: new Date(),
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: doc.cnpjEmitente,
      entidadeTipo: 'DOCUMENTO_FISCAL',
      entidadeId: doc.id,
      evento: 'DOCUMENTO_NORMALIZADO',
      estadoNovo: { chaveUnica, tipo: raw.tipo },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return doc
  }

  private gerarChaveUnica(raw: DocumentoRaw): string {
    const partes: string[] = []

    if (raw.tipo === 'NFE' || raw.tipo === 'NFCE' || raw.tipo === 'CTE') {
      partes.push(raw.chaveAcesso ?? `${raw.cnpjEmitente}-${raw.numero}-${raw.serie}`)
    } else {
      partes.push(
        limparCNPJ(raw.cnpjEmitente),
        limparCNPJ(raw.cnpjDestinatario),
        raw.numero.padStart(15, '0'),
        formatCompetencia(raw.dataEmissao),
        raw.municipioIBGE ?? '',
        (raw.valorServicos ?? raw.valorTotal).toFixed(2)
      )
    }

    return sha256(partes.join('|'))
  }

  private inferirDirecao(raw: DocumentoRaw): 'ENTRADA' | 'SAIDA' | 'PRESTACAO' {
    if (raw.tipo === 'NFSE_EMITIDA') return 'PRESTACAO'
    if (raw.tipo === 'NFSE_TOMADA') return 'ENTRADA'
    if (raw.tipo === 'NFCE') return 'SAIDA'
    if (raw.direcao) return raw.direcao as any
    return 'ENTRADA'
  }
}
