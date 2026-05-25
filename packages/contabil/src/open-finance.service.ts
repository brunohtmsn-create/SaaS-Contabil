import axios from 'axios'
import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, formatDate } from '@saas-contabil/shared'
import { toZonedTime } from 'date-fns-tz'
import { startOfMonth, endOfMonth } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

export type OpenFinanceConta = {
  id: string
  banco: string
  agencia: string
  numero: string
  tipo: 'CORRENTE' | 'POUPANCA'
}

export type OpenFinanceTransacao = {
  id: string
  data: string // ISO date
  valor: string // Decimal string, negativo = débito
  descricao: string
  tipo: 'CREDIT' | 'DEBIT'
  categoria?: string
}

type ImportarExtratoParams = {
  tenantId: string
  empresaId: string
  conta: OpenFinanceConta
  periodo: { inicio: Date; fim: Date }
}

// ─── Mock data helpers ────────────────────────────────────────────────────────

const DESCRICOES_CREDITO = [
  'PIX RECEBIDO',
  'TED ENTRADA',
  'DEPOSITO BOLETO',
  'CREDITO PAGAMENTO',
  'TRANSFERENCIA RECEBIDA',
  'PAGAMENTO SERVICOS',
  'RECEBIMENTO NFS-E',
]

const DESCRICOES_DEBITO = [
  'PIX ENVIADO',
  'TED SAIDA',
  'PAGAMENTO BOLETO',
  'DEBITO AUTOMATICO',
  'TARIFA BANCARIA',
  'PAGAMENTO FORNECEDOR',
  'TRANSFERENCIA REALIZADA',
]

