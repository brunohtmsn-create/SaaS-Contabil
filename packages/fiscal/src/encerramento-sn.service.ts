import { getPrismaClient } from '@saas-contabil/database'
import { AuditService } from '@saas-contabil/audit'
import { Decimal, parsePeriodo } from '@saas-contabil/shared'
import { PGDASService } from './pgdas.service.js'
import { DifalService } from './difal.service.js'
import { IcmsStService } from './icms-st.service.js'
import { GNREService } from './gnre.service.js'
import { DeSTDAService } from './destda.service.js'
import { DMSService } from './dms.service.js'
import { EFDReinfService } from './efdreinf.service.js'

export type TipoEmpresaSN = 'COMERCIO' | 'INDUSTRIA' | 'SERVICOS' | 'MISTO'

export type ResultadoEncerramentoSN = {
  empresaId: string
  cnpj: string
  competencia: string
  tipo: TipoEmpresaSN
  passos: {
    pgdas: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
    difal: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
    icmsSt: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
    gnre: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
    destda: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
    dms: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
    efdReinf: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
  }
  erros: string[]
  valorDAS: string
  valorGNRE: string
  valorISS: string
  totalObrigacoes: number
}

// CNAEs iniciados com 10-33 são industriais (Seção C da CNAE 2.0)
const FAIXA_INDUSTRIA_MIN = 10
const FAIXA_INDUSTRIA_MAX = 33

// CNAEs iniciados com 45-47 são comércio (Seção G)
const FAIXAS_COMERCIO = [45, 46, 47]

// CNAEs iniciados com 55-96 são serviços (Seções I-S)
const FAIXA_SERVICOS_MIN = 55
const FAIXA_SERVICOS_MAX = 96

function classificarTipoEmpresa(cnae: string): TipoEmpresaSN {
  const prefixo = parseInt(cnae.substring(0, 2), 10)
  if (isNaN(prefixo)) return 'MISTO'
  if (FAIXAS_COMERCIO.includes(prefixo)) return 'COMERCIO'
  if (prefixo >= FAIXA_INDUSTRIA_MIN && prefixo <= FAIXA_INDUSTRIA_MAX) return 'INDUSTRIA'
  if (prefixo >= FAIXA_SERVICOS_MIN && prefixo <= FAIXA_SERVICOS_MAX) return 'SERVICOS'
  return 'MISTO'
}

export class EncerramentoSNService {
  private db = getPrismaClient()
  private audit = new AuditService()

