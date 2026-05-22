'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Props = { empresaId: string; competencia: string }

const FASES = [
  { key: 'CAPTURA',   label: 'Captura de Documentos',  icon: '📥' },
  { key: 'CONCILIACAO', label: 'Conciliação',           icon: '⚖️' },
  { key: 'PGDAS',    label: 'PGDAS + Fator R',          icon: '💰' },
  { key: 'DIFAL',    label: 'DIFAL + GNRE',             icon: '🗺️' },
  { key: 'DESTDA',   label: 'DeSTDA',                   icon: '📋' },
  { key: 'EFD_REINF', label: 'EFD-Reinf',              icon: '📑' },
  { key: 'ESOCIAL',  label: 'e-Social',                 icon: '👥' },
  { key: 'DCTFWEB',  label: 'DCTFWeb',                  icon: '🏛️' },
  { key: 'CONTABIL', label: 'Lançamentos + Depreciação', icon: '📒' },
  { key: 'BANCARIA', label: 'Open Finance + Concil. Bancária', icon: '🏦' },
  { key: 'FGTS',     label: 'FGTS Digital',             icon: '💼' },
]

export function FechamentoPanel({ empresaId, competencia }: Props) {
  const { data: status } = useQuery({
    queryKey: ['fechamento-status', empresaId, competencia],
    queryFn: () => api.get(`/fechamento/status/${empresaId}/${competencia}`).then((r) => r.data),
    refetchInterval: 5000,
  })

  const apuracoesTipos = new Set(status?.apuracoes?.map((a: any) => a.tipo) ?? [])

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-900 mb-4">Progresso do Fechamento — {competencia}</h3>

        <div className="space-y-3">
          {FASES.map((fase) => {
            const concluida = apuracoesTipos.has(fase.key) ||
              (fase.key === 'BANCARIA' && (status?.lancamentos ?? 0) > 0)

            return (
              <div key={fase.key} className="flex items-center gap-4">
                <span className="w-8 h-8 flex items-center justify-center text-lg">{fase.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">{fase.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      concluida ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {concluida ? 'Concluído' : 'Pendente'}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-100 flex gap-8 text-sm text-slate-600">
          <div>
            <span className="font-medium">Lançamentos:</span>{' '}
            <span className="font-mono">{status?.lancamentos ?? 0}</span>
          </div>
          <div>
            <span className="font-medium">Obrigações:</span>{' '}
            <span className="font-mono">{status?.obrigacoes?.length ?? 0}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
