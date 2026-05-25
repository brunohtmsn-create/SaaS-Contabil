import {
  getPrismaClient,
  AuditEvent,
  TipoEventoAudit,
  EntidadeAuditavel,
  TipoResponsavel,
} from '@saas-contabil/database'
import { sha256, nowBR } from '@saas-contabil/shared'

type RegistrarEventoInput = {
  tenantId: string
  cnpj?: string
  entidadeTipo: EntidadeAuditavel
  entidadeId: string
  evento: TipoEventoAudit
  estadoAnterior?: unknown
  estadoNovo?: unknown
  responsavel: string
  responsavelTipo: TipoResponsavel
  evidencias?: string[]
  score?: number
  aprovadoPor?: string
  observacao?: string
  ipOrigem?: string
  jobId?: string
  duracao?: number
}

export class AuditService {
  private db = getPrismaClient()

  async registrar(input: RegistrarEventoInput): Promise<AuditEvent> {
    const ultimo = await this.db.auditEvent.findFirst({
      where: { tenantId: input.tenantId },
      orderBy: { sequencia: 'desc' },
      select: { hashEvento: true },
    })

    const hashAnterior = ultimo?.hashEvento ?? sha256('GENESIS')

    const payload = {
      tenantId: input.tenantId,
      cnpj: input.cnpj ?? null,
      entidadeTipo: input.entidadeTipo,
      entidadeId: input.entidadeId,
      evento: input.evento,
      estadoAnterior: input.estadoAnterior ?? null,
      estadoNovo: input.estadoNovo ?? null,
      responsavel: input.responsavel,
      responsavelTipo: input.responsavelTipo,
      evidencias: input.evidencias ?? [],
      score: input.score ?? null,
      aprovadoPor: input.aprovadoPor ?? null,
      observacao: input.observacao ?? null,
      timestamp: nowBR(),
      ipOrigem: input.ipOrigem ?? null,
      jobId: input.jobId ?? null,
      duracao: input.duracao ?? null,
    }

    const hashEvento = sha256(JSON.stringify({ ...payload, hashAnterior }))

    return this.db.auditEvent.create({
      data: { ...payload, hashEvento, hashAnterior },
    })
  }

  async buscarEventos(tenantId: string, cnpj?: string, limit = 100): Promise<AuditEvent[]> {
    return this.db.auditEvent.findMany({
      where: { tenantId, ...(cnpj ? { cnpj } : {}) },
      orderBy: { sequencia: 'desc' },
      take: limit,
    })
  }

  async buscarPendentesRevisao(tenantId: string): Promise<AuditEvent[]> {
    return this.db.auditEvent.findMany({
      where: { tenantId, evento: 'PENDENTE_REVISAO_HUMANA' },
      orderBy: { timestamp: 'asc' },
    })
  }

  async aprovar(eventId: string, usuario: string, tenantId: string): Promise<void> {
    const evento = await this.db.auditEvent.findFirst({
      where: { id: eventId, tenantId },
    })
    if (!evento) throw new Error('Evento não encontrado')

    await this.registrar({
      tenantId,
      entidadeTipo: evento.entidadeTipo,
      entidadeId: evento.entidadeId,
      evento: 'APROVACAO_HUMANA',
      estadoAnterior: { eventoAprovado: eventId },
      estadoNovo: { aprovadoPor: usuario },
      responsavel: usuario,
      responsavelTipo: 'USUARIO',
      aprovadoPor: usuario,
    })
  }
}
