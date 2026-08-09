'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Alerta = {
  id: string
  tipo: string
  mensagem: string
  empresa: { cnpj: string; razaoSocial: string }
  criadoEm: string
}

const TIPO_COLOR: Record<string, string> = {
  DIVERGENCIA_CONCILIACAO: 'bg-red-100 text-red-700',
  CREDENCIAL_VENCENDO: 'bg-yellow-100 text-yellow-700',
  RISCO_EXCLUSAO_SN: 'bg-orange-100 text-orange-700',
  VENCIMENTO_OBRIGACAO: 'bg-blue-100 text-blue-700',
  PGDAS_PENDENTE: 'bg-indigo-100 text-indigo-700',
}

const TIPO_ICON: Record<string, string> = {
  DIVERGENCIA_CONCILIACAO: '⚠️',
  CREDENCIAL_VENCENDO: '🔑',
  RISCO_EXCLUSAO_SN: '🚨',
  VENCIMENTO_OBRIGACAO: '📅',
  PGDAS_PENDENTE: '💰',
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffH = Math.floor(diffMs / 3600000)
  if (diffH < 1) return 'agora'
  if (diffH < 24) return `${diffH}h atrás`
  const diffD = Math.floor(diffH / 24)
  return `${diffD}d atrás`
}

export function AlertasPanel({ alertas }: { alertas: Alerta[] }) {
  const qc = useQueryClient()

  const marcarLido = useMutation({
    mutationFn: (id: string) => api.patch(`/dashboard/alertas/${id}/ler`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-alertas'] })
      qc.invalidateQueries({ queryKey: ['dashboard-resumo'] })
    },
  })

  const marcarTodosLidos = useMutation({
    mutationFn: async () => {
      await Promise.all(alertas.map((a) => api.patch(`/dashboard/alertas/${a.id}/ler`)))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-alertas'] })
      qc.invalidateQueries({ queryKey: ['dashboard-resumo'] })
    },
  })

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col max-h-[520px]">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-900">Alertas</h3>
          {alertas.length > 0 && (
            <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded-full font-medium">
              {alertas.length}
            </span>
          )}
        </div>
        {alertas.length > 1 && (
          <button
            onClick={() => marcarTodosLidos.mutate()}
            disabled={marcarTodosLidos.isPending}
            className="text-xs text-slate-500 hover:text-slate-700 font-medium disabled:opacity-50"
          >
            Dispensar todos
          </button>
        )}
      </div>

      <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
        {alertas.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-400 text-sm">
            <span className="block text-2xl mb-2">✓</span>
            Nenhum alerta pendente
          </div>
        ) : (
          alertas.slice(0, 10).map((alerta) => (
            <div key={alerta.id} className="px-5 py-3.5 hover:bg-slate-50 transition-colors group">
              <div className="flex items-start gap-2.5">
                <span className="text-base flex-shrink-0 mt-0.5">
                  {TIPO_ICON[alerta.tipo] ?? '🔔'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${TIPO_COLOR[alerta.tipo] ?? 'bg-slate-100 text-slate-600'}`}
                    >
                      {alerta.tipo.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-slate-400">
                      {formatTimestamp(alerta.criadoEm)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 mt-1 line-clamp-2 leading-snug">
                    {alerta.mensagem}
                  </p>
                  {alerta.empresa && (
                    <p className="text-xs text-slate-400 mt-0.5 font-mono truncate">
                      {alerta.empresa.cnpj} · {alerta.empresa.razaoSocial}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => marcarLido.mutate(alerta.id)}
                  disabled={marcarLido.isPending}
                  className="text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-lg leading-none"
                  title="Dispensar"
                >
                  ×
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {alertas.length > 10 && (
        <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400 text-center flex-shrink-0">
          +{alertas.length - 10} alertas não exibidos
        </div>
      )}
    </div>
  )
}
