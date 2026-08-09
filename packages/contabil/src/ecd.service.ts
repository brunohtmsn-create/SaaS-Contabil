import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { StorageService, S3KeyBuilder } from '@saas-contabil/storage'
import { Decimal } from '@saas-contabil/shared'
import type { ResultadoECD } from './types.js'

export class ECDService {
  private db = getPrismaClient()
  private audit = new AuditService()
  private storage = new StorageService()

  async gerar(tenantId: string, empresaId: string, ano: number): Promise<ResultadoECD> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_PRESUMIDO' && empresa.regime !== 'LUCRO_REAL')
      throw new Error('ECD é obrigatória apenas para Lucro Presumido ou Lucro Real')

    const lancamentos = await this.db.lancamentoContabil.findMany({
      where: {
        tenantId,
        empresaId,
        competencia: { startsWith: `${ano}-` },
      },
      orderBy: { data: 'asc' },
    })

    const linhas: string[] = []

    linhas.push(`|0000|${ano}0101|${ano}1231|${empresa.cnpj}|${empresa.razaoSocial}|||1|G||||||`)
    linhas.push(`|0001|1|`)
    linhas.push(`|I001|1|`)
    linhas.push(`|I010|${empresa.cnpj}|0|`)

    for (const lanc of lancamentos) {
      const partidas = lanc.partidas as any[]
      const dataStr = lanc.data.toISOString().split('T')[0]!.replace(/-/g, '')

      linhas.push(`|I250|${dataStr}|${lanc.id}|${lanc.historico}|${partidas.length}|`)

      for (const partida of partidas) {
        const valor = new Decimal(partida.valor).toFixed(2)
        linhas.push(
          `|I250|${dataStr}|${lanc.id}|${partida.conta}|${valor}|${partida.tipo === 'DEBITO' ? 'D' : 'C'}|`
        )
      }
    }

    linhas.push(`|I999|${linhas.length + 1}|`)
    linhas.push(`|9001|0|`)
    linhas.push(`|9900|0000|1|`)
    linhas.push(`|9999|${linhas.length + 1}|`)

    const conteudo = linhas.join('\r\n')
    const s3Key = S3KeyBuilder.ecdArquivo(empresa.cnpj, String(ano))

    await this.storage.upload(s3Key, Buffer.from(conteudo, 'utf8'), 'text/plain')

    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia: `${ano}`,
          tipo: 'ECD',
        },
      },
      update: { dados: { s3Key, linhas: linhas.length } as any, status: 'CALCULADO' },
      create: {
        tenantId,
        empresaId,
        competencia: `${ano}`,
        tipo: 'ECD',
        dados: { s3Key, linhas: linhas.length } as any,
        status: 'CALCULADO',
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL',
      entidadeId: empresaId,
      evento: 'ECD_GERADA',
      estadoNovo: { s3Key, ano, totalLancamentos: lancamentos.length },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return {
      cnpj: empresa.cnpj,
      ano,
      totalLancamentos: lancamentos.length,
      blocos: ['0', 'I', '9'],
      conteudo,
    }
  }
}