function gerarTransacoesMock(contaId: string, inicio: Date, fim: Date): OpenFinanceTransacao[] {
  const qtd = Math.floor(Math.random() * 6) + 5 // 5 a 10 transações
  const transacoes: OpenFinanceTransacao[] = []
  const diffMs = fim.getTime() - inicio.getTime()

  for (let i = 0; i < qtd; i++) {
    const isCredito = Math.random() > 0.45
    const valorBase = Math.random() * (50000 - 100) + 100 // R$100 a R$50.000
    const valor = new Decimal(valorBase.toFixed(2))
    const data = new Date(inicio.getTime() + Math.random() * diffMs)
    const descricoes = isCredito ? DESCRICOES_CREDITO : DESCRICOES_DEBITO
    const descricao = descricoes[Math.floor(Math.random() * descricoes.length)]!

    transacoes.push({
      id: `mock-${contaId}-${i}-${Date.now()}`,
      data: formatDate(data, "yyyy-MM-dd'T'HH:mm:ss'Z'"),
      valor: isCredito ? valor.toString() : valor.negated().toString(),
      descricao,
      tipo: isCredito ? 'CREDIT' : 'DEBIT',
      categoria: isCredito ? 'RECEITA' : 'DESPESA',
    })
  }

  return transacoes
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class OpenFinanceService {
  private db = getPrismaClient()
  private audit = new AuditService()
  private apiUrl = process.env['OPEN_FINANCE_API_URL']

  /**
   * Importa o extrato de uma conta bancária via Open Finance API.
   * Se OPEN_FINANCE_API_URL não estiver configurada, usa dados mock.
   *
   * @returns Número de transações efetivamente importadas (sem duplicatas)
   */
  async importarExtrato(
    tenantId: string,
    empresaId: string,
    conta: OpenFinanceConta,
    periodo: { inicio: Date; fim: Date }
  ): Promise<number> {
    const empresa = await this.db.empresaCliente.findUnique({
      where: { id: empresaId },
      select: { cnpj: true },
    })
    if (!empresa) throw new Error(`Empresa não encontrada: ${empresaId}`)

    const transacoes = await this.buscarTransacoes({ tenantId, empresaId, conta, periodo })

    let importadas = 0

    for (const tx of transacoes) {
      const externalId = tx.id

      // Evitar duplicatas via externalId armazenado na coluna descricao com prefixo
      // (o schema não tem campo externalId — usamos busca por banco+agencia+conta+externalId na descricao)
      const jaExiste = await this.db.transacaoBancaria.findFirst({
        where: {
          tenantId,
          empresaId,
          banco: conta.banco,
          agencia: conta.agencia,
          conta: conta.numero,
          descricao: { contains: `[OF:${externalId}]` },
        },
        select: { id: true },
      })

      if (jaExiste) continue

      const valorDecimal = new Decimal(tx.valor)
      const tipo = this.mapearTipo(tx.tipo)
      const valorAbsoluto = valorDecimal.abs()
      const dataTransacao = toZonedTime(new Date(tx.data), 'America/Sao_Paulo')

      await this.db.transacaoBancaria.create({
        data: {
          tenantId,
          empresaId,
          data: dataTransacao,
          valor: valorAbsoluto.toDecimalPlaces(2).toNumber(),
          tipo,
          descricao: this.formatarDescricao(tx),
          banco: conta.banco,
          agencia: conta.agencia,
          conta: conta.numero,
          status: 'NAO_CONCILIADA',
        },
      })

      importadas++
    }

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'LANCAMENTO_CONTABIL',
      entidadeId: empresaId,
      evento: 'CONCILIACAO_BANCARIA',
      estadoNovo: {
        acao: 'IMPORTACAO_OPEN_FINANCE',
        banco: conta.banco,
        agencia: conta.agencia,
        conta: conta.numero,
        transacoesRecebidas: transacoes.length,
        transacoesImportadas: importadas,
        periodo: {
          inicio: periodo.inicio.toISOString(),
          fim: periodo.fim.toISOString(),
        },
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return importadas
  }

  /**
   * Importa extratos de todas as contas bancárias vinculadas à empresa.
   * Período: mês atual (America/Sao_Paulo).
   */
  async sincronizarContas(tenantId: string, empresaId: string): Promise<void> {
    const agora = toZonedTime(new Date(), 'America/Sao_Paulo')
    const inicio = startOfMonth(agora)
    const fim = endOfMonth(agora)

    const contas = await this.listarContas(tenantId, empresaId)

    const resultados = await Promise.allSettled(
      contas.map((conta) => this.importarExtrato(tenantId, empresaId, conta, { inicio, fim }))
    )

    let totalImportadas = 0
    let erros = 0

    for (const resultado of resultados) {
      if (resultado.status === 'fulfilled') {
        totalImportadas += resultado.value
      } else {
        erros++
        console.error('[OpenFinanceService] Erro ao importar extrato:', resultado.reason)
      }
    }

    console.log(
      `[OpenFinanceService] Sincronização concluída — tenant=${tenantId} empresa=${empresaId} ` +
        `contas=${contas.length} importadas=${totalImportadas} erros=${erros}`
    )
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async listarContas(tenantId: string, empresaId: string): Promise<OpenFinanceConta[]> {
    if (!this.apiUrl) {
      // Mock: retorna uma conta corrente genérica para desenvolvimento
      return [
        {
          id: `mock-conta-${empresaId}`,
          banco: 'Banco Mock',
          agencia: '0001',
          numero: '00001-0',
          tipo: 'CORRENTE',
        },
      ]
    }

    const response = await axios.get<{ contas: OpenFinanceConta[] }>(`${this.apiUrl}/contas`, {
      params: { tenantId, empresaId },
      headers: { Authorization: `Bearer ${process.env['OPEN_FINANCE_TOKEN'] ?? ''}` },
      timeout: 15_000,
    })

    return response.data.contas
  }

  private async buscarTransacoes(params: ImportarExtratoParams): Promise<OpenFinanceTransacao[]> {
    const { conta, periodo } = params

    if (!this.apiUrl) {
      return gerarTransacoesMock(conta.id, periodo.inicio, periodo.fim)
    }

    const response = await axios.get<{ transacoes: OpenFinanceTransacao[] }>(
      `${this.apiUrl}/contas/${conta.id}/transacoes`,
      {
        params: {
          dataInicio: formatDate(periodo.inicio, 'yyyy-MM-dd'),
          dataFim: formatDate(periodo.fim, 'yyyy-MM-dd'),
        },
        headers: { Authorization: `Bearer ${process.env['OPEN_FINANCE_TOKEN'] ?? ''}` },
        timeout: 30_000,
      }
    )

    return response.data.transacoes
  }

  private mapearTipo(tipo: string): 'CREDITO' | 'DEBITO' {
    return tipo === 'CREDIT' ? 'CREDITO' : 'DEBITO'
  }

  private formatarDescricao(transacao: OpenFinanceTransacao): string {
    const categoria = transacao.categoria ? ` [${transacao.categoria}]` : ''
    return `${transacao.descricao}${categoria} [OF:${transacao.id}]`
  }
}
