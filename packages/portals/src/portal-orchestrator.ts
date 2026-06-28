import { getPrismaClient } from '@saas-contabil/database'
import { Decimal, nowBR } from '@saas-contabil/shared'
import { EcacPortal } from './ecac.portal.js'
import { SimplesNacionalPortal } from './simples-nacional.portal.js'
import { SefazSpPortal } from './sefaz-sp.portal.js'
import { DCTFWebPortal } from './dctfweb.portal.js'

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
  private sefazSp = new SefazSpPortal()
  private dctfweb = new DCTFWebPortal()

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
        iniciadoEm: nowBR(),
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

        case 'SEFAZ_SP:TRANSMITIR_DESTDA': {
          const d = job.dados as { certSenha?: string } | undefined
          resultado = await this.sefazSp.transmitirDeSTDA(
            job.tenantId,
            job.empresaId,
            job.cnpj,
            job.competencia ?? '',
            credencialBuffer,
            d?.certSenha ?? ''
          )
          break
        }

        case 'SEFAZ_SP:EMITIR_GNRE': {
          const d = job.dados as { uf?: string; valor?: string; codReceita?: string } | undefined
          if (!d?.valor) throw new Error('GNRE requer campo valor nos dados do job')
          resultado = await this.sefazSp.emitirGNRE(
            job.tenantId,
            job.empresaId,
            job.cnpj,
            job.competencia ?? '',
            d?.uf ?? 'SP',
            new Decimal(d.valor),
            d?.codReceita ?? '10008-0'
          )
          break
        }

        case 'SEFAZ_SP:EMITIR_GNRE_LOTE': {
          const d = job.dados as
            | { gnres?: Array<{ uf: string; valor: string; codReceita: string }> }
            | undefined
          const gnres = (d?.gnres ?? []).map((g) => ({
            uf: g.uf,
            valor: new Decimal(g.valor),
            codReceita: g.codReceita,
          }))
          resultado = await this.sefazSp.emitirGNRELote(
            job.tenantId,
            job.empresaId,
            job.cnpj,
            job.competencia ?? '',
            gnres
          )
          break
        }

        case 'DCTFWEB:TRANSMITIR': {
          const d = job.dados as { certSenha?: string } | undefined
          resultado = await this.dctfweb.transmitir(
            job.tenantId,
            job.empresaId,
            job.cnpj,
            job.competencia ?? '',
            credencialBuffer,
            d?.certSenha ?? ''
          )
          break
        }

        case 'DCTFWEB:CONSULTAR': {
          const d = job.dados as { certSenha?: string } | undefined
          resultado = await this.dctfweb.consultar(
            job.tenantId,
            job.empresaId,
            job.cnpj,
            job.competencia ?? '',
            credencialBuffer,
            d?.certSenha ?? ''
          )
          break
        }

        default:
          throw new Error(`Operação não suportada: ${job.portal}:${job.operacao}`)
      }

      await this.db.portalJob.update({
        where: { id: dbJob.id },
        data: { status: 'CONCLUIDO', resultado: resultado as any, concluidoEm: nowBR() },
      })

      return resultado
    } catch (err) {
      await this.db.portalJob.update({
        where: { id: dbJob.id },
        data: { status: 'ERRO', erro: String(err), concluidoEm: nowBR() },
      })
      throw err
    }
  }
}
