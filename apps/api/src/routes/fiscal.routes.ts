import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import { nowBR, parsePeriodo, Decimal } from '@saas-contabil/shared'
import {
  PGDASService,
  DifalService,
  GNREService,
  DeSTDAService,
  DCTFWebService,
  ESocialService,
  MonitoramentoSNService,
  FatorRService,
  FGTSDigitalService,
  EFDReinfService,
  DMSService,
  DasnService,
  CalendarioLPLRService,
  IrpjCsllLPService,
  PisCofinsLPService,
  ECFService,
  DCTFMensalService,
  SpedFiscalService,
  SpedContribuicoesService,
  IrpjCsllLRService,
  CreditosPisCofinsLRService,
  RetencoesNaFonteService,
  IrpjCsllLREstimativaService,
  PrejuizosFiscaisLRService,
  DepreciacaoLRService,
  INSSPatronalService,
  AjusteAnualLRService,
  LALURService,
  SimuladorTributarioService,
} from '@saas-contabil/fiscal'
import { Queue } from 'bullmq'
import { Redis as IORedis } from 'ioredis'

const params = z.object({
  empresaId: z.string().uuid(),
  competencia: z.string().regex(/^\d{4}-\d{2}$/),
})

const OPERACOES_FISCAIS = [
  'PGDAS',
  'DIFAL',
  'GNRE',
  'DESTDA',
  'EFDREINF',
  'ESOCIAL',
  'DCTFWEB',
  'FGTS',
  'DMS',
  'TODOS',
] as const

