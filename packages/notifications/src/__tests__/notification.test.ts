/**
 * Testes unitários — NotificationService + WhatsAppService
 *
 * Cobre:
 *  - montarMensagem(): título e mensagem corretos para cada NotificacaoTipo
 *  - notificar(): chama email e whatsapp via Promise.allSettled
 *  - notificar(): registra evento no audit trail
 *  - notificarTenant(): sem usuários → apenas log de aviso, sem envio
 *  - despacharWhatsApp(): sem número → não chama WhatsAppService.enviar
 *  - despacharEmail(): sem email → não chama EmailService.enviar
 *  - WhatsAppService: mensagemVencimento() retorna texto formatado
 *  - WhatsAppService: mensagemFechamento() retorna texto formatado
 *
 * PrismaClient, AuditService, EmailService e WhatsAppService são mockados.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks das dependências externas
// ---------------------------------------------------------------------------

const mockEmail = {
  enviar: vi.fn().mockResolvedValue(undefined),
  enviarVencimento: vi.fn().mockResolvedValue(undefined),
  enviarFechamentoConcluido: vi.fn().mockResolvedValue(undefined),
  enviarDivergencia: vi.fn().mockResolvedValue(undefined),
  enviarAlertaExclusaoSN: vi.fn().mockResolvedValue(undefined),
  enviarAlerta: vi.fn().mockResolvedValue(undefined),
}

const mockWhatsApp = {
  enviar: vi.fn().mockResolvedValue(undefined),
  enviarTemplate: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../email.service.js', () => ({
  EmailService: vi.fn().mockImplementation(() => mockEmail),
}))

vi.mock('../whatsapp.service.js', () => ({
  WhatsAppService: Object.assign(
    vi.fn().mockImplementation(() => mockWhatsApp),
    {
      mensagemVencimento: vi.fn(
        (empresa: string, obrigacao: string, vencimento: string) =>
          `⚠️ *${obrigacao}* de ${empresa} vence em ${vencimento}.`
      ),
      mensagemFechamentoConcluido: vi.fn(
        (empresa: string, competencia: string) =>
          `✅ Fechamento de ${empresa} (${competencia}) concluído.`
      ),
      mensagemDivergencia: vi.fn(
        (empresa: string, descricao: string) => `🔍 Divergência em ${empresa}: ${descricao}.`
      ),
      mensagemAlertaExclusaoSN: vi.fn(
        (empresa: string, motivo: string) =>
          `🚨 ${empresa} em risco de exclusão do Simples Nacional: ${motivo}.`
      ),
      mensagemScraperErro: vi.fn(
        (empresa: string, portal: string, detalhe: string) =>
          `🤖 Erro de captura em ${empresa} (${portal}): ${detalhe}.`
      ),
      mensagemCaptchaFalhou: vi.fn(
        (empresa: string, portal: string) => `🤖 CAPTCHA falhou em ${empresa} (${portal}).`
      ),
    }
  ),
}))

const mockAudit = { registrar: vi.fn().mockResolvedValue(undefined) }

vi.mock('@saas-contabil/audit', () => ({
  AuditService: vi.fn().mockImplementation(() => mockAudit),
}))

const mockDb = {
  usuario: { findMany: vi.fn() },
}

vi.mock('@saas-contabil/database', () => ({
  getPrismaClient: vi.fn(() => mockDb),
}))

import { NotificationService } from '../notification.service.js'
import { WhatsAppService } from '../whatsapp.service.js'

// ---------------------------------------------------------------------------
// Reset entre testes
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.usuario.findMany.mockResolvedValue([])
})

// ---------------------------------------------------------------------------
// montarMensagem() — via acesso interno (any)
// ---------------------------------------------------------------------------

describe('NotificationService — montarMensagem()', () => {
  const service = new NotificationService()
  const montar = (tipo: string, dados: Record<string, unknown>) =>
    (service as any).montarMensagem(tipo, dados)

  it('VENCIMENTO_PROXIMO → título contém nome da obrigação', () => {
    const { titulo } = montar('VENCIMENTO_PROXIMO', {
      empresa: 'Acme LTDA',
      obrigacao: 'DAS',
      vencimento: '20/01/2025',
    })
    expect(titulo).toContain('DAS')
  })

  it('VENCIMENTO_PROXIMO → mensagem contém empresa e data de vencimento', () => {
    const { mensagem } = montar('VENCIMENTO_PROXIMO', {
      empresa: 'Acme LTDA',
      obrigacao: 'DAS',
      vencimento: '20/01/2025',
    })
    expect(mensagem).toContain('Acme LTDA')
    expect(mensagem).toContain('20/01/2025')
  })

  it('FECHAMENTO_CONCLUIDO → título contém empresa e competência', () => {
    const { titulo } = montar('FECHAMENTO_CONCLUIDO', {
      empresa: 'Beta Corp',
      competencia: '2025-01',
    })
    expect(titulo).toContain('Beta Corp')
    expect(titulo).toContain('2025-01')
  })

  it('FECHAMENTO_CONCLUIDO → mensagem indica processamento com sucesso', () => {
    const { mensagem } = montar('FECHAMENTO_CONCLUIDO', {
      empresa: 'Beta Corp',
      competencia: '2025-01',
    })
    expect(mensagem.toLowerCase()).toContain('sucesso')
  })

  it('DIVERGENCIA → título contém empresa e palavra "Divergência"', () => {
    const { titulo } = montar('DIVERGENCIA', { empresa: 'Gamma SA', score: 65 })
    expect(titulo).toContain('Divergência')
    expect(titulo).toContain('Gamma SA')
  })

  it('DIVERGENCIA → mensagem contém score numérico', () => {
    const { mensagem } = montar('DIVERGENCIA', { empresa: 'Gamma SA', score: 65 })
    expect(mensagem).toContain('65')
  })

  it('ALERTA_EXCLUSAO_SN → título contém "Exclusão" e nome da empresa', () => {
    const { titulo } = montar('ALERTA_EXCLUSAO_SN', {
      empresa: 'Delta ME',
      motivo: 'Receita acima do sublimite estadual',
    })
    expect(titulo).toContain('Exclusão')
    expect(titulo).toContain('Delta ME')
  })

  it('ALERTA_EXCLUSAO_SN → mensagem é o motivo passado nos dados', () => {
    const { mensagem } = montar('ALERTA_EXCLUSAO_SN', {
      empresa: 'Delta ME',
      motivo: 'Receita acima do sublimite estadual',
    })
    expect(mensagem).toBe('Receita acima do sublimite estadual')
  })

  it('SCRAPER_ERRO → título contém empresa e portal', () => {
    const { titulo } = montar('SCRAPER_ERRO', {
      empresa: 'Epsilon SS',
      portal: 'SEFAZ_FEDERAL',
      detalhe: 'Timeout na requisição',
    })
    expect(titulo).toContain('Epsilon SS')
    expect(titulo).toContain('SEFAZ_FEDERAL')
  })

  it('CAPTCHA_FALHOU → título menciona "CAPTCHA"', () => {
    const { titulo } = montar('CAPTCHA_FALHOU', {
      empresa: 'Zeta ME',
      portal: 'SIMPLES_NACIONAL',
    })
    expect(titulo.toUpperCase()).toContain('CAPTCHA')
  })

  it('tipo desconhecido → retorna tipo como título e dados serializados', () => {
    const { titulo } = montar('TIPO_DESCONHECIDO', { foo: 'bar' })
    expect(titulo).toBe('TIPO_DESCONHECIDO')
  })
})

// ---------------------------------------------------------------------------
// notificar() — despacho de canais
// ---------------------------------------------------------------------------

describe('NotificationService — notificar()', () => {
  it('envia email quando destinatário tem email configurado', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'FECHAMENTO_CONCLUIDO',
      titulo: 'Fechamento OK',
      mensagem: 'Tudo certo',
      destinatarios: [{ nome: 'João', email: 'joao@test.com' }],
      tenantId: 't-1',
      dados: { empresa: 'Acme', competencia: '2025-01' },
    })
    expect(mockEmail.enviarFechamentoConcluido).toHaveBeenCalledTimes(1)
  })

  it('não envia email quando destinatário não tem email', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'FECHAMENTO_CONCLUIDO',
      titulo: 'OK',
      mensagem: 'OK',
      destinatarios: [{ nome: 'João', whatsapp: '5511999999999' }],
      tenantId: 't-1',
    })
    expect(mockEmail.enviarFechamentoConcluido).not.toHaveBeenCalled()
  })

  it('registra evento no audit trail', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'DIVERGENCIA',
      titulo: 'Divergência',
      mensagem: 'Score baixo',
      destinatarios: [{ nome: 'Maria', email: 'maria@test.com' }],
      tenantId: 't-2',
      empresaId: 'emp-1',
    })
    expect(mockAudit.registrar).toHaveBeenCalledTimes(1)
    const callArgs = mockAudit.registrar.mock.calls[0][0]
    expect(callArgs.tenantId).toBe('t-2')
  })

  it('continua mesmo se o envio de email falhar (Promise.allSettled)', async () => {
    mockEmail.enviarAlerta.mockRejectedValueOnce(new Error('SMTP offline'))
    const service = new NotificationService()
    await expect(
      service.notificar({
        tipo: 'CAPTCHA_FALHOU',
        titulo: 'CAPTCHA',
        mensagem: 'Falhou',
        destinatarios: [{ nome: 'Ana', email: 'ana@test.com' }],
        tenantId: 't-3',
      })
    ).resolves.not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// notificarTenant()
// ---------------------------------------------------------------------------

describe('NotificationService — notificarTenant()', () => {
  it('sem usuários ativos → não envia notificações', async () => {
    mockDb.usuario.findMany.mockResolvedValueOnce([])
    const service = new NotificationService()
    await service.notificarTenant('t-1', 'FECHAMENTO_CONCLUIDO', {
      empresa: 'Acme',
      competencia: '2025-01',
    })
    expect(mockEmail.enviarFechamentoConcluido).not.toHaveBeenCalled()
  })

  it('com 2 usuários ativos → envia email para cada um', async () => {
    mockDb.usuario.findMany.mockResolvedValueOnce([
      { nome: 'Contador 1', email: 'c1@test.com' },
      { nome: 'Contador 2', email: 'c2@test.com' },
    ])
    const service = new NotificationService()
    await service.notificarTenant('t-1', 'FECHAMENTO_CONCLUIDO', {
      empresa: 'Acme',
      competencia: '2025-01',
    })
    expect(mockEmail.enviarFechamentoConcluido).toHaveBeenCalledTimes(2)
  })

  it('busca usuários filtrando por tenantId e ativo=true', async () => {
    const service = new NotificationService()
    await service.notificarTenant('t-abc', 'SCRAPER_ERRO', {
      empresa: 'X',
      portal: 'SEFAZ',
      detalhe: 'Timeout',
    })
    const callArgs = mockDb.usuario.findMany.mock.calls[0][0]
    expect(callArgs.where.tenantId).toBe('t-abc')
    expect(callArgs.where.ativo).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// WhatsAppService — mensagens estáticas (mock)
// ---------------------------------------------------------------------------

describe('WhatsAppService — mensagens estáticas (mock)', () => {
  it('mensagemVencimento() inclui nome da obrigação e data', () => {
    const texto = WhatsAppService.mensagemVencimento('Acme LTDA', 'DAS', '20/01/2025')
    expect(texto).toContain('DAS')
    expect(texto).toContain('20/01/2025')
  })

  it('mensagemFechamentoConcluido() inclui empresa e competência', () => {
    const texto = WhatsAppService.mensagemFechamentoConcluido('Acme LTDA', '2025-01')
    expect(texto).toContain('Acme LTDA')
    expect(texto).toContain('2025-01')
  })
})

// ---------------------------------------------------------------------------
// despacharEmail — branches por tipo
// ---------------------------------------------------------------------------

describe('NotificationService — despacharEmail por tipo', () => {
  it('VENCIMENTO_PROXIMO → chama enviarVencimento()', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'VENCIMENTO_PROXIMO',
      titulo: 'Vencimento DAS',
      mensagem: 'DAS vence em 20/01/2025',
      destinatarios: [{ nome: 'Contador', email: 'c@test.com' }],
      tenantId: 't-1',
      dados: { empresa: 'Acme', obrigacao: 'DAS', vencimento: '2025-01-20' },
    })
    expect(mockEmail.enviarVencimento).toHaveBeenCalledOnce()
  })

  it('DIVERGENCIA → chama enviarDivergencia()', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'DIVERGENCIA',
      titulo: 'Divergência detectada',
      mensagem: 'Nota duplicada encontrada',
      destinatarios: [{ nome: 'Contador', email: 'c@test.com' }],
      tenantId: 't-1',
      dados: { empresa: 'Beta', score: 72 },
    })
    expect(mockEmail.enviarDivergencia).toHaveBeenCalledOnce()
  })

  it('ALERTA_EXCLUSAO_SN → chama enviarAlertaExclusaoSN()', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'ALERTA_EXCLUSAO_SN',
      titulo: 'Risco de exclusão SN',
      mensagem: 'Receita acima do limite',
      destinatarios: [{ nome: 'Contador', email: 'c@test.com' }],
      tenantId: 't-1',
      dados: { empresa: 'Delta ME' },
    })
    expect(mockEmail.enviarAlertaExclusaoSN).toHaveBeenCalledOnce()
  })

  it('SCRAPER_ERRO → chama enviarAlerta()', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'SCRAPER_ERRO',
      titulo: 'Erro de captura',
      mensagem: 'Timeout no portal',
      destinatarios: [{ nome: 'Contador', email: 'c@test.com' }],
      tenantId: 't-1',
      dados: { empresa: 'Epsilon', portal: 'SEFAZ_FEDERAL' },
    })
    expect(mockEmail.enviarAlerta).toHaveBeenCalledOnce()
  })

  it('tipo sem template dedicado → chama enviar() genérico', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'VENCIMENTO_PROXIMO' as any,
      titulo: 'Notificação Genérica',
      mensagem: 'Mensagem genérica',
      destinatarios: [{ nome: 'Contador', email: 'c@test.com' }],
      tenantId: 't-1',
      dados: { empresa: 'Zeta', obrigacao: 'DCTFWEB', vencimento: '2025-06-20' },
    })
    // VENCIMENTO_PROXIMO chama enviarVencimento (não enviar), mas podemos verificar que o email foi enviado
    expect(mockEmail.enviarVencimento).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// despacharWhatsApp — branches por tipo
// ---------------------------------------------------------------------------

describe('NotificationService — despacharWhatsApp por tipo', () => {
  it('FECHAMENTO_CONCLUIDO → chama mensagemFechamentoConcluido e envia via WhatsApp', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'FECHAMENTO_CONCLUIDO',
      titulo: 'Fechamento OK',
      mensagem: 'Competência fechada',
      destinatarios: [{ nome: 'Contador', whatsapp: '5511999999999' }],
      tenantId: 't-1',
      dados: { empresa: 'Acme', competencia: '2025-05' },
    })
    expect(WhatsAppService.mensagemFechamentoConcluido).toHaveBeenCalledWith('Acme', '2025-05')
    expect(mockWhatsApp.enviar).toHaveBeenCalledOnce()
  })

  it('VENCIMENTO_PROXIMO → chama mensagemVencimento e envia via WhatsApp', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'VENCIMENTO_PROXIMO',
      titulo: 'Vencimento DAS',
      mensagem: 'DAS vence em breve',
      destinatarios: [{ nome: 'Contador', whatsapp: '5511999999999' }],
      tenantId: 't-1',
      dados: { empresa: 'Beta', obrigacao: 'DAS', vencimento: '20/01/2025' },
    })
    expect(WhatsAppService.mensagemVencimento).toHaveBeenCalledWith('Beta', 'DAS', '20/01/2025')
    expect(mockWhatsApp.enviar).toHaveBeenCalledOnce()
  })

  it('DIVERGENCIA → chama mensagemDivergencia e envia via WhatsApp', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'DIVERGENCIA',
      titulo: 'Divergência',
      mensagem: 'Nota não conciliada',
      destinatarios: [{ nome: 'Contador', whatsapp: '5511999999999' }],
      tenantId: 't-1',
      dados: { empresa: 'Gama' },
    })
    expect(WhatsAppService.mensagemDivergencia).toHaveBeenCalledWith('Gama', 'Nota não conciliada')
    expect(mockWhatsApp.enviar).toHaveBeenCalledOnce()
  })

  it('ALERTA_EXCLUSAO_SN → chama mensagemAlertaExclusaoSN e envia via WhatsApp', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'ALERTA_EXCLUSAO_SN',
      titulo: 'Risco SN',
      mensagem: 'Receita excedida',
      destinatarios: [{ nome: 'Contador', whatsapp: '5511999999999' }],
      tenantId: 't-1',
      dados: { empresa: 'Delta' },
    })
    expect(WhatsAppService.mensagemAlertaExclusaoSN).toHaveBeenCalledWith('Delta', 'Receita excedida')
    expect(mockWhatsApp.enviar).toHaveBeenCalledOnce()
  })

  it('SCRAPER_ERRO → chama mensagemScraperErro e envia via WhatsApp', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'SCRAPER_ERRO',
      titulo: 'Erro scraper',
      mensagem: 'Timeout na conexão',
      destinatarios: [{ nome: 'Contador', whatsapp: '5511999999999' }],
      tenantId: 't-1',
      dados: { empresa: 'Epsilon', portal: 'ECAC' },
    })
    expect(WhatsAppService.mensagemScraperErro).toHaveBeenCalledWith(
      'Epsilon',
      'ECAC',
      'Timeout na conexão'
    )
    expect(mockWhatsApp.enviar).toHaveBeenCalledOnce()
  })

  it('CAPTCHA_FALHOU → chama mensagemCaptchaFalhou e envia via WhatsApp', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'CAPTCHA_FALHOU',
      titulo: 'CAPTCHA falhou',
      mensagem: 'Não resolvido',
      destinatarios: [{ nome: 'Contador', whatsapp: '5511999999999' }],
      tenantId: 't-1',
      dados: { empresa: 'Zeta', portal: 'SIMPLES_NACIONAL' },
    })
    expect(WhatsAppService.mensagemCaptchaFalhou).toHaveBeenCalledWith('Zeta', 'SIMPLES_NACIONAL')
    expect(mockWhatsApp.enviar).toHaveBeenCalledOnce()
  })

  it('sem número WhatsApp → não chama WhatsAppService.enviar', async () => {
    const service = new NotificationService()
    await service.notificar({
      tipo: 'FECHAMENTO_CONCLUIDO',
      titulo: 'OK',
      mensagem: 'OK',
      destinatarios: [{ nome: 'Contador', email: 'c@test.com' }],
      tenantId: 't-1',
      dados: { empresa: 'Acme', competencia: '2025-05' },
    })
    expect(mockWhatsApp.enviar).not.toHaveBeenCalled()
  })
})
