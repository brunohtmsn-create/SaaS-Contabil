'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type EmpresaStatus = {
  empresaId: string
  cnpj: string
  razaoSocial: string
  totalDocumentos: number
  conciliados: number
  pendentes: number
  pendentesRevisao: number
}

export default function ConciliacaoPage() {
  const qc = useQueryClient()
  const [competencia, setCompetencia] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const { data: empresas = [], isLoading } = useQuery<EmpresaStatus[]>({
    queryKey: ['conciliacao-status', competencia],
    queryFn: () => api.get(`/conciliacao/status?competencia=${competencia}`).then((r) => r.data),
    refetchInterval: 10000,
  })

  const conciliarTodas = useMutation({
    mutationFn: (empresaId: string) => api.post(`/conciliacao/run/${empresaId}/${competencia}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conciliacao-status', competencia] }),
  })

  const totalPendentesRevisao = empresas.reduce((s, e) => s + e.pendentesRevisao, 0)
  const totalConciliados = empresas.reduce((s, e) => s + e.conciliados, 0)
  const totalDocs = empresas.reduce((s, e) => s + e.totalDocumentos, 0)
  const pctGeral = totalDocs > 0 ? Math.round((totalConciliados / totalDocs) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Conciliação Fiscal</h1>
          <p className="text-slate-500 text-sm mt-1">NFSe tomadas/emitidas e NFC-e por empresa</p>
        </div>
        <input
          type="month"
          value={competencia}
          onChange={(e) => setCompetencia(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {totalPendentesRevisao > 0 && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-4 flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="font-semibold text-yellow-900">
              {totalPendentesRevisao} documento(s) aguardando revisão humana
            </p>
            <p className="text-sm text-yellow-700 mt-0.5">
              Score &lt; 80 — acesse Auditoria para aprovar ou rejeitar manualmente.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Progresso geral</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{pctGeral}%</p>
          <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${pctGeral}%` }}
            />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Docs conciliados</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{totalConciliados}</p>
          <p className="text-xs text-slate-400 mt-1">de {totalDocs} total</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Pendente revisão</p>
          <p className="text-3xl font-bold text-yellow-600 mt-1">{totalPendentesRevisao}</p>
          <p className="text-xs text-slate-400 mt-1">requerem aprovação humana</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">Status por Empresa — {competencia}</h3>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando...</div>
        ) : empresas.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Nenhuma empresa encontrada.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Empresa
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">
                  Total
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">
                  Conciliados
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">
                  Pendentes
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">
                  Revisão
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">
                  Progresso
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {empresas.map((emp) => {
                const pct =
                  emp.totalDocumentos > 0
                    ? Math.round((emp.conciliados / emp.totalDocumentos) * 100)
                    : 0
                return (
                  <tr key={emp.empresaId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{emp.razaoSocial}</p>
                      <p className="font-mono text-xs text-slate-400">{emp.cnpj}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{emp.totalDocumentos}</td>
                    <td className="px-4 py-3 text-right font-mono text-green-600">
                      {emp.conciliados}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">
                      {emp.pendentes}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {emp.pendentesRevisao > 0 ? (
                        <span className="text-yellow-600 font-semibold">
                          {emp.pendentesRevisao}
                        </span>
                      ) : (
                        <span className="text-slate-300">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 w-8 text-right">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => conciliarTodas.mutate(emp.empresaId)}
                        disabled={conciliarTodas.isPending}
                        className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        Conciliar
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
