'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

type AuditEvento = {
  id: string
  sequencia: number
  evento: string
  cnpj?: string
  responsavel: string
  responsavelTipo: string
  estadoNovo?: unknown
  timestamp: string
}

type Props = { empresaId: string }

const EVENTO_COR: Record<string, string> = {
  FECHAMENTO_CONCLUIDO: 'bg-green-100 text-green-700',
  FECHAMENTO_INICIADO: 'bg-blue-100 text-blue-700',
  OBRIGACAO_FALHOU: 'bg-red-100 text-red-700',
  PENDENTE_REVISAO_HUMANA: 'bg-yellow-100 text-yellow-700',
  CONCILIACAO_APROVADA: 'bg-green-100 text-green-700',
  CONCILIACAO_REJEITADA: 'bg-red-100 text-red-700',
}

export function EmpresaAuditoriaPanel({ empresaId }: Props) {
  const { data: eventos = [], isLoading } = useQuery<AuditEvento[]>({
    queryKey: ['audit-eventos-empresa', empresaId],
    queryFn: () =>
      api.get(`/auditoria/eventos?entidadeId=${empresaId}&limit=50`).then((r) => r.data),
    refetchInterval: 30000,
  })

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">Trilha de Auditoria</h3>
        <span className="text-xs text-slate-400">{eventos.length} evento(s)</span>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-slate-400">Carregando eventos...</div>
      ) : eventos.length === 0 ? (
        <div className="p-8 text-center text-slate-400">
          Nenhum evento de auditoria registrado para esta empresa.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {eventos.map((ev) => (
            <div key={ev.id} className="px-6 py-4 hover:bg-slate-50">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="font-mono text-xs text-slate-300 w-8 shrink-0">
                    #{ev.sequencia}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-mono whitespace-nowrap ${EVENTO_COR[ev.evento] ?? 'bg-slate-100 text-slate-600'}`}
                  >
                    {ev.evento}
                  </span>
                  <span className="text-xs text-slate-500 truncate">
                    por <span className="font-medium">{ev.responsavel}</span>
                    {ev.responsavelTipo !== 'SISTEMA' && ` (${ev.responsavelTipo})`}
                  </span>
                </div>
                <time className="text-xs text-slate-400 shrink-0">
                  {new Date(ev.timestamp).toLocaleString('pt-BR')}
                </time>
              </div>
              {ev.estadoNovo != null &&
                typeof ev.estadoNovo === 'object' &&
                Object.keys(ev.estadoNovo as Record<string, unknown>).length > 0 && (
                  <details className="mt-2 ml-11">
                    <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
                      Ver detalhes
                    </summary>
                    <pre className="mt-1 text-xs bg-slate-50 rounded p-2 overflow-auto max-h-32 text-slate-600">
                      {JSON.stringify(ev.estadoNovo, null, 2)}
                    </pre>
                  </details>
                )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
