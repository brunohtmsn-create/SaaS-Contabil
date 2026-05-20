'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export default function AuditoriaPage() {
  const { data: pendentes = [] } = useQuery({
    queryKey: ['pendentes-revisao'],
    queryFn: () => api.get('/auditoria/pendentes-revisao').then((r) => r.data),
  })

  const { data: eventos = [] } = useQuery({
    queryKey: ['audit-eventos'],
    queryFn: () => api.get('/auditoria/eventos').then((r) => r.data),
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Auditoria</h1>

      {pendentes.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <h3 className="font-semibold text-yellow-800 mb-3">
            {pendentes.length} pendência(s) aguardando revisão humana
          </h3>
          <div className="space-y-2">
            {pendentes.map((ev: any) => (
              <div key={ev.id} className="flex items-center justify-between bg-white rounded-lg p-4 shadow-sm">
                <div>
                  <p className="text-sm font-medium text-slate-900">{ev.entidadeTipo} — {ev.entidadeId.slice(0, 8)}...</p>
                  <p className="text-xs text-slate-500 mt-0.5">Score: {ev.score} | {new Date(ev.timestamp).toLocaleString('pt-BR')}</p>
                </div>
                <button
                  onClick={() => api.post(`/auditoria/aprovar/${ev.id}`)}
                  className="bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-700"
                >
                  Aprovar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Trilha de Auditoria</h3>
          <button
            onClick={() => api.get('/auditoria/verificar-cadeia').then((r) => alert(JSON.stringify(r.data, null, 2)))}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Verificar Integridade da Cadeia
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Seq</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Evento</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">CNPJ</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Responsável</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Data/Hora</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {eventos.slice(0, 20).map((ev: any) => (
              <tr key={ev.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{String(ev.sequencia)}</td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-mono">
                    {ev.evento}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{ev.cnpj ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{ev.responsavel}</td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {new Date(ev.timestamp).toLocaleString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
