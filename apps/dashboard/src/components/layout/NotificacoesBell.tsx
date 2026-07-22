'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'

type Alerta = {
  id: string
  tipo: string
  mensagem: string
  criadoEm: string
  empresa?: { cnpj: string; razaoSocial: string }
}

type Resumo = {
  total: number
  naoLidos: number
  porTipo: { tipo: string; count: number }[]
}

const TIPO_LABEL: Record<string, string> = {
  CREDENCIAL_VENCENDO: 'Credencial vencendo',
  CREDENCIAL_VENCIDA: 'Credencial vencida',
  SUBLIMITE_ESTADUAL: 'Sublimite estadual',
  RISCO_EXCLUSAO_SN: 'Risco de exclusão do SN',
  VENCIMENTO_OBRIGACAO: 'Vencimento de obrigação',
  DIVERGENCIA_CONCILIACAO: 'Divergência de conciliação',
  DISTRIBUICAO_LUCROS: 'Distribuição de lucros',
  FATOR_R_MUDOU: 'Fator R mudou',
  PGDAS_PENDENTE: 'PGDAS pendente',
  CERTIFICADO_VENCENDO: 'Certificado vencendo',
  CONFIGURACAO_ISS: 'Configuração de ISS',
}

export function NotificacoesBell() {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const { data: resumo } = useQuery<Resumo>({
    queryKey: ['alertas-resumo'],
    queryFn: () => api.get('/alertas/resumo').then((r) => r.data),
    refetchInterval: 60_000,
  })

  const { data: recentes = [] } = useQuery<Alerta[]>({
    queryKey: ['alertas-recentes'],
    queryFn: () => api.get('/alertas?lido=false&limite=5').then((r) => r.data),
    enabled: aberto,
  })

  const marcarLido = useMutation({
    mutationFn: (id: string) => api.patch(`/alertas/${id}/ler`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertas-resumo'] })
      queryClient.invalidateQueries({ queryKey: ['alertas-recentes'] })
    },
  })

  useEffect(() => {
    function fechar(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fechar)
    return () => document.removeEventListener('mousedown', fechar)
  }, [])

  const naoLidos = resumo?.naoLidos ?? 0

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setAberto((v) => !v)}
        className="relative p-2 text-slate-500 hover:text-slate-700 transition-colors"
        aria-label={`Notificações${naoLidos > 0 ? ` — ${naoLidos} não lida(s)` : ''}`}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {naoLidos > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {naoLidos > 99 ? '99+' : naoLidos}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl border border-slate-200 shadow-lg z-50">
          <div className="p-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">Notificações</p>
            <span className="text-xs text-slate-400">{naoLidos} não lida(s)</span>
          </div>

          {recentes.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">Nenhum alerta pendente 🎉</p>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {recentes.map((a) => (
                <li key={a.id} className="p-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-700">
                        {TIPO_LABEL[a.tipo] ?? a.tipo}
                      </p>
                      <p className="text-sm text-slate-600 mt-0.5 line-clamp-2">{a.mensagem}</p>
                      {a.empresa && (
                        <p className="text-xs text-slate-400 mt-0.5 truncate">
                          {a.empresa.razaoSocial}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => marcarLido.mutate(a.id)}
                      className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap shrink-0"
                    >
                      Marcar lida
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="p-2 border-t border-slate-100 text-center">
            <Link
              href="/notificacoes"
              onClick={() => setAberto(false)}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Ver todas as notificações →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