export async function fiscalRoutes(app: FastifyInstance) {
  const db = getPrismaClient()
  const redis = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  })
  const fiscalQueue = new Queue('fiscal', { connection: redis })

  app.post('/pgdas/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new PGDASService()
    const resultado = await service.apurar(tenantId, empresaId, competencia)
    return resultado
  })

  app.get('/pgdas/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'PGDAS' },
    })

    if (!apuracao) return reply.code(404).send({ error: 'PGDAS não encontrado' })
    return apuracao
  })

  app.post('/difal/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new DifalService()
    return service.calcular(tenantId, empresaId, competencia)
  })

  app.get('/difal/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'DIFAL' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'DIFAL não encontrado' })
    return apuracao
  })

  app.post('/gnre/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new GNREService()
    return service.gerar(tenantId, empresaId, competencia)
  })

  app.get('/gnre/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'GNRE' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'GNRE não encontrado' })
    return apuracao
  })

  app.post('/destda/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new DeSTDAService()
    return service.gerar(tenantId, empresaId, competencia)
  })

  app.get('/destda/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'DESTDA' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'DeSTDA não encontrado' })
    return apuracao
  })

  app.get('/dms/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'DMS' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'DMS não encontrado' })
    return apuracao
  })

  app.get('/efdreinf/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'EFD_REINF' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'EFD-Reinf não encontrado' })
    return apuracao
  })

  app.get('/apuracoes', async (request) => {
    const { tenantId } = request.user as any
    const { competencia, tipo } = request.query as { competencia?: string; tipo?: string }

    const where: any = { tenantId }
    if (competencia) where.competencia = competencia
    if (tipo) where.tipo = tipo

    return db.apuracaoFiscal.findMany({
      where,
      include: { empresa: { select: { cnpj: true, razaoSocial: true } } },
      orderBy: { competencia: 'desc' },
    })
  })

  app.get('/apuracoes/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const { competencia } = request.query as { competencia?: string }

    const where: any = { tenantId, empresaId }
    if (competencia) where.competencia = competencia

    return db.apuracaoFiscal.findMany({ where, orderBy: { competencia: 'desc' } })
  })

  app.post('/pgdas/transmitir/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    // PGDAS → transmitir SOMENTE após conciliação completa do período (CLAUDE.md regra 11)
    const { inicio, fim } = parsePeriodo(competencia)
    const pendentes = await db.documentoFiscal.count({
      where: {
        tenantId,
        empresaId,
        dataCompetencia: { gte: inicio, lte: fim },
        status: { in: ['PENDENTE_REVISAO', 'NORMALIZADO', 'CAPTURADO', 'EM_CONCILIACAO'] },
      },
    })
    if (pendentes > 0) {
      return reply.code(422).send({
        error: `Existem ${pendentes} documentos não conciliados — conclua a conciliação antes de transmitir o PGDAS`,
      })
    }

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'PGDAS' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'PGDAS não apurado para este período' })

    await db.apuracaoFiscal.update({
      where: { id: apuracao.id },
      data: { status: 'TRANSMITIDO' },
    })

    return { success: true, status: 'TRANSMITIDO' }
  })

  app.get('/obrigacoes/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const { mes } = request.query as { mes?: string }

    const where: any = { tenantId, empresaId }
    if (mes) {
      const { inicio, fim } = parsePeriodo(mes)
      where.vencimento = { gte: inicio, lte: fim }
    }

    return db.obrigacao.findMany({ where, orderBy: { vencimento: 'asc' } })
  })

  app.get('/obrigacoes', async (request) => {
    const { tenantId } = request.user as any
    const { mes, competencia, status } = request.query as {
      mes?: string
      competencia?: string
      status?: string
    }

    const where: any = { tenantId }
    if (status) where.status = status
    const periodo = competencia ?? mes
    if (periodo) {
      const { inicio, fim } = parsePeriodo(periodo)
      where.vencimento = { gte: inicio, lte: fim }
    }

    return db.obrigacao.findMany({
      where,
      include: { empresa: { select: { cnpj: true, razaoSocial: true } } },
      orderBy: { vencimento: 'asc' },
    })
  })

  app.patch('/obrigacoes/:id', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    const body = z
      .object({
        status: z.enum(['TRANSMITIDA', 'PAGA', 'DISPENSADA', 'PENDENTE', 'ERRO']),
        recibo: z.string().optional(),
        cumprideEm: z.string().optional(),
        valor: z.string().optional(),
      })
      .parse(request.body)

    const obrigacao = await db.obrigacao.findFirst({ where: { id, tenantId } })
    if (!obrigacao) return reply.code(404).send({ error: 'Obrigação não encontrada' })

    const updated = await db.obrigacao.update({
      where: { id, tenantId },
      data: {
        status: body.status as any,
        ...(body.recibo !== undefined && { recibo: body.recibo }),
        ...(body.cumprideEm !== undefined && { cumprideEm: new Date(body.cumprideEm) }),
        ...(body.valor !== undefined && { valor: body.valor }),
      },
    })

    return updated
  })

  app.post('/obrigacoes/calendario/:empresaId/:ano', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, ano } = z
      .object({ empresaId: z.string().uuid(), ano: z.string().regex(/^\d{4}$/) })
      .parse(request.params)

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    const anoNum = Number(ano)
    if (empresa.regime === 'LUCRO_PRESUMIDO' || empresa.regime === 'LUCRO_REAL') {
      const service = new CalendarioLPLRService()
      return service.gerarCalendarioAnual(tenantId, empresaId, anoNum)
    }

    const service = new MonitoramentoSNService()
    return service.gerarCalendarioAnual(tenantId, empresaId, anoNum)
  })

  // POST /fiscal/obrigacoes/calendario/batch/:ano
  // Gera calendário anual para todas as empresas SN/MEI ativas do tenant em paralelo
  app.post('/obrigacoes/calendario/batch/:ano', async (request, reply) => {
    const { tenantId } = request.user as any
    const { ano: anoStr } = z.object({ ano: z.string().regex(/^\d{4}$/) }).parse(request.params)
    const ano = Number(anoStr)

    const empresas = await db.empresaCliente.findMany({
      where: {
        tenantId,
        ativa: true,
        regime: { in: ['SIMPLES_NACIONAL', 'MEI'] },
      },
      select: { id: true, razaoSocial: true },
    })

    const service = new MonitoramentoSNService()

    const resultados = await Promise.allSettled(
      empresas.map((emp) => service.gerarCalendarioAnual(tenantId, emp.id, ano))
    )

    const sucesso = resultados.filter((r) => r.status === 'fulfilled').length
    const erros = resultados
      .map((r, i) =>
        r.status === 'rejected' ? { empresaId: empresas[i]!.id, erro: r.reason?.message } : null
      )
      .filter(Boolean)

    return reply.code(200).send({
      ano,
      totalEmpresas: empresas.length,
      sucesso,
      erros,
    })
  })

  // POST /fiscal/obrigacoes/calendario/batch-lplr/:ano
  // Gera calendário anual para todas as empresas LP/LR ativas do tenant em paralelo
  app.post('/obrigacoes/calendario/batch-lplr/:ano', async (request, reply) => {
    const { tenantId } = request.user as any
    const { ano: anoStr } = z.object({ ano: z.string().regex(/^\d{4}$/) }).parse(request.params)
    const ano = Number(anoStr)

    const empresas = await db.empresaCliente.findMany({
      where: {
        tenantId,
        ativa: true,
        regime: { in: ['LUCRO_PRESUMIDO', 'LUCRO_REAL'] },
      },
      select: { id: true, razaoSocial: true },
    })

    const service = new CalendarioLPLRService()

    const resultados = await Promise.allSettled(
      empresas.map((emp) => service.gerarCalendarioAnual(tenantId, emp.id, ano))
    )

    const sucesso = resultados.filter((r) => r.status === 'fulfilled').length
    const erros = resultados
      .map((r, i) =>
        r.status === 'rejected' ? { empresaId: empresas[i]!.id, erro: r.reason?.message } : null
      )
      .filter(Boolean)

    return reply.code(200).send({
      ano,
      totalEmpresas: empresas.length,
      sucesso,
      erros,
    })
  })

  app.get('/fator-r/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new FatorRService()
    const resultado = await service.calcular(tenantId, empresaId, competencia)
    return {
      empresaId,
      competencia,
      fatorR: resultado.fatorR.toFixed(2),
      anexo: resultado.anexo,
    }
  })

  // POST /fiscal/irpj-csll-lp/:empresaId/:competencia — apura IRPJ+CSLL para LP
  app.post('/irpj-csll-lp/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new IrpjCsllLPService()
    const resultado = await service.apurar(tenantId, empresaId, competencia)
    return {
      empresaId,
      competencia: resultado.competencia,
      trimestreLabel: resultado.trimestreLabel,
      categoria: resultado.categoria,
      percentualPresuncaoIRPJ: resultado.percentualPresuncaoIRPJ,
      percentualPresuncaoCSLL: resultado.percentualPresuncaoCSLL,
      receitaBrutaTrimestral: resultado.receitaBrutaTrimestral.toFixed(2),
      baseCalculoIRPJ: resultado.baseCalculoIRPJ.toFixed(2),
      baseCalculoCSLL: resultado.baseCalculoCSLL.toFixed(2),
      irpjNormal: resultado.irpjNormal.toFixed(2),
      irpjAdicional: resultado.irpjAdicional.toFixed(2),
      irpjTotal: resultado.irpjTotal.toFixed(2),
      csllTotal: resultado.csllTotal.toFixed(2),
      totalDevido: resultado.totalDevido.toFixed(2),
    }
  })

  // GET /fiscal/irpj-csll-lp/:empresaId/:competencia — busca apuração existente
  app.get('/irpj-csll-lp/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'IRPJ_LP' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'Apuração IRPJ/CSLL LP não encontrada' })
    return apuracao
  })

  // POST /fiscal/pis-cofins-lp/:empresaId/:competencia — apura PIS e COFINS (regime cumulativo LP/LR)
  app.post('/pis-cofins-lp/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new PisCofinsLPService()
    const resultado = await service.apurar(tenantId, empresaId, competencia)
    return {
      empresaId,
      competencia: resultado.competencia,
      receitaBruta: resultado.receitaBruta.toFixed(2),
      baseCalculo: resultado.baseCalculo.toFixed(2),
      pis: resultado.pis.toFixed(2),
      cofins: resultado.cofins.toFixed(2),
      totalDevido: resultado.totalDevido.toFixed(2),
    }
  })

  // GET /fiscal/pis-cofins-lp/:empresaId/:competencia — busca apuração existente
  app.get('/pis-cofins-lp/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'PIS' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'Apuração PIS/COFINS LP não encontrada' })
    return apuracao
  })

  // POST /fiscal/ecf/:empresaId/:ano — gera ECF anual para LP/LR
  app.post('/ecf/:empresaId/:ano', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, ano } = z
      .object({ empresaId: z.string().uuid(), ano: z.string().regex(/^\d{4}$/) })
      .parse(request.params)

    const service = new ECFService()
    const resultado = await service.gerar(tenantId, empresaId, parseInt(ano, 10))
    return reply.code(201).send(resultado)
  })

  // POST /fiscal/dctf-mensal/:empresaId/:competencia — gera DCTF Mensal LP/LR
  app.post('/dctf-mensal/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new DCTFMensalService()
    const resultado = await service.gerar(tenantId, empresaId, competencia)
    return reply.code(201).send(resultado)
  })

  // POST /fiscal/sped-fiscal/:empresaId/:competencia — gera EFD ICMS/IPI para LP/LR
  app.post('/sped-fiscal/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new SpedFiscalService()
    const resultado = await service.gerar(tenantId, empresaId, competencia)
    return reply.code(201).send(resultado)
  })

  // POST /fiscal/sped-contribuicoes/:empresaId/:competencia — gera EFD PIS/COFINS
  app.post('/sped-contribuicoes/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new SpedContribuicoesService()
    const resultado = await service.gerar(tenantId, empresaId, competencia)
    return reply.code(201).send(resultado)
  })

  // GET /fiscal/sped-contribuicoes/:empresaId/:competencia — busca EFD PIS/COFINS
  app.get('/sped-contribuicoes/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'PIS' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'EFD PIS/COFINS não encontrada' })
    return apuracao
  })

  // GET /fiscal/sped-fiscal/:empresaId/:competencia — busca EFD gerada
  app.get('/sped-fiscal/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'DESTDA' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'SPED Fiscal não encontrado' })
    return apuracao
  })

  // GET /fiscal/dctf-mensal/:empresaId/:competencia — busca DCTF gerada
  app.get('/dctf-mensal/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'DCTFWEB' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'DCTF Mensal não encontrada' })
    return apuracao
  })

  // GET /fiscal/ecf/:empresaId/:ano — busca ECF gerada
  app.get('/ecf/:empresaId/:ano', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, ano } = z
      .object({ empresaId: z.string().uuid(), ano: z.string().regex(/^\d{4}$/) })
      .parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia: ano, tipo: 'ECF' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'ECF não encontrada para este ano' })
    return apuracao
  })

  // POST /fiscal/irpj-csll-lr/:empresaId/:competencia — apura IRPJ+CSLL Lucro Real
  app.post('/irpj-csll-lr/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const body = z
      .object({
        lucroContabilTrimestral: z.string().default('0'),
        adicoesLALUR: z.string().default('0'),
        exclusoesLALUR: z.string().default('0'),
      })
      .parse(request.body ?? {})

    const { Decimal } = await import('@saas-contabil/shared')
    const service = new IrpjCsllLRService()
    const resultado = await service.apurar(
      tenantId,
      empresaId,
      competencia,
      new Decimal(body.lucroContabilTrimestral),
      new Decimal(body.adicoesLALUR),
      new Decimal(body.exclusoesLALUR)
    )
    return reply.code(201).send(resultado)
  })

  // GET /fiscal/irpj-csll-lr/:empresaId/:competencia — consulta apuração LR
  app.get('/irpj-csll-lr/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, tipo: 'IRPJ_LR' },
      orderBy: { criadoEm: 'desc' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'Apuração IRPJ LR não encontrada' })
    return apuracao
  })

  // POST /fiscal/creditos-pis-cofins-lr/:empresaId/:competencia — apura créditos PIS/COFINS LR
  app.post('/creditos-pis-cofins-lr/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new CreditosPisCofinsLRService()
    const resultado = await service.apurar(tenantId, empresaId, competencia)
    return reply.code(201).send(resultado)
  })

  // GET /fiscal/creditos-pis-cofins-lr/:empresaId/:competencia — consulta créditos
  app.get('/creditos-pis-cofins-lr/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'COFINS' },
      orderBy: { criadoEm: 'desc' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'Créditos PIS/COFINS LR não encontrados' })
    return apuracao
  })

  app.post('/inss-patronal/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const body = z
      .object({
        funcionarios: z
          .array(
            z.object({
              id: z.string(),
              nome: z.string(),
              salarioBase: z.string(),
              adicional13: z.string().optional(),
              adicionaisVariaveis: z.string().optional(),
            })
          )
          .default([]),
        grauRisco: z.enum(['leve', 'medio', 'grave']).default('medio'),
        fap: z.string().default('1.0'),
        atividadeTerceiros: z.string().default('outros'),
      })
      .parse(request.body ?? {})

    const { Decimal } = await import('@saas-contabil/shared')
    const service = new INSSPatronalService()
    const resultado = await service.calcular(
      tenantId,
      empresaId,
      competencia,
      body.funcionarios.map((f) => ({
        id: f.id,
        nome: f.nome,
        salarioBase: new Decimal(f.salarioBase),
        ...(f.adicional13 && { adicional13: new Decimal(f.adicional13) }),
        ...(f.adicionaisVariaveis && { adicionaisVariaveis: new Decimal(f.adicionaisVariaveis) }),
      })),
      body.grauRisco,
      new Decimal(body.fap),
      body.atividadeTerceiros
    )
    return reply.code(200).send(resultado)
  })

  app.post('/depreciacao-lr/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const { bens } = z
      .object({
        bens: z
          .array(
            z.object({
              id: z.string(),
              descricao: z.string(),
              categoria: z.string(),
              valorAquisicao: z.string(),
              dataAquisicao: z.string(),
              vidaUtilAnos: z.number().int().positive().optional(),
              taxaAnualPersonalizada: z.string().optional(),
              turnoTrabalho: z.enum(['simples', 'duplo', 'triplo']).default('simples'),
              valorResidual: z.string().default('0'),
            })
          )
          .default([]),
      })
      .parse(request.body ?? {})

    const { Decimal } = await import('@saas-contabil/shared')
    const service = new DepreciacaoLRService()
    const resultado = await service.apurar(
      tenantId,
      empresaId,
      competencia,
      bens.map((b) => ({
        id: b.id,
        descricao: b.descricao,
        categoria: b.categoria,
        valorAquisicao: new Decimal(b.valorAquisicao),
        dataAquisicao: new Date(b.dataAquisicao),
        vidaUtilAnos: b.vidaUtilAnos ?? 10,
        ...(b.taxaAnualPersonalizada && {
          taxaAnualPersonalizada: new Decimal(b.taxaAnualPersonalizada),
        }),
        turnoTrabalho: b.turnoTrabalho,
        valorResidual: new Decimal(b.valorResidual),
      }))
    )
    return reply.code(200).send(resultado)
  })

  app.get('/depreciacao-lr/categorias', async (_request, reply) => {
    const service = new DepreciacaoLRService()
    return reply.send({
      categorias: service.getCategorias().map((cat) => ({
        categoria: cat,
        ...service.getTaxaDepreciacao(cat),
      })),
    })
  })

  app.post('/prejuizos-fiscais-lr/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const { prejuizoIRPJ, prejuizoCSLL } = z
      .object({
        prejuizoIRPJ: z.string().default('0'),
        prejuizoCSLL: z.string().default('0'),
      })
      .parse(request.body ?? {})

    const { Decimal } = await import('@saas-contabil/shared')
    const service = new PrejuizosFiscaisLRService()
    await service.registrarPrejuizo(
      tenantId,
      empresaId,
      competencia,
      new Decimal(prejuizoIRPJ),
      new Decimal(prejuizoCSLL)
    )
    return reply.code(201).send({ ok: true, competencia, prejuizoIRPJ, prejuizoCSLL })
  })

  app.post('/prejuizos-fiscais-lr/:empresaId/:competencia/compensar', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const { lucroRealDoperiodo, baseCSLLdoPeriodo } = z
      .object({
        lucroRealDoperiodo: z.string().default('0'),
        baseCSLLdoPeriodo: z.string().default('0'),
      })
      .parse(request.body ?? {})

    const { Decimal } = await import('@saas-contabil/shared')
    const service = new PrejuizosFiscaisLRService()
    const resultado = await service.compensar(
      tenantId,
      empresaId,
      competencia,
      new Decimal(lucroRealDoperiodo),
      new Decimal(baseCSLLdoPeriodo)
    )
    return reply.code(200).send(resultado)
  })

  app.post('/irpj-csll-lr-estimativa/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const { atividadePrincipal } = z
      .object({ atividadePrincipal: z.string().optional() })
      .parse(request.body ?? {})

    const service = new IrpjCsllLREstimativaService()
    const resultado = await service.apurar(tenantId, empresaId, competencia, atividadePrincipal)
    return reply.code(201).send(resultado)
  })

  app.get('/irpj-csll-lr-estimativa/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'IRPJ_LR' },
      orderBy: { criadoEm: 'desc' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'Estimativa IRPJ/CSLL LR não encontrada' })
    return apuracao
  })

  app.post('/retencoes-fonte/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new RetencoesNaFonteService()
    const resultado = await service.apurar(tenantId, empresaId, competencia)
    return reply.code(201).send(resultado)
  })

  app.get('/retencoes-fonte/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'DCTFWEB' },
      orderBy: { criadoEm: 'desc' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'Retenções na fonte não encontradas' })
    return apuracao
  })

  app.post('/ajuste-anual-lr/:empresaId/:ano', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId } = params.parse(request.params)
    const { ano: anoParam } = z.object({ ano: z.string().regex(/^\d{4}$/) }).parse(request.params)
    const { lucroRealAnual, adicoesLALUR, exclusoesLALUR } = z
      .object({
        lucroRealAnual: z.string().default('0'),
        adicoesLALUR: z.string().default('0'),
        exclusoesLALUR: z.string().default('0'),
      })
      .parse(request.body ?? {})

    const { Decimal } = await import('@saas-contabil/shared')
    const service = new AjusteAnualLRService()
    const resultado = await service.apurar(
      tenantId,
      empresaId,
      Number(anoParam),
      new Decimal(lucroRealAnual),
      new Decimal(adicoesLALUR),
      new Decimal(exclusoesLALUR)
    )
    return reply.code(200).send(resultado)
  })

  app.get('/ajuste-anual-lr/:empresaId/:ano', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId } = params.parse(request.params)
    const { ano: anoParam } = z.object({ ano: z.string().regex(/^\d{4}$/) }).parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: {
        tenantId,
        empresaId,
        competencia: `${anoParam}-12`,
        tipo: 'IRPJ_LR',
      },
      orderBy: { criadoEm: 'desc' },
    })
    if (!apuracao) return reply.code(404).send({ error: 'Ajuste anual LR não encontrado' })
    return apuracao
  })

  app.post('/esocial/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new ESocialService()
    return service.processar(tenantId, empresaId, competencia)
  })

  app.post('/dctfweb/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new DCTFWebService()
    return service.gerar(tenantId, empresaId, competencia)
  })

  app.post('/fgts/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new FGTSDigitalService()
    return service.apurar(tenantId, empresaId, competencia)
  })

  app.post('/fgts/grrf/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new FGTSDigitalService()
    return service.gerarGRRF(tenantId, empresaId, competencia)
  })

  app.post('/efdreinf/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new EFDReinfService()
    return service.processar(tenantId, empresaId, competencia)
  })

  app.post('/dms/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const service = new DMSService()
    return service.apurar(tenantId, empresaId, competencia)
  })

  // Enfileira job fiscal para uma empresa específica
  app.post('/job/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const { operacao } = z
      .object({ operacao: z.enum(OPERACOES_FISCAIS).default('TODOS') })
      .parse(request.body ?? {})

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    const job = await fiscalQueue.add(
      'fiscal-operacao',
      { tenantId, empresaId, cnpj: empresa.cnpj, competencia, operacao },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
    )

    return { jobId: job.id, status: 'ENFILEIRADO', operacao, competencia, empresa: empresa.cnpj }
  })

  // Enfileira jobs fiscais para todas as empresas ativas do tenant
  app.post('/batch/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { competencia } = z
      .object({ competencia: z.string().regex(/^\d{4}-\d{2}$/) })
      .parse(request.params)
    const { operacao } = z
      .object({ operacao: z.enum(OPERACOES_FISCAIS).default('TODOS') })
      .parse(request.body ?? {})

    const empresas = await db.empresaCliente.findMany({
      where: { tenantId, ativa: true },
      select: { id: true, cnpj: true },
    })

    const jobs = await Promise.all(
      empresas.map((empresa, idx) =>
        fiscalQueue.add(
          'fiscal-operacao',
          { tenantId, empresaId: empresa.id, cnpj: empresa.cnpj, competencia, operacao },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            delay: idx * 300,
          }
        )
      )
    )

    return {
      total: jobs.length,
      operacao,
      competencia,
      jobIds: jobs.map((j) => j.id),
    }
  })

  app.post('/monitoramento/calendario/:empresaId', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId } = request.params as { empresaId: string }
    const { ano } = request.query as { ano?: string }

    const service = new MonitoramentoSNService()
    return service.gerarCalendarioAnual(tenantId, empresaId, Number(ano ?? nowBR().getFullYear()))
  })

  // Verificação de risco de exclusão do Simples Nacional (últimos 12 meses)
  app.get('/monitoramento/risco-exclusao/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    const service = new MonitoramentoSNService()
    await service.verificarRiscoExclusao(tenantId, empresaId, competencia)

    const alertas = await db.alerta.findMany({
      where: {
        tenantId,
        empresaId,
        tipo: { in: ['RISCO_EXCLUSAO_SN', 'SUBLIMITE_ESTADUAL'] },
      },
      orderBy: { criadoEm: 'desc' },
      take: 5,
    })

    return { empresaId, cnpj: empresa.cnpj, competencia, alertas }
  })

  // Verificação de vencimentos de todas as empresas ativas do tenant
  app.get('/monitoramento/vencimentos', async (request) => {
    const { tenantId } = request.user as any
    const { competencia, diasAntecedencia } = request.query as {
      competencia?: string
      diasAntecedencia?: string
    }

    const comp = competencia ?? nowBR().toISOString().slice(0, 7)
    const dias = Number(diasAntecedencia ?? '7')

    const service = new MonitoramentoSNService()

    const empresas = await db.empresaCliente.findMany({
      where: { tenantId, ativa: true },
      select: { id: true, cnpj: true, razaoSocial: true },
    })

    const resultados = await Promise.all(
      empresas.map(async (emp) => {
        const obrigacoes = await service.verificarVencimentos(tenantId, emp.id, comp)
        const vencendoEm = nowBR()
        vencendoEm.setDate(vencendoEm.getDate() + dias)
        const proximas = obrigacoes.filter(
          (o) => o.status === 'PENDENTE' && new Date(o.vencimento) <= vencendoEm
        )
        return { ...emp, obrigacoesProximas: proximas.length, obrigacoes: proximas }
      })
    )

    return resultados
  })

  // ─── DASN / DEFIS ─────────────────────────────────────────────────────────

  // POST /fiscal/dasn/:empresaId/:ano — gera DASN para o ano fiscal
  app.post('/dasn/:empresaId/:ano', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, ano: anoStr } = request.params as { empresaId: string; ano: string }
    const ano = Number(anoStr)

    if (!Number.isInteger(ano) || ano < 2006 || ano > 2100) {
      return reply.code(400).send({ error: 'Ano inválido' })
    }

    const empresa = await db.empresaCliente.findFirst({ where: { id: empresaId, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    const service = new DasnService()
    return service.gerar(tenantId, empresaId, ano)
  })

  // GET /fiscal/dasn/:empresaId/:ano — consulta DASN gerada
  app.get('/dasn/:empresaId/:ano', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, ano: anoStr } = request.params as { empresaId: string; ano: string }

    const obrigacao = await db.obrigacao.findFirst({
      where: { tenantId, empresaId, tipo: 'DASN', competencia: anoStr },
    })
    if (!obrigacao) return reply.code(404).send({ error: 'DASN não gerada para este ano' })

    return obrigacao
  })

  // ─── Compliance Resumo ────────────────────────────────────────────────────

  // GET /fiscal/compliance/resumo?competencia=YYYY-MM
  // Retorna painel de compliance de todas as empresas ativas do tenant
  app.get('/compliance/resumo', async (request) => {
    const { tenantId } = request.user as any
    const { competencia } = request.query as { competencia?: string }
    const comp = competencia ?? nowBR().toISOString().slice(0, 7)
    const hoje = nowBR()

    const empresas = await db.empresaCliente.findMany({
      where: { tenantId, ativa: true },
      select: { id: true, cnpj: true, razaoSocial: true, regime: true },
      orderBy: { razaoSocial: 'asc' },
    })

    const resumosPorEmpresa = await Promise.all(
      empresas.map(async (emp) => {
        const obrigacoes = await db.obrigacao.findMany({
          where: { tenantId, empresaId: emp.id, competencia: comp },
          orderBy: { vencimento: 'asc' },
        })

        const pendentes = obrigacoes.filter((o) => o.status === 'PENDENTE')
        const atrasadas = pendentes.filter((o) => new Date(o.vencimento) < hoje)
        const proximasHoje = pendentes.filter((o) => {
          const diff = new Date(o.vencimento).getTime() - hoje.getTime()
          return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000
        })
        const cumpridas = obrigacoes.filter((o) => ['TRANSMITIDA', 'PAGA'].includes(o.status))

        return {
          empresa: emp,
          totalObrigacoes: obrigacoes.length,
          pendentes: pendentes.length,
          atrasadas: atrasadas.length,
          proximasSemana: proximasHoje.length,
          cumpridas: cumpridas.length,
          statusGeral:
            atrasadas.length > 0
              ? 'ATRASADA'
              : proximasHoje.length > 0
                ? 'PROXIMA'
                : pendentes.length > 0
                  ? 'PENDENTE'
                  : obrigacoes.length === 0
                    ? 'SEM_OBRIGACOES'
                    : 'EM_DIA',
          proximaObrigacao:
            pendentes.length > 0
              ? pendentes.sort(
                  (a, b) => new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime()
                )[0]
              : null,
        }
      })
    )

    const totalEmpresas = resumosPorEmpresa.length
    const totalAtrasadas = resumosPorEmpresa.filter((r) => r.atrasadas > 0).length
    const totalProximas = resumosPorEmpresa.filter(
      (r) => r.atrasadas === 0 && r.proximasSemana > 0
    ).length
    const totalEmDia = resumosPorEmpresa.filter((r) => r.statusGeral === 'EM_DIA').length

    return {
      competencia: comp,
      totais: { totalEmpresas, totalAtrasadas, totalProximas, totalEmDia },
      empresas: resumosPorEmpresa,
    }
  })

  // -------------------------------------------------------------------------
  // LALUR — Livro de Apuração do Lucro Real
  // -------------------------------------------------------------------------

  const lalurBodySchema = z.object({
    lucroLiquido: z.string(),
    adicoes: z
      .array(
        z.object({
          descricao: z.string(),
          codigoECF: z.string().optional(),
          valor: z.string(),
        })
      )
      .default([]),
    exclusoes: z
      .array(
        z.object({
          descricao: z.string(),
          codigoECF: z.string().optional(),
          valor: z.string(),
        })
      )
      .default([]),
  })

  app.post('/lalur/:empresaId/:competencia', async (request) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)
    const body = lalurBodySchema.parse(request.body)

    const service = new LALURService()
    return service.apurar(
      tenantId,
      empresaId,
      competencia,
      new Decimal(body.lucroLiquido),
      body.adicoes.map((a) => ({
        descricao: a.descricao,
        valor: new Decimal(a.valor),
        ...(a.codigoECF ? { codigoECF: a.codigoECF } : {}),
      })),
      body.exclusoes.map((e) => ({
        descricao: e.descricao,
        valor: new Decimal(e.valor),
        ...(e.codigoECF ? { codigoECF: e.codigoECF } : {}),
      }))
    )
  })

  app.get('/lalur/:empresaId/:competencia', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresaId, competencia } = params.parse(request.params)

    const apuracao = await db.apuracaoFiscal.findFirst({
      where: { tenantId, empresaId, competencia, tipo: 'IRPJ_LR' },
      orderBy: { criadoEm: 'desc' },
    })

    if (!apuracao) return reply.code(404).send({ error: 'LALUR não encontrado' })
    return apuracao
  })

  // -------------------------------------------------------------------------
  // Simulador Tributário — Comparativo SN × LP × LR
  // -------------------------------------------------------------------------

  const simuladorBodySchema = z.object({
    receitaBrutaAnual: z.string(),
    atividade: z.string().default('servicos'),
    folhaPagamentoAnual: z.string().default('0'),
    lucroEstimadoAnual: z.string().optional(),
  })

  app.post('/simulador-tributario', async (request) => {
    const { tenantId } = request.user as any
    const body = simuladorBodySchema.parse(request.body)

    const service = new SimuladorTributarioService()
    return service.simular(
      tenantId,
      new Decimal(body.receitaBrutaAnual),
      body.atividade,
      new Decimal(body.folhaPagamentoAnual),
      body.lucroEstimadoAnual ? new Decimal(body.lucroEstimadoAnual) : undefined
    )
  })
}
