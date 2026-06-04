/**
 * Testes unitários — wsRoutes (GET /ws/fechamento/:jobId)
 *
 * Cobre:
 *  - job em estado "active" → envia mensagem { type:'state', state, progress, jobId }
 *  - job em estado "completed" → envia state + completed, faz cleanup
 *  - job em estado "failed" → envia state + failed com failedReason, faz cleanup
 *  - job não encontrado → envia { type:'error', message:'Job não encontrado' }, cleanup
 *  - getJob lança erro → envia { type:'error', message }, cleanup
 *  - socket fechado (close) → cleanup desregistra listeners e fecha QueueEvents
 *  - socket com erro → cleanup desregistra listeners e fecha QueueEvents
 *  - QueueEvents progress no jobId correto → envia { type:'progress', progress, jobId }
 *  - QueueEvents progress em jobId diferente → ignorado (send não chamado)
 *  - QueueEvents completed no jobId correto → envia completed, faz cleanup
 *  - QueueEvents failed no jobId correto → envia failed com erro, faz cleanup
 *  - socket.readyState !== 1 → send não é chamado (socket fechado)
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockJob = {
  getState: vi.fn<[], Promise<string>>().mockResolvedValue('active'),
  progress: 42,
  failedReason: 'Timeout na SEFAZ',
}

const mockQueue = {
  getJob: vi.fn<[string], Promise<typeof mockJob | null>>().mockResolvedValue(mockJob),
}

const mockQueueEvents = {
  on: vi.fn(),
  off: vi.fn(),
  close: vi.fn(),
}

vi.mock('bullmq', () => ({
  Queue: vi.fn(() => mockQueue),
  QueueEvents: vi.fn(() => mockQueueEvents),
}))

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({})),
}))

import { wsRoutes } from '../routes/ws.routes.js'

// ---------------------------------------------------------------------------
// Handler capture
// ---------------------------------------------------------------------------

type WsHandler = (socket: MockSocket, request: { params: { jobId: string } }) => Promise<void>

let capturedHandler: WsHandler

beforeAll(async () => {
  const fakeApp = {
    get: vi.fn((_path: string, _opts: unknown, handler: WsHandler) => {
      capturedHandler = handler
    }),
  } as any

  await wsRoutes(fakeApp)
})

// ---------------------------------------------------------------------------
// Mock socket factory
// ---------------------------------------------------------------------------

interface MockSocket {
  readyState: number
  send: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  _trigger: (event: string, ...args: unknown[]) => void
}

function makeSocket(readyState = 1): MockSocket {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
  return {
    readyState,
    send: vi.fn(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? []
      listeners[event]!.push(cb)
    }),
    _trigger: (event: string, ...args: unknown[]) => {
      listeners[event]?.forEach((cb) => cb(...args))
    },
  }
}

function makeRequest(jobId: string) {
  return { params: { jobId } }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSent(socket: MockSocket): object[] {
  return socket.send.mock.calls.map((c) => JSON.parse(c[0] as string))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockJob.getState.mockResolvedValue('active')
  mockJob.progress = 42
  mockJob.failedReason = 'Timeout na SEFAZ'
  mockQueue.getJob.mockResolvedValue(mockJob)
})

describe('wsRoutes — job em estados terminais (estado inicial)', () => {
  it('job "active" → envia mensagem state com progress', async () => {
    const socket = makeSocket()
    await capturedHandler(socket, makeRequest('job-active'))

    const messages = parseSent(socket)
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'state', state: 'active', progress: 42, jobId: 'job-active' })
    )
  })

  it('job "completed" → envia state + completed e chama QueueEvents.close()', async () => {
    mockJob.getState.mockResolvedValue('completed')
    const socket = makeSocket()
    await capturedHandler(socket, makeRequest('job-done'))

    const messages = parseSent(socket)
    const types = messages.map((m) => (m as any).type)
    expect(types).toContain('state')
    expect(types).toContain('completed')
    expect(mockQueueEvents.close).toHaveBeenCalledOnce()
  })

  it('job "failed" → envia state + failed com failedReason', async () => {
    mockJob.getState.mockResolvedValue('failed')
    const socket = makeSocket()
    await capturedHandler(socket, makeRequest('job-fail'))

    const messages = parseSent(socket)
    const failedMsg = messages.find((m) => (m as any).type === 'failed')
    expect(failedMsg).toBeDefined()
    expect((failedMsg as any).erro).toBe('Timeout na SEFAZ')
    expect(mockQueueEvents.close).toHaveBeenCalledOnce()
  })

  it('job não encontrado → envia error com mensagem', async () => {
    mockQueue.getJob.mockResolvedValue(null)
    const socket = makeSocket()
    await capturedHandler(socket, makeRequest('job-inexistente'))

    const messages = parseSent(socket)
    const errMsg = messages.find((m) => (m as any).type === 'error')
    expect(errMsg).toBeDefined()
    expect((errMsg as any).message).toMatch(/não encontrado/i)
    expect(mockQueueEvents.close).toHaveBeenCalledOnce()
  })

  it('getJob lança erro → envia error com mensagem de string', async () => {
    mockQueue.getJob.mockRejectedValueOnce(new Error('Redis offline'))
    const socket = makeSocket()
    await capturedHandler(socket, makeRequest('job-err'))

    const messages = parseSent(socket)
    const errMsg = messages.find((m) => (m as any).type === 'error')
    expect(errMsg).toBeDefined()
    expect((errMsg as any).message).toMatch(/Redis offline/)
    expect(mockQueueEvents.close).toHaveBeenCalledOnce()
  })

  it('socket com readyState !== 1 → send não é chamado', async () => {
    const socket = makeSocket(3) // CLOSED
    await capturedHandler(socket, makeRequest('job-closed'))

    expect(socket.send).not.toHaveBeenCalled()
  })
})

describe('wsRoutes — cleanup via eventos do socket', () => {
  it('socket "close" → QueueEvents.off chamado e close() chamado', async () => {
    const socket = makeSocket()
    await capturedHandler(socket, makeRequest('job-close'))

    // Simular fechamento do socket
    socket._trigger('close')

    expect(mockQueueEvents.off).toHaveBeenCalledWith('progress', expect.any(Function))
    expect(mockQueueEvents.off).toHaveBeenCalledWith('completed', expect.any(Function))
    expect(mockQueueEvents.off).toHaveBeenCalledWith('failed', expect.any(Function))
    expect(mockQueueEvents.close).toHaveBeenCalled()
  })

  it('socket "error" → cleanup chamado (QueueEvents.close)', async () => {
    const socket = makeSocket()
    await capturedHandler(socket, makeRequest('job-error'))

    socket._trigger('error')

    expect(mockQueueEvents.close).toHaveBeenCalled()
  })
})

describe('wsRoutes — QueueEvents em tempo real', () => {
  it('progress no jobId correto → envia { type:"progress", progress, jobId }', async () => {
    const socket = makeSocket()
    await capturedHandler(socket, makeRequest('job-prog'))

    // Captura o listener de progress registrado
    const progressCall = mockQueueEvents.on.mock.calls.find((c) => c[0] === 'progress')
    expect(progressCall).toBeDefined()
    const progressListener = progressCall![1] as (args: { jobId: string; data: unknown }) => void

    socket.send.mockClear()
    progressListener({ jobId: 'job-prog', data: 75 })

    const messages = parseSent(socket)
    expect(messages).toContainEqual({
      type: 'progress',
      progress: 75,
      jobId: 'job-prog',
    })
  })

  it('progress em jobId diferente → ignorado (send não chamado)', async () => {
    const socket = makeSocket()
    await capturedHandler(socket, makeRequest('job-prog-2'))

    const progressCall = mockQueueEvents.on.mock.calls.find((c) => c[0] === 'progress')
    const progressListener = progressCall![1] as (args: { jobId: string; data: unknown }) => void

    socket.send.mockClear()
    progressListener({ jobId: 'outro-job', data: 90 })

    expect(socket.send).not.toHaveBeenCalled()
  })

  it('completed no jobId correto → envia completed e faz cleanup', async () => {
    // Precisamos de um job ainda em execução para que o completed não seja enviado antes
    mockJob.getState.mockResolvedValue('active')
    const socket = makeSocket()
    await capturedHandler(socket, makeRequest('job-comp'))

    const completedCall = mockQueueEvents.on.mock.calls.find((c) => c[0] === 'completed')
    const completedListener = completedCall![1] as (args: { jobId: string }) => void

    socket.send.mockClear()
    mockQueueEvents.close.mockClear()
    completedListener({ jobId: 'job-comp' })

    const messages = parseSent(socket)
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'completed', jobId: 'job-comp' })
    )
    expect(mockQueueEvents.close).toHaveBeenCalledOnce()
  })

  it('failed no jobId correto → envia failed com erro e faz cleanup', async () => {
    mockJob.getState.mockResolvedValue('active')
    const socket = makeSocket()
    await capturedHandler(socket, makeRequest('job-fail-evt'))

    const failedCall = mockQueueEvents.on.mock.calls.find((c) => c[0] === 'failed')
    const failedListener = failedCall![1] as (args: { jobId: string; failedReason: string }) => void

    socket.send.mockClear()
    mockQueueEvents.close.mockClear()
    failedListener({ jobId: 'job-fail-evt', failedReason: 'SEFAZ indisponível' })

    const messages = parseSent(socket)
    const failMsg = messages.find((m) => (m as any).type === 'failed')
    expect(failMsg).toBeDefined()
    expect((failMsg as any).erro).toBe('SEFAZ indisponível')
    expect(mockQueueEvents.close).toHaveBeenCalledOnce()
  })

  it('registra listeners para progress, completed e failed no QueueEvents', async () => {
    const socket = makeSocket()
    await capturedHandler(socket, makeRequest('job-listeners'))

    const events = mockQueueEvents.on.mock.calls.map((c) => c[0])
    expect(events).toContain('progress')
    expect(events).toContain('completed')
    expect(events).toContain('failed')
  })
})
