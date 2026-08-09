'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type TipoAlerta =
  | 'CREDENCIAL_VENCENDO'
  | 'CREDENCIAL_VENCIDA'
  | 'SUBLIMITE_ESTADUAL'
  | 'RISCO_EXCLUSAO_SN'
  | 'VENCIMENTO_OBRIGACAO'
  | 'DIVERGENCIA_CONCILIACAO'
  | 'DISTRIBUICAO_LUCROS'
  | 'FATOR_R_MUDOU'
  | 'PGDAS_PENDENTE'
  | 'CERTIFICADO_VENCENDO'
  | 'CONFIGURACAO_ISS'

type Alerta = {
  id: string
  tipo: TipoAlerta
  mensagem: string
  dados: Record<string, unknown> | null
  lido: boolean
  criadoEm: string
  empresa: { cnpj: string; razaoSocial: string }
}

const TIPO_LABELS: Record<TipoAlerta, string> = {
  CREDENCIAL_VENCENDO: 'Credencial Vencendo',
  CREDENCIAL_VENCIDA: 'Credencial Vencida',
  SUBLIMITE_ESTADUAL: 'Sublimite Estadual',
  RISCO_EXCLUSAO_SN: 'Risco Exclusão SN',
  VENCIMENTO_OBRIGACAO: 'Vencimento de Obrigação',
  DIVERGENCIA_CONCILIACAO: 'Divergência Conciliação',
  DISTRIBUICAO_LUCROS: 'Distribuição de Lucros',
  FATOR_R_MUDOU: 'Fator R Alterado',
  PGDAS_PENDENTE: 'PGDAS Pendente',
  CERTIFICADO_VENCENDO: 'Certificado Vencendo',
  CONFIGURACAO_ISS: 'Configuração ISS',
}

const TIPO_COR: Record<TipoAlerta, string> = {
  CREDENCIAL_VENCENDO: 'bg-amber-100 text-amber-700',
  CREDENCIAL_VENCIDA: 'bg-red-100 text-red-700',
  SUBLIMITE_ESTADUAL: 'bg-orange-100 text-orange-700',
  RISCO_EXCLUSAO_SN: 'bg-red-100 text-red-800',
  VENCIMENTO_OBRIGACAO: 'bg-yellow-100 text-yellow-700',
  DIVERGENCIA_CONCILIACAO: 'bg-purple-100 text-purple-700',
  DISTRIBUICAO_LUCROS: 'bg-green-100 text-green-700',
  FATOR_R_MUDOU: 'bg-blue-100 text-blue-700',
  PGDAS_PENDENTE: 'bg-indigo-100 text-indigo-700',
  CERTIFICADO_VENCENDO: 'bg-amber-100 text-amber-800',
  CONFIGURACAO_ISS: 'bg-gray-100 text-gray-700',
}

const TIPO_ICONE: Record<TipoAlerta, string> = {
  CREDENCIAL_VENCENDO: '🔑',
  CREDENCIAL_VENCIDA: '🔒',
  SUBLIMITE_ESTADUAL: '⚠️',
  RISCO_EXCLUSAO_SN: '🚨',
  VENCIMENTO_OBRIGACAO: '📅',
  DIVERGENCIA_CONCILIACAO: '⚖️',
  DISTRIBUICAO_LUCROS: '💰',
  FATOR_R_MUDOU: '📐',
  PGDAS_PENDENTE: '📋',
  CERTIFICADO_VENCENDO: '📜',
  CONFIGURACAO_ISS: '🏙️',
}

function dataRelativa(isoStr: string): string {
  const agora = Date.now()
  const data = new Date(isoStr).getTime()
  const diff = agora - data
  const minutos = Math.floor(diff / 60000)
  if (minutos < 1) return 'agora mesmo'
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `há ${horas}h`
  const dias = Math.floor(horas / 24)
  if (dias === 1) return 'ontem'
  if (dias < 7) return `há ${dias} dias`
  return new Date(isoStr).toLocaleDateString('pt-BR')
}

