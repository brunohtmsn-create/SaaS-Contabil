import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo, addMeses } from '@saas-contabil/shared'
import type { ResultadoFGTS, ResultadoGRRF } from './types.js'

// Alíquota FGTS: 8% sobre remuneração bruta (Lei 8.036/1990, art. 15)
const ALIQUOTA_FGTS = new Decimal('0.08')

// Multa rescisória sem justa causa: 40% sobre saldo do FGTS (art. 18, § 1º)
const MULTA_RESCISORIA = new Decimal('0.40')

export class FGTSDigitalService {
  private db = getPrismaClient()
  private audit = new AuditService()

  /**
   * Apura o FGTS do mês de competência.
   *
   * 1. Busca lançamentos de folha da competência para calcular a base de cálculo.
   * 2. Aplica alíquota de 8% sobre a remuneração bruta.
   * 3. Persiste ApuracaoFiscal do tipo 'FGTS' (upsert — idempotente).
   * 4. Cria Obrigacao com vencimento no dia 20 do mês seguinte.
   * 5. Registra audit trail.
   *
   * Empresas sem empregados (base = 0) terão a apuração registrada com valor zero
   * sem lançar erro — é responsabilidade do contador verificar se há folha.
   */
  async apurar(tenantId: string, empresaId: string, competencia: string): Promise<ResultadoFGTS> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    // Busca lançamentos de folha da competência
    const lancamentosFolha = await this.db.lancamentoContabil.findMany({
      where: {
        tenantId,
        empresaId,
        competencia,
        OR: [
          { historico: { contains: 'Salário', mode: 'insensitive' } },
          { historico: { contains: 'Salario', mode: 'insensitive' } },
          { historico: { contains: 'Folha', mode: 'insensitive' } },
          { historico: { contains: 'Pro Labore', mode: 'insensitive' } },
          { historico: { contains: 'Pró-Labore', mode: 'insensitive' } },
        ],
      },
      select: { partidas: true },
    })

    // Soma débitos em contas de despesas de pessoal (6.1.x) para obter a base FGTS
    let baseCalculo = new Decimal(0)
    let totalEmpregados = 0
    const empregadosContados = new Set<string>()

    for (const lancamento of lancamentosFolha) {
      const partidas = lancamento.partidas as Array<{
        conta: string
        descricao?: string
        valor: string | number
        tipo: string
        cpf?: string
      }>

      if (!Array.isArray(partidas)) continue

      for (const partida of partidas) {
        if (
          partida.tipo === 'DEBITO' &&
          typeof partida.conta === 'string' &&
          partida.conta.startsWith('6.1.')
        ) {
          baseCalculo = baseCalculo.plus(new Decimal(partida.valor.toString()))

          // Conta empregados únicos pelo CPF quando disponível; caso contrário,
          // cada lançamento de folha representa ao menos 1 empregado
          if (partida.cpf) {
            empregadosContados.add(partida.cpf)
          }
        }
      }
    }

    // Se CPFs foram informados nas partidas usa contagem precisa; caso contrário
    // usa a quantidade de lançamentos de folha encontrados como proxy
    totalEmpregados =
      empregadosContados.size > 0 ? empregadosContados.size : lancamentosFolha.length

    const aliquota = ALIQUOTA_FGTS
    const valorFGTS = baseCalculo.times(aliquota).toDecimalPlaces(2)

    const resultado: ResultadoFGTS = {
      competencia,
      cnpj: empresa.cnpj,
      baseCalculo,
      aliquota: aliquota.times(100), // armazenado em percentual (8%)
      valorFGTS,
      totalEmpregados,
    }

