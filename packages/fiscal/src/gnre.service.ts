import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo } from '@saas-contabil/shared'
import type { ResultadoGNRE } from './types.js'

export class GNREService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async gerar(tenantId: string, empresaId: string, competencia: string): Promise<ResultadoGNRE[]> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const { inicio, fim } = parsePeriodo(competencia)

    const docsDifal = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        valorDifal: { gt: 0 },
      },
    })

    const gnresPorUF = new Map<string, Decimal>()
    const fundoPorUF = new Map<string, Decimal>()

    for (const doc of docsDifal) {
      if (!doc.ufDestino) continue
      const uf = doc.ufDestino
      const difal = new Decimal(doc.valorDifal?.toString() ?? '0')
      const fundo = new Decimal(doc.valorFundoPobreza?.toString() ?? '0')
      gnresPorUF.set(uf, (gnresPorUF.get(uf) ?? new Decimal(0)).plus(difal))
      fundoPorUF.set(uf, (fundoPorUF.get(uf) ?? new Decimal(0)).plus(fundo))
    }

    const resultados: ResultadoGNRE[] = []

    for (const [uf, valor] of gnresPorUF.entries()) {
      if (valor.lte(0)) continue

      resultados.push({
        tipo: 'DIFAL',
        ufDestino: uf,
        codReceita: '10008-0',
        valor,
        competencia,
        cnpjEmitente: empresa.cnpj,
      })

      await this.db.apuracaoFiscal.upsert({
        where: { tenantId_empresaId_competencia_tipo: { tenantId, empresaId, competencia, tipo: 'GNRE' } },
        update: { dados: { gnres: resultados } as any, status: 'CALCULADO' },
        create: { tenantId, empresaId, competencia, tipo: 'GNRE', dados: { gnres: resultados } as any, status: 'CALCULADO' },
      })

      await this.audit.registrar({
        tenantId,
        cnpj: empresa.cnpj,
        entidadeTipo: 'APURACAO_FISCAL',
        entidadeId: empresaId,
        evento: 'GNRE_GERADA',
        estadoNovo: { uf, valor: valor.toFixed(2), tipo: 'DIFAL' },
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
      })
    }

    return resultados
  }
}