export default function NotificacoesPage() {
  const queryClient = useQueryClient()
  const [filtroLido, setFiltroLido] = useState<'false' | 'true' | 'todos'>('false')
  const [filtroTipo, setFiltroTipo] = useState<TipoAlerta | ''>('')

  const { data: alertas = [], isLoading } = useQuery({
    queryKey: ['alertas', filtroLido, filtroTipo],
    queryFn: () => {
      const params = new URLSearchParams({ lido: filtroLido })
      if (filtroTipo) params.set('tipo', filtroTipo)
      params.set('limite', '100')
      return api.get(`/alertas?${params.toString()}`).then((r) => r.data as Alerta[])
    },
    refetchInterval: 30000,
  })

  const marcarLido = useMutation({
    mutationFn: (id: string) => api.patch(`/alertas/${id}/ler`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-resumo'] })
    },
  })

  const marcarTodosLidos = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams()
      if (filtroTipo) params.set('tipo', filtroTipo)
      return api.patch(`/alertas/ler-todos?${params.toString()}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-resumo'] })
    },
  })

  const naoLidos = alertas.filter((a) => !a.lido).length

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notificações</h1>
          <p className="mt-1 text-sm text-gray-500">
            Alertas automáticos sobre vencimentos, riscos e divergências.
          </p>
        </div>
        {naoLidos > 0 && filtroLido !== 'true' && (
          <button
            onClick={() => marcarTodosLidos.mutate()}
            disabled={marcarTodosLidos.isPending}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {marcarTodosLidos.isPending ? 'Marcando…' : `Marcar todos como lidos (${naoLidos})`}
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div>
          <select
            value={filtroLido}
            onChange={(e) => setFiltroLido(e.target.value as typeof filtroLido)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="false">Não lidos</option>
            <option value="true">Lidos</option>
            <option value="todos">Todos</option>
          </select>
        </div>
        <div>
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value as TipoAlerta | '')}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todos os tipos</option>
            {(Object.keys(TIPO_LABELS) as TipoAlerta[]).map((tipo) => (
              <option key={tipo} value={tipo}>
                {TIPO_LABELS[tipo]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats */}
      {filtroLido !== 'true' && (
        <div className="grid gap-4 sm:grid-cols-4">
          {(
            [
              'RISCO_EXCLUSAO_SN',
              'CREDENCIAL_VENCIDA',
              'VENCIMENTO_OBRIGACAO',
              'DIVERGENCIA_CONCILIACAO',
            ] as TipoAlerta[]
          ).map((tipo) => {
            const count = alertas.filter((a) => a.tipo === tipo && !a.lido).length
            return (
              <div key={tipo} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{TIPO_ICONE[tipo]}</span>
                  <div>
                    <p className="text-xs text-gray-500">{TIPO_LABELS[tipo]}</p>
                    <p
                      className={`text-xl font-bold ${count > 0 ? 'text-red-600' : 'text-gray-400'}`}
                    >
                      {count}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-400">Carregando…</div>
      ) : alertas.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
          <p className="text-2xl">🎉</p>
          <p className="mt-2 text-sm font-medium text-gray-600">Nenhuma notificação</p>
          <p className="text-xs text-gray-400">
            {filtroLido === 'false' ? 'Tudo em dia!' : 'Sem registros para o filtro selecionado.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {alertas.map((alerta) => (
            <div
              key={alerta.id}
              className={`rounded-lg border bg-white p-4 shadow-sm transition-opacity ${
                alerta.lido ? 'border-gray-100 opacity-60' : 'border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 text-xl">{TIPO_ICONE[alerta.tipo]}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TIPO_COR[alerta.tipo]}`}
                      >
                        {TIPO_LABELS[alerta.tipo]}
                      </span>
                      {!alerta.lido && (
                        <span className="inline-flex h-2 w-2 rounded-full bg-blue-500" />
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-800">{alerta.mensagem}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                      <span className="truncate font-medium text-gray-500">
                        {alerta.empresa.razaoSocial}
                      </span>
                      <span>·</span>
                      <span className="font-mono">{alerta.empresa.cnpj}</span>
                      <span>·</span>
                      <span>{dataRelativa(alerta.criadoEm)}</span>
                    </div>
                  </div>
                </div>
                {!alerta.lido && (
                  <button
                    onClick={() => marcarLido.mutate(alerta.id)}
                    disabled={marcarLido.isPending}
                    className="shrink-0 rounded border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Lido
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-gray-400">
        Atualizado automaticamente a cada 30 segundos · {alertas.length} registro(s)
      </p>
    </div>
  )
}
