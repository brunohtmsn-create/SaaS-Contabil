'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

const PAGE_SIZE = 20

const EVENTO_COR: Record<string, string> = {
  FECHAMENTO_CONCLUIDO: 'bg-green-100 text-green-700',
  FECHAMENTO_INICIADO: 'bg-blue-100 text-blue-700',
  PGDAS_TRANSMITIDO: 'bg-green-100 text-green-700',
  PENDENTE_REVISAO_HUMANA: 'bg-yellow-100 text-yellow-800',
  DIVERGENCIA_DETECTADA: 'bg-red-100 text-red-700',
  PORTAL_ACESSO_FALHOU: 'bg-red-100 text-red-700',
  OBRIGACAO_FALHOU: 'bg-red-100 text-red-700',
  APROVACAO_HUMANA: 'bg-emerald-100 text-emerald-700',
}

export default function AuditoriaPage() {
  const qc = useQueryClient()
  const [pagina, setPagina] = useState(1)
  const [filtroEvento, setFiltroEvento] = useState('')
  const [filtroCnpj, setFiltroCnpj] = useState('')
  const [aprovandoId, setAprovandoId] = useState<string | null>(null)

  const { data: pendentes = [], refetch: refetchPendentes } = useQuery({
    queryKey: ['pendentes-revisao'],
    queryFn: () => api.get('/auditoria/pendentes-revisao').then((r) => r.data),
  })

  const { data: eventos = [], isLoading } = useQuery<any[]>({
    queryKey: ['audit-eventos', filtroCnpj],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '200' })
      if (filtroCnpj) params.set('cnpj', filtroCnpj.replace(/\D/g, ''))
      return api.get(`/auditoria/eventos?${params}`).then((r) => r.data)
    },
  })

  const aprovar = useMutation({
    mutationFn: (eventId: string) => api.post(`/auditoria/aprovar/${eventId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pendentes-revisao'] })
      qc.invalidateQueries({ queryKey: ['audit-eventos'] })
      setAprovandoId(null)
    },
  })

  const filtrados = useMemo(() => {
    if (!filtroEvento) return eventos
    return eventos.filter((e) => e.evento === filtroEvento)
  }, [eventos, filtroEvento])

  const totalPaginas = Math.ceil(filtrados.length / PAGE_SIZE)
  const paginaAtual = filtrados.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE)

  const tiposEvento = useMemo(
    () => Array.from(new Set(eventos.map((e) => e.evento as string))).sort(),
    [eventos]
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Auditoria</h1>
          <p className="text-slate-500 text-sm mt-1">
            Trilha de auditoria imutável com encadeamento SHA-256
          </p>
        </div>
        <button
          onClick={() =>
            api.get('/auditoria/verificar-cadeia').then((r) => {
              const { valida, total } = r.data
              alert(
                valida
                  ? `✓ Cadeia íntegra — ${total} evento(s) verificados`
                  : '✗ INTEGRIDADE COMPROMETIDA!'
              )
            })
          }
          className="text-sm border border-slate-300 hover:border-blue-400 text-slate-600 hover:text-blue-600 px-4 py-2 rounded-lg transition-colors"
        >
          Verificar Integridade
        </button>
      </div>

      {/* Pendentes de revisão */}
      {(pendentes as any[]).length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-yellow-700 font-semibold text-sm">
              ⚠ {(pendentes as any[]).length} pendência(s) aguardando revisão humana
            </span>
          </div>
          <div className="space-y-2">
            {(pendentes as any[]).map((ev: any) => (
              <div
                key={ev.id}
                className="flex items-center justify-between bg-white rounded-lg px-4 py-3 shadow-sm"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {ev.entidadeTipo} —{' '}
                    <span className="font-mono text-xs">{ev.entidadeId.slice(0, 8)}...</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Score: <span className="font-semibold text-yellow-700">{ev.score}</span>
                    {ev.cnpj && (
                      <>
                        {' '}
                        · CNPJ: <span className="font-mono">{ev.cnpj}</span>
                      </>
                    )}
                    {' · '}
                    {new Date(ev.timestamp).toLocaleString('pt-BR')}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setAprovandoId(ev.id)
                    aprovar.mutate(ev.id)
                  }}
                  disabled={aprovandoId === ev.id && aprovar.isPending}
                  className="bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {aprovandoId === ev.id && aprovar.isPending ? 'Aprovando...' : 'Aprovar'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trilha */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Filtrar por CNPJ..."
            value={filtroCnpj}
            onChange={(e) => {
              setFiltroCnpj(e.target.value)
              setPagina(1)
            }}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-48"
          />
          <select
            value={filtroEvento}
            onChange={(e) => {
              setFiltroEvento(e.target.value)
              setPagina(1)
            }}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">Todos os eventos</option>
            {tiposEvento.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-400 ml-auto">
            {filtrados.length} evento(s) {filtroEvento || filtroCnpj ? 'filtrados' : 'total'}
          </span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando trilha de auditoria...</div>
        ) : filtrados.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Nenhum evento registrado.</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                    Seq
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                    Evento
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                    Entidade
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                    CNPJ
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                    Responsável
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                    Data/Hora
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {paginaAtual.map((ev: any) => (
                  <tr key={ev.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">
                      {String(ev.sequencia)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-mono ${EVENTO_COR[ev.evento] ?? 'bg-slate-100 text-slate-600'}`}
                      >
                        {ev.evento}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{ev.entidadeTipo}</td>
                    <td className="px-4 py-3 font-mono text-xs">{ev.cnpj ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{ev.responsavel}</td>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {new Date(ev.timestamp).toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Paginação */}
            {totalPaginas > 1 && (
              <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Página {pagina} de {totalPaginas} · mostrando {paginaAtual.length} de{' '}
                  {filtrados.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPagina(1)}
                    disabled={pagina === 1}
                    className="px-2 py-1 text-xs rounded border border-slate-200 disabled:opacity-40 hover:border-blue-400"
                  >
                    «
                  </button>
                  <button
                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                    disabled={pagina === 1}
                    className="px-2 py-1 text-xs rounded border border-slate-200 disabled:opacity-40 hover:border-blue-400"
                  >
                    ‹ Anterior
                  </button>
                  <button
                    onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                    disabled={pagina === totalPaginas}
                    className="px-2 py-1 text-xs rounded border border-slate-200 disabled:opacity-40 hover:border-blue-400"
                  >
                    Próxima ›
                  </button>
                  <button
                    onClick={() => setPagina(totalPaginas)}
                    disabled={pagina === totalPaginas}
                    className="px-2 py-1 text-xs rounded border border-slate-200 disabled:opacity-40 hover:border-blue-400"
                  >
                    »
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