  async encerrar(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<ResultadoEncerramentoSN> {
    const empresa = await this.db.empresaCliente.findUnique({ where: { id: empresaId } })
    if (!empresa) throw new Error('Empresa não encontrada')
    if (empresa.regime !== 'SIMPLES_NACIONAL') throw new Error('Empresa não é do Simples Nacional')

    const tipo = classificarTipoEmpresa(empresa.cnae)
    const erros: string[] = []

    const passos: ResultadoEncerramentoSN['passos'] = {
      pgdas: 'NAO_APLICAVEL',
      difal: 'NAO_APLICAVEL',
      icmsSt: 'NAO_APLICAVEL',
      gnre: 'NAO_APLICAVEL',
      destda: 'NAO_APLICAVEL',
      dms: 'NAO_APLICAVEL',
      efdReinf: 'NAO_APLICAVEL',
    }

    let valorDAS = new Decimal(0)
    let valorGNRE = new Decimal(0)
    let valorISS = new Decimal(0)

    // PGDAS — sempre para Simples Nacional
    try {
      const resultadoPGDAS = await new PGDASService().apurar(tenantId, empresaId, competencia)
      valorDAS = resultadoPGDAS.valorDAS
      passos.pgdas = 'OK'
    } catch (e) {
      passos.pgdas = 'ERRO'
      erros.push(`PGDAS: ${(e as Error).message}`)
    }

    const temOperacoesComercioIndustria =
      tipo === 'COMERCIO' || tipo === 'INDUSTRIA' || tipo === 'MISTO'

    // DIFAL — Comércio e Indústria (e Misto) com NF-e interestadual
    if (temOperacoesComercioIndustria) {
      try {
        const resultadosDifal = await new DifalService().calcular(tenantId, empresaId, competencia)
        passos.difal = 'OK'
        valorGNRE = valorGNRE.plus(
          resultadosDifal.reduce((acc, r) => acc.plus(r.valorTotal), new Decimal(0))
        )
      } catch (e) {
        passos.difal = 'ERRO'
        erros.push(`DIFAL: ${(e as Error).message}`)
      }

      // ICMS-ST — Comércio e Indústria
      try {
        const resultadoSt = await new IcmsStService().calcular(tenantId, empresaId, competencia)
        passos.icmsSt = 'OK'
        valorGNRE = valorGNRE.plus(new Decimal(resultadoSt.totalIcmsSt.toString()))
      } catch (e) {
        passos.icmsSt = 'ERRO'
        erros.push(`ICMS-ST: ${(e as Error).message}`)
      }
    }

    // GNRE — quando há DIFAL ou ST com valores > 0
    if (valorGNRE.gt(0)) {
      try {
        await new GNREService().gerar(tenantId, empresaId, competencia)
        passos.gnre = 'OK'
      } catch (e) {
        passos.gnre = 'ERRO'
        erros.push(`GNRE: ${(e as Error).message}`)
      }

      // DeSTDA — quando há DIFAL
      if (passos.difal === 'OK') {
        try {
          await new DeSTDAService().gerar(tenantId, empresaId, competencia)
          passos.destda = 'OK'
        } catch (e) {
          passos.destda = 'ERRO'
          erros.push(`DeSTDA: ${(e as Error).message}`)
        }
      }
    }

    // DMS — Serviços e Misto
    if (tipo === 'SERVICOS' || tipo === 'MISTO') {
      try {
        const resultadoDMS = await new DMSService().apurar(tenantId, empresaId, competencia)
        valorISS = resultadoDMS.totalISS
        passos.dms = 'OK'
      } catch (e) {
        passos.dms = 'ERRO'
        erros.push(`DMS: ${(e as Error).message}`)
      }
    }

    // EFD-Reinf — quando há NFSe tomadas com retenção no período
    const temNFSeTomadaComRetencao = await this.verificarNFSeTomadaComRetencao(
      tenantId,
      empresaId,
      competencia
    )

    if (temNFSeTomadaComRetencao) {
      try {
        await new EFDReinfService().processar(tenantId, empresaId, competencia)
        passos.efdReinf = 'OK'
      } catch (e) {
        passos.efdReinf = 'ERRO'
        erros.push(`EFD-Reinf: ${(e as Error).message}`)
      }
    }

    const totalObrigacoes = await this.db.obrigacao.count({
      where: { tenantId, empresaId, competencia },
    })

    await this.audit.registrar({
      tenantId,
      cnpj: empresa.cnpj,
      entidadeTipo: 'APURACAO_FISCAL',
      entidadeId: empresaId,
      evento: 'FECHAMENTO_CONCLUIDO',
      estadoNovo: {
        competencia,
        tipo,
        passos,
        erros,
        valorDAS: valorDAS.toFixed(2),
        valorGNRE: valorGNRE.toFixed(2),
        valorISS: valorISS.toFixed(2),
        totalObrigacoes,
      },
      responsavel: 'sistema',
      responsavelTipo: 'SISTEMA',
    })

    return {
      empresaId,
      cnpj: empresa.cnpj,
      competencia,
      tipo,
      passos,
      erros,
      valorDAS: valorDAS.toFixed(2),
      valorGNRE: valorGNRE.toFixed(2),
      valorISS: valorISS.toFixed(2),
      totalObrigacoes,
    }
  }

  private async verificarNFSeTomadaComRetencao(
    tenantId: string,
    empresaId: string,
    competencia: string
  ): Promise<boolean> {
    const { inicio, fim } = parsePeriodo(competencia)

    const count = await this.db.documentoFiscal.count({
      where: {
        tenantId,
        empresaId,
        tipo: 'NFSE_TOMADA',
        status: 'CONCILIADO',
        dataCompetencia: { gte: inicio, lte: fim },
        valorIrrf: { gt: 0 },
      },
    })

    return count > 0
  }
}
