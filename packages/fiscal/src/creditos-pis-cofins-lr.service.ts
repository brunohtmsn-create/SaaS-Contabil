import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal } from '@saas-contabil/shared'

// Créditos de PIS/COFINS — Regime Não-Cumulativo (Lucro Real)
// Base legal: Lei 10.637/2002 (PIS) e Lei 10.833/2003 (COFINS)
// Somente documentos com direção ENTRADA ou TOMADO e status CONCILIADO geram créditos
// Alíquota de crédito: PIS 1,65% / COFINS 7,6% sobre o valor dos insumos
// CFOPs que geram crédito: compras de mercadorias p/ revenda, insumos da produção,
// energia elétrica, aluguéis, fretes, serviços tomados (lista não exaustiva)

const CFOPS_COM_CREDITO = new Set([
  // Compras para revenda e industrialização
  '1101',
  '1102',
  '1111',
  '1113',
  '1116',
  '1117',
  '1118',
  '1121',
  '1122',
  '1251',
  '2101',
  '2102',
  '2111',
  '2113',
  '2116',
  '2117',
  '2118',
  '2121',
  '2122',
  '2251',
  // Serviços tomados
  '1933',
  '2933',
  // Energia elétrica
  '1252',
  '2252',
  // Aluguéis e leasing
  '1400',
  '2400',
  // Fretes
  '1351',
  '2351',
])

function cfopGeraCredito(cfop: string): boolean {
  // Aceita também qualquer CFOP não listado se for entrada — abordagem conservadora
  // Na prática, cada empresa tem sua tabela de CFOPs creditáveis
  return CFOPS_COM_CREDITO.has(cfop?.substring(0, 4) ?? '')
}

const ALIQUOTA_PIS_LR = new Decimal('0.0165')
const ALIQUOTA_COFINS_LR = new Decimal('0.076')

export type ItemCreditoPisCofins = {
  documentoId: string
  tipo: string
  numero: string
  dataEmissao: Date
  valorTotal: Decimal
  creditoPIS: Decimal
  creditoCOFINS: Decimal
  cfop: string | null
}

export type ResultadoCreditosPisCofinsLR = {
  cnpj: string
  competencia: string
  totalDocumentosEntrada: number
  totalBaseCredito: Decimal
  totalCreditoPIS: Decimal
  totalCreditoCOFINS: Decimal
  totalCreditosCombinados: Decimal
  itens: ItemCreditoPisCofins[]
}

export class CreditosPisCofinsLRService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async apurar(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoCreditosPisCofinsLR> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'LUCRO_REAL')
      throw new Error('Créditos PIS/COFINS não-cumulativos são exclusivos do Lucro Real')

    const [anoStr, mesStr] = competencia.split('-')
    const ano = parseInt(anoStr!, 10)
    const mes = parseInt(mesStr!, 10)
    const inicio = new Date(ano, mes - 1, 1)
    const fim = new Date(ano, mes, 0, 23, 59, 59)

    // Busca documentos de ENTRADA conciliados (insumos, mercadorias, serviços tomados)
    const documentos = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: 'CONCILIADO',
        direcao: { in: ['ENTRADA', 'TOMADO'] },
        tipo: { in: ['NFE', 'NFSE_TOMADA', 'CTE'] },
      },
      orderBy: { dataEmissao: 'asc' },
    })

    const itens: ItemCreditoPisCofins[] = []
    let totalBaseCredito = new Decimal(0)
    let totalCreditoPIS = new Decimal(0)
    let totalCreditoCOFINS = new Decimal(0)

    for (const doc of documentos) {
      const cfop = (doc as any).cfop as string | null
      // Se o documento já tem PIS/COFINS registrados, usa esses valores diretamente
      const pisDireto = new Decimal((doc as any).valorPis?.toString() ?? '0')
      const cofinsDireto = new Decimal((doc as any).valorCofins?.toString() ?? '0')
      const valorTotal = new Decimal(doc.valorTotal.toString())

      let creditoPIS: Decimal
      let creditoCOFINS: Decimal

      if (pisDireto.gt(0) || cofinsDireto.gt(0)) {
        // Usa os valores do documento (NF-e emitida pelo fornecedor)
        creditoPIS = pisDireto
        creditoCOFINS = cofinsDireto
      } else if (!cfop || cfopGeraCredito(cfop)) {
        // Calcula pela alíquota padrão
        creditoPIS = valorTotal.times(ALIQUOTA_PIS_LR).toDecimalPlaces(2)
        creditoCOFINS = valorTotal.times(ALIQUOTA_COFINS_LR).toDecimalPlaces(2)
      } else {
        // CFOP não gera crédito
        continue
      }

      totalBaseCredito = totalBaseCredito.plus(valorTotal)
      totalCreditoPIS = totalCreditoPIS.plus(creditoPIS)
      totalCreditoCOFINS = totalCreditoCOFINS.plus(creditoCOFINS)

      itens.push({
        documentoId: doc.id,
        tipo: doc.tipo,
        numero: (doc as any).numero ?? '',
        dataEmissao: doc.dataEmissao,
        valorTotal,
        creditoPIS,
        creditoCOFINS,
        cfop: cfop ?? null,
      })
    }

    const totalCreditosCombinados = totalCreditoPIS.plus(totalCreditoCOFINS)

    const resultado: ResultadoCreditosPisCofinsLR = {
      cnpj: empresa.cnpj,
      competencia,
      totalDocumentosEntrada: itens.length,
      totalBaseCredito,
      totalCreditoPIS,
      totalCreditoCOFINS,
      totalCreditosCombinados,
      itens,
    }

    // Persiste como apuração de crédito (reutiliza tipo COFINS para crédito combinado)
    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'COFINS',
        },
      },
      update: {
        dados: {
          creditoPIS: totalCreditoPIS.toString(),
          creditoCOFINS: totalCreditoCOFINS.toString(),
          totalDocumentosEntrada: itens.length,
          regime: 'LUCRO_REAL',
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'COFINS',
        dados: {
          creditoPIS: totalCreditoPIS.toString(),
          creditoCOFINS: totalCreditoCOFINS.toString(),
          totalDocumentosEntrada: itens.length,
          regime: 'LUCRO_REAL',
        } as any,
        status: 'CALCULADO',
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'EMPRESA_CLIENTE',
      entidadeId: empresaId,
      evento: 'PIS_COFINS_LP_APURADO',
      estadoNovo: {
        competencia,
        regime: 'LUCRO_REAL',
        totalCreditoPIS: totalCreditoPIS.toString(),
        totalCreditoCOFINS: totalCreditoCOFINS.toString(),
        totalDocumentosEntrada: itens.length,
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
