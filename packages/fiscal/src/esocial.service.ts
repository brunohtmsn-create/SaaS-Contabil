import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo, nowBR, formatDate } from '@saas-contabil/shared'

// Alíquotas INSS 2024 (tabela progressiva)
const TABELA_INSS = [
  { ate: new Decimal('1412.00'), aliquota: new Decimal('7.5') },
  { ate: new Decimal('2666.68'), aliquota: new Decimal('9') },
  { ate: new Decimal('4000.03'), aliquota: new Decimal('12') },
  { ate: new Decimal('7786.02'), aliquota: new Decimal('14') },
]

function calcularInss(salario: Decimal): Decimal {
  let inss = new Decimal(0)
  let baseRestante = salario

  const faixas = [
    { limite: new Decimal('1412.00'), aliquota: new Decimal('0.075') },
    { limite: new Decimal('2666.68'), aliquota: new Decimal('0.09') },
    { limite: new Decimal('4000.03'), aliquota: new Decimal('0.12') },
    { limite: new Decimal('7786.02'), aliquota: new Decimal('0.14') },
  ]

  let baseAnterior = new Decimal(0)
  for (const faixa of faixas) {
    if (baseRestante.lte(0)) break
    const baseNaFaixa = Decimal.min(salario, faixa.limite).minus(baseAnterior)
    if (baseNaFaixa.gt(0)) {
      inss = inss.plus(baseNaFaixa.times(faixa.aliquota))
    }
    baseAnterior = faixa.limite
    baseRestante = salario.minus(faixa.limite)
  }

  // Teto máximo INSS
  const teto = new Decimal('7786.02').times(new Decimal('0.14'))
  return Decimal.min(inss, teto).toDecimalPlaces(2)
}

type EmpregadoSimulado = {
  cpf: string
  nome: string
  salario: Decimal
  admissao: Date
}

// Extrai empregados simulados a partir de transações de folha no banco
// Em produção, isso viria de um modelo de RH dedicado
async function buscarEmpregados(
  db: ReturnType<typeof getPrismaClient>,
  tenantId: string,
  empresaId: string,
  inicio: Date,
  fim: Date,
): Promise<EmpregadoSimulado[]> {
  // Busca transações bancárias do tipo folha de pagamento (DEBITO com "FOLHA" ou "SALARIO" na descrição)
  const transacoes = await db.transacaoBancaria.findMany({
    where: {
      tenantId,
      empresaId,
      tipo: 'DEBITO',
      data: { gte: inicio, lte: fim },
      descricao: { contains: 'FOLHA', mode: 'insensitive' },
      status: 'CONCILIADA',
    },
    orderBy: { data: 'asc' },
  })

  // Cada transação de folha representa um empregado (simulação simplificada)
  return transacoes.map((t, idx) => ({
    cpf: `000.000.000-${String(idx + 1).padStart(2, '0')}`,
    nome: t.descricao.replace(/FOLHA\s*/i, '').trim() || `Empregado ${idx + 1}`,
    salario: new Decimal(t.valor.toString()),
    admissao: t.data,
  }))
}

