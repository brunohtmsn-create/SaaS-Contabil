import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrismaClient } from '@saas-contabil/database'
import { validarCNPJ, nowBR } from '@saas-contabil/shared'
import { MonitoramentoSNService, CalendarioLPLRService } from '@saas-contabil/fiscal'

const createEmpresaSchema = z.object({
  cnpj: z.string().length(14).refine(validarCNPJ, { message: 'CNPJ inválido' }),
  razaoSocial: z.string().min(1),
  nomeFantasia: z.string().optional(),
  regime: z.enum(['SIMPLES_NACIONAL', 'MEI', 'LUCRO_PRESUMIDO', 'LUCRO_REAL']),
  cnae: z.string(),
  uf: z.string().length(2),
  municipio: z.string(),
  ibge: z.string().length(7),
  dataAbertura: z.string(),
})

// Cache em memória da consulta CNPJ — dados cadastrais mudam raramente;
// evita rate limit da BrasilAPI durante onboarding em massa
const CNPJ_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CNPJ_CACHE_MAX = 5000
const cnpjCache = new Map<string, { expiraEm: number; dados: unknown }>()

export function limparCacheCNPJ(): void {
  cnpjCache.clear()
}

export async function empresaRoutes(app: FastifyInstance) {
  const db = getPrismaClient()

  app.get('/', async (request) => {
    const { tenantId } = request.user as any
    const { incluiInativas } = request.query as { incluiInativas?: string }
    const where: any = { tenantId }
    if (incluiInativas !== 'true') where.ativa = true
    return db.empresaCliente.findMany({ where, orderBy: { razaoSocial: 'asc' } })
  })

  app.get('/:id', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    const empresa = await db.empresaCliente.findFirst({ where: { id, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })
    return empresa
  })

  // GET /empresas/consultar-cnpj/:cnpj — consulta dados cadastrais na BrasilAPI
  // Usado para pré-preencher o formulário de cadastro (não persiste nada)
  app.get('/consultar-cnpj/:cnpj', async (request, reply) => {
    const { cnpj } = request.params as { cnpj: string }
    const digits = cnpj.replace(/\D/g, '')

    if (digits.length !== 14 || !validarCNPJ(digits)) {
      return reply.code(400).send({ error: 'CNPJ inválido' })
    }

    const emCache = cnpjCache.get(digits)
    if (emCache && emCache.expiraEm > Date.now()) {
      return emCache.dados
    }

    let res: Response
    try {
      res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      return reply
        .code(502)
        .send({ error: 'Falha ao consultar a Receita Federal — tente novamente' })
    }

    if (res.status === 404) {
      return reply.code(404).send({ error: 'CNPJ não encontrado na Receita Federal' })
    }
    if (!res.ok) {
      return reply.code(502).send({ error: 'Serviço de consulta indisponível — tente novamente' })
    }

    const dados = (await res.json()) as {
      razao_social?: string
      nome_fantasia?: string
      cnae_fiscal?: number
      uf?: string
      municipio?: string
      codigo_municipio_ibge?: number
      data_inicio_atividade?: string
      opcao_pelo_simples?: boolean | null
      opcao_pelo_mei?: boolean | null
      descricao_situacao_cadastral?: string
    }

    // Sugestão de regime a partir das opções declaradas (contador confirma no formulário)
    let regimeSugerido: string | null = null
    if (dados.opcao_pelo_mei) regimeSugerido = 'MEI'
    else if (dados.opcao_pelo_simples) regimeSugerido = 'SIMPLES_NACIONAL'

    const resultado = {
      cnpj: digits,
      razaoSocial: dados.razao_social ?? '',
      nomeFantasia: dados.nome_fantasia ?? '',
      cnae: dados.cnae_fiscal ? String(dados.cnae_fiscal) : '',
      uf: dados.uf ?? '',
      municipio: dados.municipio ?? '',
      ibge: dados.codigo_municipio_ibge ? String(dados.codigo_municipio_ibge) : '',
      dataAbertura: dados.data_inicio_atividade ?? '',
      regimeSugerido,
      situacaoCadastral: dados.descricao_situacao_cadastral ?? '',
    }

    // Eviction simples: remove a entrada mais antiga quando o cache enche
    if (cnpjCache.size >= CNPJ_CACHE_MAX) {
      const maisAntiga = cnpjCache.keys().next().value
      if (maisAntiga) cnpjCache.delete(maisAntiga)
    }
    cnpjCache.set(digits, { expiraEm: Date.now() + CNPJ_CACHE_TTL_MS, dados: resultado })

    return resultado
  })

  app.post('/', async (request, reply) => {
    const { tenantId } = request.user as any
    const data = createEmpresaSchema.parse(request.body)

    const existing = await db.empresaCliente.findFirst({ where: { tenantId, cnpj: data.cnpj } })
    if (existing) return reply.code(409).send({ error: 'CNPJ já cadastrado' })

    const { nomeFantasia, ...requiredFields } = data
    const empresa = await db.empresaCliente.create({
      data: {
        ...requiredFields,
        tenantId,
        dataAbertura: new Date(data.dataAbertura),
        ...(nomeFantasia !== undefined && { nomeFantasia }),
      },
    })

    // Gera calendário anual automaticamente no ano corrente
    const ano = nowBR().getFullYear()
    if (data.regime === 'SIMPLES_NACIONAL' || data.regime === 'MEI') {
      const sn = new MonitoramentoSNService()
      await sn.gerarCalendarioAnual(tenantId, empresa.id, ano).catch(() => {})
    } else if (data.regime === 'LUCRO_PRESUMIDO' || data.regime === 'LUCRO_REAL') {
      const lplr = new CalendarioLPLRService()
      await lplr.gerarCalendarioAnual(tenantId, empresa.id, ano).catch(() => {})
    }

    return empresa
  })

  // POST /empresas/importar — importação em lote (piloto: ~500 empresas)
  // Valida linha a linha: uma linha inválida não bloqueia as demais.
  app.post('/importar', async (request, reply) => {
    const { tenantId } = request.user as any
    const { empresas } = z
      .object({ empresas: z.array(z.unknown()).min(1).max(1000) })
      .parse(request.body)

    // CNPJs já cadastrados no tenant — uma única query
    const cnpjsPayload = empresas
      .map((e) => (e as { cnpj?: unknown })?.cnpj)
      .filter((c): c is string => typeof c === 'string')
    const existentes = await db.empresaCliente.findMany({
      where: { tenantId, cnpj: { in: cnpjsPayload } },
      select: { cnpj: true },
    })
    const jaCadastrados = new Set(existentes.map((e: { cnpj: string }) => e.cnpj))

    const vistos = new Set<string>()
    const criadas: { id: string; cnpj: string }[] = []
    const erros: { linha: number; cnpj: string; motivo: string }[] = []
    const ano = nowBR().getFullYear()
    const sn = new MonitoramentoSNService()
    const lplr = new CalendarioLPLRService()

    for (const [i, raw] of empresas.entries()) {
      const linha = i + 1
      const cnpjRaw = String((raw as { cnpj?: unknown })?.cnpj ?? '?')

      const parsed = createEmpresaSchema.safeParse(raw)
      if (!parsed.success) {
        const motivo = parsed.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join('; ')
        erros.push({ linha, cnpj: cnpjRaw, motivo })
        continue
      }
      const data = parsed.data

      if (vistos.has(data.cnpj)) {
        erros.push({ linha, cnpj: data.cnpj, motivo: 'CNPJ duplicado no arquivo' })
        continue
      }
      vistos.add(data.cnpj)

      if (jaCadastrados.has(data.cnpj)) {
        erros.push({ linha, cnpj: data.cnpj, motivo: 'CNPJ já cadastrado' })
        continue
      }

      try {
        const { nomeFantasia, ...requiredFields } = data
        const empresa = await db.empresaCliente.create({
          data: {
            ...requiredFields,
            tenantId,
            dataAbertura: new Date(data.dataAbertura),
            ...(nomeFantasia !== undefined && { nomeFantasia }),
          },
        })
        criadas.push({ id: empresa.id, cnpj: data.cnpj })

        if (data.regime === 'SIMPLES_NACIONAL' || data.regime === 'MEI') {
          await sn.gerarCalendarioAnual(tenantId, empresa.id, ano).catch(() => {})
        } else {
          await lplr.gerarCalendarioAnual(tenantId, empresa.id, ano).catch(() => {})
        }
      } catch (err) {
        erros.push({
          linha,
          cnpj: data.cnpj,
          motivo: err instanceof Error ? err.message : 'Erro ao criar empresa',
        })
      }
    }

    return reply.code(201).send({
      total: empresas.length,
      importadas: criadas.length,
      rejeitadas: erros.length,
      criadas,
      erros,
    })
  })

  app.patch('/:id', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    const data = createEmpresaSchema.partial().parse(request.body)

    const empresa = await db.empresaCliente.findFirst({ where: { id, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    // tenantId no where garante isolamento multi-tenant — filtra undefined para compatibilidade exactOptionalPropertyTypes
    const updateData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
    return db.empresaCliente.update({
      where: { id, tenantId },
      data: updateData as Parameters<typeof db.empresaCliente.update>[0]['data'],
    })
  })

  app.delete('/:id', async (request, reply) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }

    const empresa = await db.empresaCliente.findFirst({ where: { id, tenantId } })
    if (!empresa) return reply.code(404).send({ error: 'Empresa não encontrada' })

    await db.empresaCliente.update({ where: { id, tenantId }, data: { ativa: false } })
    return { success: true }
  })

  app.get('/:id/alertas', async (request) => {
    const { tenantId } = request.user as any
    const { id } = request.params as { id: string }
    return db.alerta.findMany({
      where: { tenantId, empresaId: id, lido: false },
      orderBy: { criadoEm: 'desc' },
    })
  })
}
