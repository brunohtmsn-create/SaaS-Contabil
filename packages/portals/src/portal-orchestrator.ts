import { getPrismaClient } from '@saas-contabil/database'
import { EcacPortal } from './ecac.portal.js'
import { SimplesNacionalPortal } from './simples-nacional.portal.js'

export type PortalJob = {
  cnpj: string
  tenantId: string
  empresaId: string
  portal: string
  operacao: string
  credencialId: string
  prioridade: 1 | 2 | 3
  competencia?: string
  dados?: object
}

export class PortalOrchestrator {
  private db = getPrismaClient()
  private ecac = new EcacPortal()
  private simplesnacional = new SimplesNacionalPortal()

  async executar(job: PortalJob, credencialBuffer: Buffer): Promise<unknown> {
    const dbJob = await this.db.portalJob.create({
      data: {
        tenantId: job.tenantId,
        empresaId: job.empresaId,
        cnpj: job.cnpj,
        portal: job.portal as any,
        operacao: job.operacao,
        credencialId: job.credencialId,
        prioridade: job.prioridade,
        status: 'EM_EXECUCAO',
        iniciadoEm: new Date(),
      },
    })

    try {
      let resultado: unknown

      switch (`${job.portal}:${job.operacao}`) {
        case 'ECAC:CONSULTA_SITUACAO':
          resultado = await this.ecac.consultarSituacaoFiscal(
            job.tenantId,
            job.empresaId,
            job.cnpj,
            credencialBuffer
          )
          break

        case 'ECAC:CERTIDAO':
          resultado = await this.ecac.baixarCertidao(
            job.tenantId,
            job.empresaId,
            job.cnpj,
            credencialBuffer,
            job.competencia ?? ''
          )
          break

        case 'SIMPLES_NACIONAL:TRANSMITIR_PGDAS':
          resultado = await this.simplesnacional.transmitirPGDAS(
            job.tenantId,
            job.empresaId,
            job.cnpj,
            job.competencia ?? '',
            job.dados ?? {}
          )
          break

        default:
          throw new Error(`Operação não suportada: ${job.portal}:${job.operacao}`)
      }

      await this.db.portalJob.update({
        where: { id: dbJob.id },
        data: { status: 'CONCLUIDO', resultado: resultado as any, concluidoEm: new Date() },
      })

      return resultado
    } catch (err) {
      await this.db.portalJob.update({
        where: { id: dbJob.id },
        data: { status: 'ERRO', erro: String(err), concluidoEm: new Date() },
      })
      throw err
    }
  }
}
