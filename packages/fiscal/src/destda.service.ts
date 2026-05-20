import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { parsePeriodo } from '@saas-contabil/shared'

export class DeSTDAService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async gerar(tenantId: string, empresaId: string, competencia: string): Promise<string> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const { inicio, fim } = parsePeriodo(competencia)

    const apuracaoDifal = await this.db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'DIFAL' },
    })

    const lines: string[] = []
    lines.push(`|0000|${competencia.replace('-', '')}|${empresa.cnpj}|${empresa.razaoSocial}|${empresa.uf}|1|`)
    lines.push(`|0001|1|`)

    if (apuracaoDifal?.dados) {
      lines.push(`|E300|${competencia.replace('-', '')}|01|`)
      lines.push(`|E310|0.00|0.00|0.00|0.00|0.00|`)
    }

    lines.push(`|9001|0|`)
    lines.push(`|9900|0000|1|`)
    lines.push(`|9900|0001|1|`)
    lines.push(`|9999|${lines.length + 1}|`)

    const content = lines.join('\r\n')

    await this.db.apuracaoFiscal.upsert({
      where: { tenantId_empresaId_competencia_tipo: { tenantId, empresaId, competencia, tipo: 'DESTDA' } },
      update: { dados: { content } as any, status: 'CALCULADO' },
      create: { tenantId, empresaId, competencia, tipo: 'DESTDA', dados: { content } as any, status: 'CALCULADO' },
    })

    await this.audit.registrar({
      tenantId, cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL', entidadeId: empresaId,
      evento: 'DESTDA_GERADO', estadoNovo: { competencia, linhas: lines.length },
      responsavel: 'sistema', responsavelTipo: 'SISTEMA',
    })

    return content
  }
}
