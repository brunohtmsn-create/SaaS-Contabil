import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo, nowBR } from '@saas-contabil/shared'

export class DepreciacaoService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async calcular(tenantId: string, empresaId: string, competencia: string): Promise<void> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const bens = await this.db.bemAtivo.findMany({
      where: { tenantId, empresaId, status: 'ATIVO' },
    })

    for (const bem of bens) {
      const valorAquisicao = new Decimal(bem.valorAquisicao.toString())
      const valorResidual = new Decimal(bem.valorResidual.toString())
      const vidaUtilMeses = bem.vidaUtil * 12

      const depreciacaoMensal = valorAquisicao.minus(valorResidual).div(vidaUtilMeses).toDecimalPlaces(2)

      if (depreciacaoMensal.lte(0)) continue

      await this.db.lancamentoContabil.create({
        data: {
          tenantId,
          empresaId,
          competencia,
          data: nowBR(),
          historico: `Depreciação — ${bem.descricao}`,
          partidas: [
            { conta: '6.1.5.01', descricao: 'Depreciação do período', valor: depreciacaoMensal.toString(), tipo: 'DEBITO' },
            { conta: '1.2.1.02', descricao: 'Depreciação acumulada', valor: depreciacaoMensal.toString(), tipo: 'CREDITO' },
          ] as any,
        },
      })

      await this.audit.registrar({
        tenantId,
        cnpj: empresa.cnpj,
        entidadeTipo: 'LANCAMENTO_CONTABIL',
        entidadeId: bem.id,
        evento: 'DEPRECIACAO_CALCULADA',
        estadoNovo: { bemId: bem.id, depreciacao: depreciacaoMensal.toFixed(2) },
        responsavel: 'sistema',
        responsavelTipo: 'SISTEMA',
      })
    }
  }
}
