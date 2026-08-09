'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type StatusFila = {
  nome: string
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

type JobFalho = {
  id: string
  name: string
  data: Record<string, unknown>
  failedReason: string
  attemptsMade: number
  timestamp: number
  processedOn: number | null
  finishedOn: number | null
}

const FILA_COR: Record<string, string> = {
  fechamento: 'bg-blue-50 border-blue-200',
  scraper: 'bg-purple-50 border-purple-200',
  fiscal: 'bg-green-50 border-green-200',
  portal: 'bg-amber-50 border-amber-200',
  monitoramento: 'bg-slate-50 border-slate-200',
  relatorio: 'bg-indigo-50 border-indigo-200',
  bancario: 'bg-teal-50 border-teal-200',
}

function numBadge(n: number, cor: string) {
  if (n === 0) return <span className="text-gray-400">0</span>
  return <span className={`font-bold ${cor}`}>{n}</span>
}

export default function FilasAdminPage() {
  const qc = useQueryClient()
  const [filaFalhas, setFilaFalhas] = useState<string | null>(null)

  const {
    data: filas = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['admin-filas'],
    queryFn: () => api.get('/filas').then((r) => r.data as StatusFila[]),
    refetchInterval: 15000,
  })

  const { data: falhas = [], isLoading: loadFalhas } = useQuery({
    queryKey: ['admin-filas-falhas', filaFalhas],
    queryFn: () =>
      filaFalhas ? api.get(`/filas/${filaFalhas}/falhas`).then((r) => r.data as JobFalho[]) : [],
    enabled: !!filaFalhas,
  })

  const retry = useMutation({
    mutationFn: ({ nome, jobId }: { nome: string; jobId: string }) =>
      api.post(`/filas/${nome}/falhas/${jobId}/retry`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-filas'] })
      qc.invalidateQueries({ queryKey: ['admin-filas-falhas', filaFalhas] })
    },
  })

  const totalAtivos = filas.reduce((s, f) => s + f.active, 0)
  const totalFalhas = filas.reduce((s, f) => s + f.failed, 0)
  const totalAguardando = filas.reduce((s, f) => s + f.waiting, 0)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monitoramento de Filas</h1>
          <p className="mt-1 text-sm text-gray-500">
            Status em tempo real das filas BullMQ. Apenas administradores.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          Atualizar
        </button>
      </div>

      {/* Resumo global */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-xs text-blue-600">Jobs em Execução</p>
          <p className="text-3xl font-bold text-blue-700">{totalAtivos}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs text-amber-600">Aguardando</p>
          <p className="text-3xl font-bold text-amber-700">{totalAguardando}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-xs text-red-600">Com Falha</p>
          <p className="text-3xl font-bold text-red-700">{totalFalhas}</p>
        </div>
      </div>

      {/* Tabela de filas */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-400">Carregando…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Fila</th>
                <th className="px-4 py-3 text-right">Aguardando</th>
                <th className="px-4 py-3 text-right">Ativo</th>
                <th className="px-4 py-3 text-right">Concluído</th>
                <th className="px-4 py-3 text-right">Falha</th>
                <th className="px-4 py-3 text-right">Atrasado</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filas.map((f) => (
                <tr key={f.nome} className={`hover:bg-gray-50 ${FILA_COR[f.nome] ?? ''}`}>
                  <td className="px-4 py-3 font-mono font-semibold text-gray-800">{f.nome}</td>
                  <td className="px-4 py-3 text-right">{numBadge(f.waiting, 'text-amber-600')}</td>
                  <td className="px-4 py-3 text-right">{numBadge(f.active, 'text-blue-600')}</td>
                  <td className="px-4 py-3 text-right">
                    {numBadge(f.completed, 'text-green-600')}
                  </td>
                  <td className="px-4 py-3 text-right">{numBadge(f.failed, 'text-red-600')}</td>
                  <td className="px-4 py-3 text-right">{numBadge(f.delayed, 'text-purple-600')}</td>
                  <td className="px-4 py-3 text-right">
                    {f.failed > 0 && (
                      <button
                        onClick={() => setFilaFalhas(filaFalhas === f.nome ? null : f.nome)}
                        className="text-xs text-red-600 hover:text-red-800 underline"
                      >
                        {filaFalhas === f.nome ? 'Fechar' : `Ver ${f.failed} falha(s)`}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detalhes de falhas */}
      {filaFalhas && (
        <div className="rounded-lg border border-red-200 bg-white shadow-sm">
          <div className="border-b border-red-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-red-800">
              Jobs com falha — fila: <span className="font-mono">{filaFalhas}</span>
            </h2>
          </div>
          {loadFalhas ? (
            <div className="p-6 text-center text-gray-400">Carregando…</div>
          ) : falhas.length === 0 ? (
            <div className="p-6 text-center text-gray-400">Nenhuma falha encontrada.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {falhas.map((job) => (
                <div key={job.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-500">#{job.id}</span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
                          {job.name}
                        </span>
                        <span className="text-xs text-gray-400">
                          {job.attemptsMade} tentativa(s)
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-red-700">{job.failedReason}</p>
                      <p className="mt-0.5 font-mono text-xs text-gray-400">
                        {job.data && Object.keys(job.data).length > 0
                          ? JSON.stringify(job.data).slice(0, 120)
                          : '{}'}
                      </p>
                    </div>
                    <button
                      onClick={() => retry.mutate({ nome: filaFalhas, jobId: job.id })}
                      disabled={retry.isPending}
                      className="shrink-0 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {retry.isPending ? '…' : 'Retentar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-center text-xs text-gray-400">
        Atualizado automaticamente a cada 15 segundos
      </p>
    </div>
  )
}
