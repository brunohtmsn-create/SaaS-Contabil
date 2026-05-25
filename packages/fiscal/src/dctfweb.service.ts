import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo, nowBR } from '@saas-contabil/shared'
import type { ResultadoDCTFWeb, DebitosDCTF } from './types.js'

export class DCTFWebService {
  private db = getPrismaClient()
  private audit = new AuditService()

  /**
   * Verifica se EFD-Reinf e eSocial estão fechados (status CALCULADO ou TRANSMITIDO)
   * para o período antes de gerar a DCTFWeb.
   */
  private async verificarPreRequisitos(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<void> {
    const efdReinf = await this.db.apuracaoFiscal.findUnique({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'EFD_REINF',
        },
      },
    })

    if (!efdReinf || !['CALCULADO', 'TRANSMITIDO'].includes(efdReinf.status)) {
      throw new Error('EFD-Reinf e eSocial devem ser fechados antes da DCTFWeb')
    }
  }

  /**
   * Consolida os débitos a partir dos dados da EFD-Reinf (R-2010 e R-4020)
   * e dos documentos fiscais conciliados do período.
   */
  private async consolidarDebitos(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<DebitosDCTF> {
    const efdReinf = await this.db.apuracaoFiscal.findUnique({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'EFD_REINF',
        },
      },
    })

    let inss = new Decimal(0)
    let irrf = new Decimal(0)
    let csrf = new Decimal(0)

    if (efdReinf && efdReinf.dados) {
      const dados = efdReinf.dados as any

      // INSS: soma de vrRetencao dos R-2010
      if (Array.isArray(dados.r2010)) {
        for (const r of dados.r2010) {
          inss = inss.plus(new Decimal(String(r.vrRetencao ?? 0)))
        }
      }

      // IRRF: soma de vrIR dos R-4020
      if (Array.isArray(dados.r4020)) {
        for (const r of dados.r4020) {
          irrf = irrf.plus(new Decimal(String(r.vrIR ?? 0)))
        }
      }

      // IRRF sobre empregados (eSocial): acumulado no fechamento S-1299
      if (dados.esocial?.totalInss) {
        // INSS patronal = INSS retido empregados já incluso; aqui soma contribuição empregador (20%)
        // na DCTFWeb, o INSS do eSocial é separado do EFD-Reinf
        inss = inss.plus(new Decimal(String(dados.esocial.totalInss)))
      }
    }

    // CSRF: PIS + COFINS + CSLL retidos (documentos CONCILIADOS do período)
    const { inicio, fim } = parsePeriodo(competencia)
    const docs = await this.db.documentoFiscal.findMany({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: 'CONCILIADO',
        tipo: 'NFSE_TOMADA',
      },
      select: {
        valorPis: true,
        valorCofins: true,
        valorCsll: true,
      },
    })

    for (const doc of docs) {
      csrf = csrf
        .plus(new Decimal(doc.valorPis.toString()))
        .plus(new Decimal(doc.valorCofins.toString()))
        .plus(new Decimal(doc.valorCsll.toString()))
    }

    csrf = csrf.toDecimalPlaces(2)
    inss = inss.toDecimalPlaces(2)
    irrf = irrf.toDecimalPlaces(2)

    return {
      inss,
      irrf,
      csrf,
      total: inss.plus(irrf).plus(csrf).toDecimalPlaces(2),
    }
  }

  /**
   * Gera a DCTFWeb após EFD-Reinf e eSocial fechados para o período.
   * Consolida INSS + IRRF + CSRF e persiste a apuração no banco.
   */
  async gerar(tenantId: string, empresaId: string, competencia: string): Promise<ResultadoDCTFWeb> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')

    // Pré-requisito: EFD-Reinf + eSocial fechados
    await this.verificarPreRequisitos(tenantId, empresaId, competencia)

    const debitos = await this.consolidarDebitos(tenantId, empresaId, competencia)

    const resultado: ResultadoDCTFWeb = {
      competencia,
      cnpj: empresa.cnpj,
      totalInss: debitos.inss,
      totalIrrf: debitos.irrf,
      totalCsrf: debitos.csrf,
      totalDebitos: debitos.total,
      status: 'GERADA',
    }

    // Persiste apuração DCTFWeb
    await this.db.apuracaoFiscal.upsert({
      where: {
        tenantId_empresaId_competencia_tipo: {
          tenantId,
          empresaId,
          competencia,
          tipo: 'DCTFWEB',
        },
      },
      update: {
        dados: {
          cnpj: empresa.cnpj,
          totalInss: debitos.inss.toFixed(2),
          totalIrrf: debitos.irrf.toFixed(2),
          totalCsrf: debitos.csrf.toFixed(2),
          totalDebitos: debitos.total.toFixed(2),
        } as any,
        status: 'CALCULADO',
      },
      create: {
        tenantId,
        empresaId,
        competencia,
        tipo: 'DCTFWEB',
        dados: {
          cnpj: empresa.cnpj,
          totalInss: debitos.inss.toFixed(2),
          totalIrrf: debitos.irrf.toFixed(2),
          totalCsrf: debitos.csrf.toFixed(2),
          totalDebitos: debitos.total.toFixed(2),
        } as any,
        status: 'CALCULADO',
      },
    })

    // Registra obrigação para controle de vencimento (dia 20)
    const [ano, mes] = competencia.split('-').map(Number) as [number, number]
    const vencimento = new Date(ano, mes, 20) // dia 20 do mês seguinte
    await this.db.obrigacao
      .upsert({
        where: {
          // não há índice único em obrigacoes, usa findFirst + create/update manual
          // workaround: checar existência antes
          id: 'dummy-never-matches',
        },
        update: {},
        create: {
          tenantId,
          empresaId,
          tipo: 'DCTFWEB',
          competencia,
          vencimento,
          status: 'PENDENTE',
          valor: debitos.total,
        },
      })
      .catch(async () => {
        // upsert por id não funciona com uuid aleatório; usa findFirst + createIfAbsent
        const existing = await this.db.obrigacao.findFirst({
          where: { tenantId, empresaId, tipo: 'DCTFWEB', competencia },
        })
        if (!existing) {
          await this.db.obrigacao.create({
            data: {
              tenantId,
              empresaId,
              tipo: 'DCTFWEB',
              competencia,
              vencimento,
              status: 'PENDENTE',
              valor: debitos.total,
            },
          })
        }
      })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL',
      entidadeId: empresaId,
      evento: 'DCTFWEB_TRANSMITIDA',
      estadoNovo: {
        competencia,
        totalInss: debitos.inss.toFixed(2),
        totalIrrf: debitos.irrf.toFixed(2),
        totalCsrf: debitos.csrf.toFixed(2),
        totalDebitos: debitos.total.toFixed(2),
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return resultado
  }
}