function gerarXmlS1200(
  cnpj: string,
  competencia: string,
  empregados: EmpregadoSimulado[],
  geradoEm: string,
): string {
  const eventos = empregados
    .map((emp, idx) => {
      const vrSalFx = emp.salario.toFixed(2)
      const vrBaseInss = emp.salario.toFixed(2)
      const vrInss = calcularInss(emp.salario).toFixed(2)
      const vrBaseFgts = emp.salario.toFixed(2)
      const vrFgts = emp.salario.times(new Decimal('0.08')).toDecimalPlaces(2).toFixed(2)

      return `    <evento Id="ID${String(idx + 1).padStart(18, '0')}">
      <eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtRemun/v_S_01_01_00">
        <evtRemun Id="ID${String(idx + 1).padStart(18, '0')}">
          <ideEvento>
            <indRetif>1</indRetif>
            <perApur>${competencia}</perApur>
            <indApuracao>1</indApuracao>
            <indGuia>1</indGuia>
            <tpAmb>1</tpAmb>
            <procEmi>1</procEmi>
            <verProc>1.0.0</verProc>
          </ideEvento>
          <ideEmpregador>
            <tpInsc>1</tpInsc>
            <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
          </ideEmpregador>
          <ideTrabalhador>
            <cpfTrab>${emp.cpf.replace(/\D/g, '')}</cpfTrab>
          </ideTrabalhador>
          <dmDev>
            <ideDmDev>${competencia}-${String(idx + 1).padStart(3, '0')}</ideDmDev>
            <codCateg>101</codCateg>
            <infoPerApur>
              <ideEstabLot>
                <tpInsc>1</tpInsc>
                <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
                <codLotacao>1</codLotacao>
                <detVerbas>
                  <codRubr>0001</codRubr>
                  <ideTabRubr>1</ideTabRubr>
                  <qtdHraban>220.00</qtdHraban>
                  <vrRubr>${vrSalFx}</vrRubr>
                </detVerbas>
              </ideEstabLot>
            </infoPerApur>
            <infoAgNocivo>
              <grauExp>0</grauExp>
            </infoAgNocivo>
            <remunPerApur>
              <vrSalFx>${vrSalFx}</vrSalFx>
              <undSalFixo>5</undSalFixo>
            </remunPerApur>
            <infoSaudeColet>
              <vrDescPlano>0.00</vrDescPlano>
              <vrPatrPlano>0.00</vrPatrPlano>
            </infoSaudeColet>
          </dmDev>
          <infoComplCont>
            <vrBcCpMensal>${vrBaseInss}</vrBcCpMensal>
            <vrBcFGTSMensal>${vrBaseFgts}</vrBcFGTSMensal>
            <vrFGTSMensal>${vrFgts}</vrFGTSMensal>
            <vrBcFGTSGuiaResc>0.00</vrBcFGTSGuiaResc>
            <vrFGTSGuiaResc>0.00</vrFGTSGuiaResc>
            <vrBcCp13>0.00</vrBcCp13>
            <vrBcFGTS13>0.00</vrBcFGTS13>
            <vrFGTS13>0.00</vrFGTS13>
            <vrInss>${vrInss}</vrInss>
          </infoComplCont>
        </evtRemun>
      </eSocial>
    </evento>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/lote/envio/v1_1_1">
  <envioLoteEventos grupo="1">
    <ideEmpregador>
      <tpInsc>1</tpInsc>
      <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
    </ideEmpregador>
    <ideTransmissor>
      <tpInsc>1</tpInsc>
      <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
    </ideTransmissor>
    <eventos>
${eventos}
    </eventos>
  </envioLoteEventos>
</eSocial>`
}

function gerarXmlS1210(
  cnpj: string,
  competencia: string,
  empregados: EmpregadoSimulado[],
): string {
  const eventos = empregados
    .map((emp, idx) => {
      const vrSalario = emp.salario.toFixed(2)
      const vrInss = calcularInss(emp.salario).toFixed(2)
      const vrLiquido = emp.salario.minus(calcularInss(emp.salario)).toDecimalPlaces(2).toFixed(2)

      return `    <evento Id="ID${String(idx + 1).padStart(18, '0')}">
      <eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtPgtos/v_S_01_01_00">
        <evtPgtos Id="ID${String(idx + 1).padStart(18, '0')}">
          <ideEvento>
            <indRetif>1</indRetif>
            <perApur>${competencia}</perApur>
            <tpAmb>1</tpAmb>
            <procEmi>1</procEmi>
            <verProc>1.0.0</verProc>
          </ideEvento>
          <ideEmpregador>
            <tpInsc>1</tpInsc>
            <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
          </ideEmpregador>
          <ideTrabalhador>
            <cpfTrab>${emp.cpf.replace(/\D/g, '')}</cpfTrab>
          </ideTrabalhador>
          <infoPgto>
            <dtPgto>${competencia}-05</dtPgto>
            <tpPgto>1</tpPgto>
            <ideDmDev>${competencia}-${String(idx + 1).padStart(3, '0')}</ideDmDev>
            <codCateg>101</codCateg>
            <vrLiq>${vrLiquido}</vrLiq>
            <infoDesc>
              <descINSS>
                <vrDescINSS>${vrInss}</vrDescINSS>
              </descINSS>
            </infoDesc>
          </infoPgto>
        </evtPgtos>
      </eSocial>
    </evento>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/lote/envio/v1_1_1">
  <envioLoteEventos grupo="2">
    <ideEmpregador>
      <tpInsc>1</tpInsc>
      <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
    </ideEmpregador>
    <ideTransmissor>
      <tpInsc>1</tpInsc>
      <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
    </ideTransmissor>
    <eventos>
${eventos}
    </eventos>
  </envioLoteEventos>
</eSocial>`
}

function gerarXmlS1299(
  cnpj: string,
  competencia: string,
  empregados: EmpregadoSimulado[],
  totalInss: Decimal,
  totalFgts: Decimal,
): string {
  const qtdTrab = empregados.length
  const totalSalarios = empregados
    .reduce((acc, e) => acc.plus(e.salario), new Decimal(0))
    .toFixed(2)

  return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/lote/envio/v1_1_1">
  <envioLoteEventos grupo="3">
    <ideEmpregador>
      <tpInsc>1</tpInsc>
      <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
    </ideEmpregador>
    <ideTransmissor>
      <tpInsc>1</tpInsc>
      <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
    </ideTransmissor>
    <eventos>
      <evento Id="ID000000000000000001">
        <eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtFechamento/v_S_01_01_00">
          <evtFechamento Id="ID000000000000000001">
            <ideEvento>
              <indRetif>1</indRetif>
              <perApur>${competencia}</perApur>
              <indApuracao>1</indApuracao>
              <tpAmb>1</tpAmb>
              <procEmi>1</procEmi>
              <verProc>1.0.0</verProc>
            </ideEvento>
            <ideEmpregador>
              <tpInsc>1</tpInsc>
              <nrInsc>${cnpj.replace(/\D/g, '')}</nrInsc>
            </ideEmpregador>
            <infoFechamento>
              <situacaoArquivo>1</situacaoArquivo>
              <compSemMovto></compSemMovto>
            </infoFechamento>
            <totalApurado>
              <qtdTrab>${qtdTrab}</qtdTrab>
              <vrTotalBcCp>${totalSalarios}</vrTotalBcCp>
              <vrTotalINSS>${totalInss.toFixed(2)}</vrTotalINSS>
              <vrTotalFGTS>${totalFgts.toFixed(2)}</vrTotalFGTS>
            </totalApurado>
          </evtFechamento>
        </eSocial>
      </evento>
    </eventos>
  </envioLoteEventos>
</eSocial>`
}

export class ESocialService {
  private db = getPrismaClient()
  private audit = new AuditService()

  /**
   * S-1200: Remuneração de trabalhador vinculado ao RGPS
   */
  async gerarS1200(tenantId: string, empresaId: string, competencia: string): Promise<string> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const { inicio, fim } = parsePeriodo(competencia)
    const empregados = await buscarEmpregados(this.db, tenantId, empresaId, inicio, fim)

    const geradoEm = formatDate(nowBR(), 'yyyy-MM-dd HH:mm:ss')
    const xml = gerarXmlS1200(empresa.cnpj, competencia, empregados, geradoEm)

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL',
      entidadeId: empresaId,
      evento: 'ESOCIAL_TRANSMITIDO',
      estadoNovo: { evento: 'S-1200', competencia, qtdEmpregados: empregados.length },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return xml
  }

  /**
   * S-1210: Pagamentos de rendimentos do trabalho
   */
  async gerarS1210(tenantId: string, empresaId: string, competencia: string): Promise<string> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const { inicio, fim } = parsePeriodo(competencia)
    const empregados = await buscarEmpregados(this.db, tenantId, empresaId, inicio, fim)

    const xml = gerarXmlS1210(empresa.cnpj, competencia, empregados)

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL',
      entidadeId: empresaId,
      evento: 'ESOCIAL_TRANSMITIDO',
      estadoNovo: { evento: 'S-1210', competencia, qtdEmpregados: empregados.length },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return xml
  }

  /**
   * S-1299: Fechamento dos eventos periódicos
   */
  async gerarS1299(tenantId: string, empresaId: string, competencia: string): Promise<string> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    const { inicio, fim } = parsePeriodo(competencia)
    const empregados = await buscarEmpregados(this.db, tenantId, empresaId, inicio, fim)

    const totalInss = empregados.reduce(
      (acc, e) => acc.plus(calcularInss(e.salario)),
      new Decimal(0),
    )
    const totalFgts = empregados.reduce(
      (acc, e) => acc.plus(e.salario.times(new Decimal('0.08'))),
      new Decimal(0),
    )

    const xml = gerarXmlS1299(empresa.cnpj, competencia, empregados, totalInss, totalFgts)

    // Persiste apuração eSocial no banco
    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'EFD_REINF', // reutiliza tipo mais próximo — eSocial é OBRIGACAO separada
        },
      },
      update: {
        dados: {
          esocial: { qtdEmpregados: empregados.length, totalInss, totalFgts },
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'EFD_REINF',
        dados: {
          esocial: { qtdEmpregados: empregados.length, totalInss, totalFgts },
        } as any,
        status: 'CALCULADO',
      },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL',
      entidadeId: empresaId,
      evento: 'ESOCIAL_TRANSMITIDO',
      estadoNovo: {
        evento: 'S-1299',
        competencia,
        qtdEmpregados: empregados.length,
        totalInss: totalInss.toFixed(2),
        totalFgts: totalFgts.toFixed(2),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return xml
  }

  /**
   * Processa todos os eventos em sequência: S-1200 → S-1210 → S-1299
   */
  async processar(
    tenantId: string,
    empresaId: string,
    competencia: string,
  ): Promise<{ s1200: string; s1210: string; s1299: string }> {
    const s1200 = await this.gerarS1200(tenantId, empresaId, competencia)
    const s1210 = await this.gerarS1210(tenantId, empresaId, competencia)
    const s1299 = await this.gerarS1299(tenantId, empresaId, competencia)

    return { s1200, s1210, s1299 }
  }
}