    // Persiste apuração (upsert — garante idempotência em re-execuções)
    const apuracao = await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'FGTS' as any,
        },
      },
      update: {
        dados: resultado as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'FGTS' as any,
        dados: resultado as any,
        status: 'CALCULADO',
      },
    })

    // Cria/atualiza obrigação de FGTS com vencimento no dia 20 do mês seguinte
    const { inicio: inicioMes } = parsePeriodo(competencia)
    const proximoMes = addMeses(inicioMes, 1)
    const vencimento = new Date(proximoMes.getFullYear(), proximoMes.getMonth(), 20, 23, 59, 59)

    await this.db.obrigacao.upsert({
      where: {
        // Obrigacoes não possuem unique composto no schema; usamos findFirst + create/update
        // A constraint é simulada pelo campo único que não existe, então usamos id gerado
        // Para evitar duplicidade usamos um id determinístico via busca prévia
        id: await this.buscarOuGerarIdObrigacao(tenantId, empresaId, competencia),
      },
      update: {
        valor: valorFGTS,
        vencimento,
        status: 'PENDENTE',
      },
      create: {
        tenantId,
        empresaId,
        tipo: 'FGTS_DIGITAL',
        competencia,
        vencimento,
        valor: valorFGTS,
        status: 'PENDENTE',
      },
    })

    // Audit trail
    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL',
      entidadeId: apuracao.id,
      evento: 'OBRIGACAO_TRANSMITIDA',
      estadoNovo: resultado,
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
      observacao: `FGTS Digital apurado — competência ${competencia} — base R$${baseCalculo.toFixed(2)} — valor R$${valorFGTS.toFixed(2)}`,
    })

    return resultado
  }

  /**
   * Gera a GRRF (Guia de Recolhimento Rescisório do FGTS) para rescisões sem justa causa.
   *
   * Base de cálculo: saldo do FGTS acumulado + multa de 40% (art. 18, § 1º, Lei 8.036/1990).
   *
   * O saldo FGTS é obtido somando os valorFGTS de todas as apurações mensais já realizadas.
   * Em produção este valor deve ser confirmado pelo sistema do FGTS Digital (gov.br).
   */
  async gerarGRRF(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoGRRF> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    // Busca todas as apurações de FGTS da empresa para calcular o saldo acumulado
    const apuracoes = await this.db.apuracaoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        tipo: 'FGTS' as any,
        status: { in: ['CALCULADO', 'TRANSMITIDO', 'PAGO'] },
      },
      orderBy: { competencia: 'asc' },
    })

    let saldoFGTS = new Decimal(0)
    for (const apuracao of apuracoes) {
      const dados = apuracao.dados as any
      if (dados?.valorFGTS) {
        saldoFGTS = saldoFGTS.plus(new Decimal(dados.valorFGTS.toString()))
      }
    }

    const multaRescisoria = saldoFGTS.times(MULTA_RESCISORIA).toDecimalPlaces(2)
    const totalGuia = saldoFGTS.plus(multaRescisoria).toDecimalPlaces(2)

    const resultado: ResultadoGRRF = {
      competencia,
      cnpj: empresa.cnpj,
      saldoFGTS,
      multaRescisoria,
      totalGuia,
    }

    // Cria obrigação de GRRF com vencimento imediato (rescisão deve ser recolhida em até 10 dias)
    const { fim } = parsePeriodo(competencia)
    const vencimentoGRRF = new Date(fim)
    vencimentoGRRF.setDate(vencimentoGRRF.getDate() + 10)

    await this.db.obrigacao.create({
      data: {
        tenantId,
        empresaId,
        tipo: 'FGTS_DIGITAL',
        competencia,
        vencimento: vencimentoGRRF,
        valor: totalGuia,
        status: 'PENDENTE',
      },
    })

    // Audit trail da GRRF
    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL',
      entidadeId: empresaId,
      evento: 'OBRIGACAO_TRANSMITIDA',
      estadoNovo: resultado,
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
      observacao: `GRRF gerada — competência ${competencia} — saldo FGTS R$${saldoFGTS.toFixed(2)} — multa R$${multaRescisoria.toFixed(2)} — total R$${totalGuia.toFixed(2)}`,
    })

    return resultado
  }

  /**
   * Localiza a obrigação de FGTS da competência para upsert, ou retorna um ID
   * que não existirá (forçando a criação pelo upsert).
   */
  private async buscarOuGerarIdObrigacao(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<string> {
    const existente = await this.db.obrigacao.findFirst({
      where: {
        tenantId,
        empresaId,
        tipo: 'FGTS_DIGITAL',
        competencia,
      },
      select: { id: true },
    })

    // Se não existir retorna um ID que nunca baterá (uuid inválido forçará create)
    return existente?.id ?? '00000000-0000-0000-0000-000000000000'
  }
}
