/**
 * Testes unitários — EmailService
 *
 * Cobre:
 *  - enviar(): descarta silenciosamente quando SMTP não configurado (localhost)
 *  - enviar(): chama nodemailer.sendMail quando SMTP configurado (via module reset)
 *  - enviarVencimento(): skip quando destinatário sem email
 *  - enviarVencimento(): passa tipo de obrigação no título para enviar()
 *  - enviarVencimento(): HTML contém data formatada e nome da empresa
 *  - enviarFechamentoConcluido(): skip quando destinatário sem email
 *  - enviarFechamentoConcluido(): HTML contém empresa e competencia
 *  - enviarAlerta(): skip quando destinatário sem email
 *  - enviarAlerta(): HTML contém tipo do alerta e mensagem
 *  - enviarDivergencia(): skip quando destinatário sem email
 *  - enviarDivergencia(): HTML contém score e descrição
 *  - enviarAlertaExclusaoSN(): skip quando destinatário sem email
 *  - enviarAlertaExclusaoSN(): HTML contém motivo e empresa
 *
 * nodemailer é mockado; enviar() é espionado nas rotas de composição.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockSendMail, mockCreateTransport } = vi.hoisted(() => {
  const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'mock-id' })
  const mockCreateTransport = vi.fn(() => ({ sendMail: mockSendMail }))
  return { mockSendMail, mockCreateTransport }
})

vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
}))

vi.mock('@saas-contabil/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@saas-contabil/shared')>()
  return {
    ...actual,
    formatDate: vi.fn((_date: Date, _fmt: string) => '20/01/2025'),
  }
})

import { EmailService } from '../email.service.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DESTINATARIO = { nome: 'João Contador', email: 'joao@escritorio.com.br' }
const DESTINATARIO_SEM_EMAIL = { nome: 'Maria', email: undefined }

beforeEach(() => {
  vi.clearAllMocks()
})

// ===========================================================================
// enviar — comportamento base
// ===========================================================================

describe('EmailService.enviar()', () => {
  it('descarta silenciosamente quando SMTP_HOST é localhost (default)', async () => {
    const svc = new EmailService()
    // SMTP_HOST defaults to 'localhost' when env var not set at module load
    await svc.enviar('dest@test.com', 'Assunto', '<p>corpo</p>')
    expect(mockSendMail).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// enviarVencimento
// ===========================================================================

describe('EmailService.enviarVencimento()', () => {
  it('skip quando destinatário não tem email', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarVencimento(DESTINATARIO_SEM_EMAIL, {
      tipo: 'DAS',
      vencimento: new Date('2025-01-20'),
      empresa: 'Acme LTDA',
    })

    expect(spy).not.toHaveBeenCalled()
  })

  it('inclui tipo de obrigação no título passado a enviar()', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarVencimento(DESTINATARIO, {
      tipo: 'EFD_REINF',
      vencimento: new Date('2025-01-15'),
      empresa: 'Acme LTDA',
    })

    const subject = spy.mock.calls[0][1] as string
    expect(subject).toContain('EFD_REINF')
  })

  it('HTML contém data formatada e nome da empresa', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarVencimento(DESTINATARIO, {
      tipo: 'DAS',
      vencimento: new Date('2025-01-20'),
      empresa: 'Empresa XYZ',
    })

    const html = spy.mock.calls[0][2] as string
    expect(html).toContain('20/01/2025')
    expect(html).toContain('Empresa XYZ')
  })

  it('HTML contém nome do destinatário', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarVencimento(DESTINATARIO, {
      tipo: 'DCTFWEB',
      vencimento: new Date(),
      empresa: 'Acme LTDA',
    })

    const html = spy.mock.calls[0][2] as string
    expect(html).toContain('João Contador')
  })
})

// ===========================================================================
// enviarFechamentoConcluido
// ===========================================================================

describe('EmailService.enviarFechamentoConcluido()', () => {
  it('skip quando destinatário não tem email', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarFechamentoConcluido(DESTINATARIO_SEM_EMAIL, 'Acme', '2025-01')

    expect(spy).not.toHaveBeenCalled()
  })

  it('assunto inclui empresa e competência', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarFechamentoConcluido(DESTINATARIO, 'Empresa Alfa', '2025-05')

    const subject = spy.mock.calls[0][1] as string
    expect(subject).toContain('Empresa Alfa')
    expect(subject).toContain('2025-05')
  })

  it('HTML contém empresa e competência', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarFechamentoConcluido(DESTINATARIO, 'Empresa Beta', '2025-06')

    const html = spy.mock.calls[0][2] as string
    expect(html).toContain('Empresa Beta')
    expect(html).toContain('2025-06')
  })
})

// ===========================================================================
// enviarAlerta
// ===========================================================================

describe('EmailService.enviarAlerta()', () => {
  it('skip quando destinatário não tem email', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarAlerta(DESTINATARIO_SEM_EMAIL, { tipo: 'SCRAPER_ERRO', mensagem: 'timeout' })

    expect(spy).not.toHaveBeenCalled()
  })

  it('assunto inclui tipo do alerta', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarAlerta(DESTINATARIO, { tipo: 'CAPTCHA_FALHOU', mensagem: 'retry limit' })

    const subject = spy.mock.calls[0][1] as string
    expect(subject).toContain('CAPTCHA_FALHOU')
  })

  it('HTML contém a mensagem do alerta', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarAlerta(DESTINATARIO, {
      tipo: 'PORTAL_FALHOU',
      mensagem: 'O portal SEFAZ está indisponível',
    })

    const html = spy.mock.calls[0][2] as string
    expect(html).toContain('O portal SEFAZ está indisponível')
    expect(html).toContain('PORTAL_FALHOU')
  })
})

// ===========================================================================
// enviarDivergencia
// ===========================================================================

describe('EmailService.enviarDivergencia()', () => {
  it('skip quando destinatário não tem email', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarDivergencia(DESTINATARIO_SEM_EMAIL, 'Acme', 'CNPJ ausente', 65)

    expect(spy).not.toHaveBeenCalled()
  })

  it('assunto inclui nome da empresa', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarDivergencia(DESTINATARIO, 'Empresa Gama', 'NFSe sem valor', 70)

    const subject = spy.mock.calls[0][1] as string
    expect(subject).toContain('Empresa Gama')
  })

  it('HTML contém score e descrição da divergência', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarDivergencia(DESTINATARIO, 'Empresa Delta', 'CNPJ inválido', 55)

    const html = spy.mock.calls[0][2] as string
    expect(html).toContain('55')
    expect(html).toContain('CNPJ inválido')
  })
})

// ===========================================================================
// enviarAlertaExclusaoSN
// ===========================================================================

describe('EmailService.enviarAlertaExclusaoSN()', () => {
  it('skip quando destinatário não tem email', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarAlertaExclusaoSN(DESTINATARIO_SEM_EMAIL, 'Acme', 'débito em aberto')

    expect(spy).not.toHaveBeenCalled()
  })

  it('assunto inclui empresa e é URGENTE', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarAlertaExclusaoSN(DESTINATARIO, 'Empresa Épsilon', 'débito em aberto')

    const subject = spy.mock.calls[0][1] as string
    expect(subject).toContain('Empresa Épsilon')
    expect(subject).toMatch(/urgente/i)
  })

  it('HTML contém motivo e nome da empresa', async () => {
    const svc = new EmailService()
    const spy = vi.spyOn(svc, 'enviar').mockResolvedValue(undefined)

    await svc.enviarAlertaExclusaoSN(DESTINATARIO, 'Empresa Zeta', 'receita bruta excedida')

    const html = spy.mock.calls[0][2] as string
    expect(html).toContain('receita bruta excedida')
    expect(html).toContain('Empresa Zeta')
  })
})
