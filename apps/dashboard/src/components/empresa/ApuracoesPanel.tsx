'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Props = { empresaId: string; competencia: string }

const BRL = (v: unknown) =>
  Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function statusColor(status: string) {
  if (status === 'TRANSMITIDO') return 'bg-green-100 text-green-700'
  if (status === 'CALCULADO') return 'bg-blue-100 text-blue-700'
  if (status === 'PAGO') return 'bg-emerald-100 text-emerald-700'
  if (status === 'ERRO') return 'bg-red-100 text-red-700'
  return 'bg-slate-100 text-slate-600'
}

function ApuracaoDetails({ ap }: { ap: any }) {
  const d = ap.dados ?? {}
  if (ap.tipo === 'PGDAS') {
    return (
      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Receita Bruta</span>
          <span className="font-mono">R$ {BRL(d.receitaBrutaTotal)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>Alíquota Efetiva</span>
          <span className="font-mono">{d.aliquotaEfetiva ?? 0}%</span>
        </div>
        <div className="flex justify-between font-semibold text-slate-900 pt-2 border-t border-slate-100">
          <span>Valor DAS</span>
          <span className="font-mono text-blue-600">R$ {BRL(d.valorDAS)}</span>
        </div>
      </div>
    )
  }
  if (ap.tipo === 'DIFAL') {
    return (
      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Base de Cálculo</span>
          <span className="font-mono">R$ {BRL(d.baseCalculo)}</span>
        </div>
        <div className="flex justify-between font-semibold text-slate-900 pt-2 border-t border-slate-100">
          <span>Total DIFAL</span>
          <span className="font-mono text-purple-600">R$ {BRL(d.totalDifal ?? d.valor)}</span>
        </div>
      </div>
    )
  }
  if (ap.tipo === 'DMS' || ap.tipo === 'ISS') {
    return (
      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Total Serviços</span>
          <span className="font-mono">R$ {BRL(d.totalServicos)}</span>
        </div>
        <div className="flex justify-between font-semibold text-slate-900 pt-2 border-t border-slate-100">
          <span>Total ISS</span>
          <span className="font-mono text-orange-600">R$ {BRL(d.totalISS)}</span>
        </div>
      </div>
    )
  }
  if (ap.tipo === 'GNRE' || ap.tipo === 'DESTDA') {
    return (
      <div className="space-y-2 text-sm">
        <div className="flex justify-between font-semibold text-slate-900">
          <span>Valor Total</span>
          <span className="font-mono text-red-600">R$ {BRL(d.totalDevido ?? d.valor)}</span>
        </div>
      </div>
    )
  }
  return null
}

export function ApuracoesPanel({ empresaId, competencia }: Props) {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['apuracoes', empresaId, competencia] })

  const { data: apuracoes = [] } = useQuery({
    queryKey: ['apuracoes', empresaId, competencia],
    queryFn: () =>
      api.get(`/fiscal/apuracoes/${empresaId}`, { params: { competencia } }).then((r) => r.data),
  })

  const apurarPGDAS = useMutation({
    mutationFn: () => api.post(`/fiscal/pgdas/${empresaId}/${competencia}`),
    onSuccess: invalidate,
  })
  const calcDifal = useMutation({
    mutationFn: () => api.post(`/fiscal/difal/${empresaId}/${competencia}`),
    onSuccess: invalidate,
  })
  const calcGNRE = useMutation({
    mutationFn: () => api.post(`/fiscal/gnre/${empresaId}/${competencia}`),
    onSuccess: invalidate,
  })
  const calcDeSTDA = useMutation({
    mutationFn: () => api.post(`/fiscal/destda/${empresaId}/${competencia}`),
    onSuccess: invalidate,
  })
  const apurarDMS = useMutation({
    mutationFn: () => api.post(`/fiscal/dms/${empresaId}/${competencia}`),
    onSuccess: invalidate,
  })
  const processarEFDReinf = useMutation({
    mutationFn: () => api.post(`/fiscal/efdreinf/${empresaId}/${competencia}`),
    onSuccess: invalidate,
  })

  const actions = [
    { label: 'PGDAS', mutation: apurarPGDAS, color: 'bg-green-600 hover:bg-green-700' },
    { label: 'DIFAL', mutation: calcDifal, color: 'bg-purple-600 hover:bg-purple-700' },
    { label: 'GNRE', mutation: calcGNRE, color: 'bg-indigo-600 hover:bg-indigo-700' },
    { label: 'DeSTDA', mutation: calcDeSTDA, color: 'bg-teal-600 hover:bg-teal-700' },
    { label: 'DMS', mutation: apurarDMS, color: 'bg-orange-600 hover:bg-orange-700' },
    { label: 'EFD-Reinf', mutation: processarEFDReinf, color: 'bg-rose-600 hover:bg-rose-700' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {actions.map(({ label, mutation, color }) => (
          <button
            key={label}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className={`${color} text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors`}
          >
            {mutation.isPending ? `${label}...` : label}
          </button>
        ))}
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
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(ap.status)}`}
                >
                  {ap.status}
                </span>
              </div>
              <ApuracaoDetails ap={ap} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
