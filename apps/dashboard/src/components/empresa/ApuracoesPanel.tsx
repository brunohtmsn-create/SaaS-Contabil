'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Props = { empresaId: string; competencia: string }

export function ApuracoesPanel({ empresaId, competencia }: Props) {
  const qc = useQueryClient()

  const { data: apuracoes = [] } = useQuery({
    queryKey: ['apuracoes', empresaId, competencia],
    queryFn: () =>
      api.get(`/fiscal/apuracoes/${empresaId}`, { params: { competencia } }).then((r) => r.data),
  })

  const apurarPGDAS = useMutation({
    mutationFn: () => api.post(`/fiscal/pgdas/${empresaId}/${competencia}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apuracoes', empresaId, competencia] }),
  })

  const calcDifal = useMutation({
    mutationFn: () => api.post(`/fiscal/difal/${empresaId}/${competencia}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apuracoes', empresaId, competencia] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <button
          onClick={() => apurarPGDAS.mutate()}
          disabled={apurarPGDAS.isPending}
          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {apurarPGDAS.isPending ? 'Apurando...' : 'Apurar PGDAS'}
        </button>
        <button
          onClick={() => calcDifal.mutate()}
          disabled={calcDifal.isPending}
          className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          Calcular DIFAL
        </button>
      </div>

      {apuracoes.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          Nenhuma apuração encontrada para {competencia}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {apuracoes.map((ap: any) => (
            <div key={ap.id} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-slate-900">{ap.tipo}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    ap.status === 'TRANSMITIDO'
                      ? 'bg-green-100 text-green-700'
                      : ap.status === 'CALCULADO'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {ap.status}
                </span>
              </div>
              {ap.tipo === 'PGDAS' && ap.dados && (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>Receita Bruta</span>
                    <span className="font-mono">
                      R${' '}
                      {Number(ap.dados.receitaBrutaTotal ?? 0).toLocaleString('pt-BR', {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Alíquota Efetiva</span>
                    <span className="font-mono">{ap.dados.aliquotaEfetiva ?? 0}%</span>
                  </div>
                  <div className="flex justify-between font-semibold text-slate-900 pt-2 border-t border-slate-100">
                    <span>Valor DAS</span>
                    <span className="font-mono text-blue-600">
                      R${' '}
                      {Number(ap.dados.valorDAS ?? 0).toLocaleString('pt-BR', {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
