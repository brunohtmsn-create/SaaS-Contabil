'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

type Props = { empresaId: string; competencia: string; jobId?: string }

const FASES = [
  { key: 'CAPTURA', label: 'Captura de Documentos', icon: '📥' },
  { key: 'CONCILIACAO', label: 'Conciliação', icon: '⚖️' },
  { key: 'PGDAS', label: 'PGDAS + Fator R', icon: '💰' },
  { key: 'DIFAL', label: 'DIFAL + GNRE', icon: '🗺️' },
  { key: 'DESTDA', label: 'DeSTDA', icon: '📋' },
  { key: 'EFD_REINF', label: 'EFD-Reinf', icon: '📑' },
  { key: 'ESOCIAL', label: 'e-Social', icon: '👥' },
  { key: 'DCTFWEB', label: 'DCTFWeb', icon: '🏛️' },
  { key: 'CONTABIL', label: 'Lançamentos + Depreciação', icon: '📒' },
  { key: 'BANCARIA', label: 'Open Finance + Concil. Bancária', icon: '🏦' },
  { key: 'FGTS', label: 'FGTS Digital', icon: '💼' },
]

type WsMessage =
  | { type: 'progress'; progress: number; jobId: string }
  | { type: 'log'; jobId: string; log: string }
  | { type: 'completed'; jobId: string }
  | { type: 'failed'; jobId: string; erro: string }
  | { type: 'state'; state: string; progress: number; jobId: string }
  | { type: 'error'; message: string }

function useFechamentoWs(jobId?: string) {
  const [progress, setProgress] = useState<number>(0)
  const [logs, setLogs] = useState<string[]>([])
  const [wsStatus, setWsStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!jobId) return

    const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000'
    const wsUrl = apiUrl.replace(/^http/, 'ws') + `/ws/fechamento/${jobId}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    setWsStatus('running')

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data)
      if (msg.type === 'progress') setProgress(msg.progress as number)
      if (msg.type === 'state') setProgress(msg.progress as number)
      if (msg.type === 'log') setLogs((prev) => [...prev.slice(-19), msg.log])
      if (msg.type === 'completed') {
        setProgress(100)
        setWsStatus('done')
      }
      if (msg.type === 'failed') {
        setWsStatus('error')
        setLogs((prev) => [...prev, `ERRO: ${msg.erro}`])
      }
    }

    ws.onerror = () => setWsStatus('error')
    ws.onclose = () => {
      if (wsStatus === 'running') setWsStatus('done')
    }

    return () => {
      ws.close()
    }
  }, [jobId])

  return { progress, logs, wsStatus }
}

export function FechamentoPanel({ empresaId, competencia, jobId }: Props) {
  const { data: status, refetch } = useQuery({
    queryKey: ['fechamento-status', empresaId, competencia],
    queryFn: () => api.get(`/fechamento/status/${empresaId}/${competencia}`).then((r) => r.data),
    refetchInterval: jobId ? false : 5000,
  })

  const { progress, logs, wsStatus } = useFechamentoWs(jobId)

  useEffect(() => {
    if (wsStatus === 'done') refetch()
  }, [wsStatus, refetch])

  const apuracoesTipos = new Set(status?.apuracoes?.map((a: any) => a.tipo) ?? [])
  const emExecucao = wsStatus === 'running'

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-900 mb-4">
          Progresso do Fechamento — {competencia}
        </h3>

        {emExecucao && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-blue-700">Processando...</span>
              <span className="text-sm font-mono text-blue-700">{progress}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {wsStatus === 'error' && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            Falha durante o processamento.
          </div>
        )}

        <div className="space-y-3">
          {FASES.map((fase) => {
            const concluida =
              apuracoesTipos.has(fase.key) ||
              (fase.key === 'BANCARIA' && (status?.lancamentos ?? 0) > 0)

            return (
              <div key={fase.key} className="flex items-center gap-4">
                <span className="w-8 h-8 flex items-center justify-center text-lg">
                  {fase.icon}
                </span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">{fase.label}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        concluida ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {concluida ? 'Concluído' : 'Pendente'}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-100 flex gap-8 text-sm text-slate-600">
          <div>
            <span className="font-medium">Lançamentos:</span>{' '}
            <span className="font-mono">{status?.lancamentos ?? 0}</span>
          </div>
          <div>
            <span className="font-medium">Obrigações:</span>{' '}
            <span className="font-mono">{status?.obrigacoes?.length ?? 0}</span>
          </div>
        </div>

        {logs.length > 0 && (
          <details className="mt-4">
            <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
              Log de execução ({logs.length} entradas)
            </summary>
            <div className="mt-2 bg-slate-900 rounded-lg p-3 max-h-40 overflow-y-auto">
              {logs.map((log, i) => (
                <p key={i} className="text-xs font-mono text-green-400 leading-relaxed">
                  {log}
                </p>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
