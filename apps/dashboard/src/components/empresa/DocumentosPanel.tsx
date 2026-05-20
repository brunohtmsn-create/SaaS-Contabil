'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Props = { empresaId: string; competencia: string }

const statusColor: Record<string, string> = {
  CONCILIADO: 'bg-green-100 text-green-700',
  DIVERGENTE: 'bg-red-100 text-red-700',
  PENDENTE_REVISAO: 'bg-yellow-100 text-yellow-700',
  NORMALIZADO: 'bg-blue-100 text-blue-700',
  CAPTURADO: 'bg-slate-100 text-slate-600',
}

export function DocumentosPanel({ empresaId, competencia }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['documentos', empresaId, competencia],
    queryFn: () => api.get('/documentos', { params: { empresaId, competencia } }).then((r) => r.data),
  })

  const { data: stats } = useQuery({
    queryKey: ['doc-stats', empresaId, competencia],
    queryFn: () => api.get(`/documentos/stats/${empresaId}/${competencia}`).then((r) => r.data),
  })

  if (isLoading) return <div className="text-center py-12 text-slate-500">Carregando...</div>

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          {stats.porTipo?.map((item: any) => (
            <div key={item.tipo} className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="text-sm text-slate-500">{item.tipo}</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{item._count}</div>
              <div className="text-xs text-slate-400 mt-1">
                R$ {Number(item._sum?.valorTotal ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Tipo</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Número</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Emitente</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Valor</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.data?.slice(0, 20).map((doc: any) => (
              <tr key={doc.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{doc.tipo}</td>
                <td className="px-4 py-3">{doc.numero}</td>
                <td className="px-4 py-3 truncate max-w-[200px]">{doc.nomeEmitente}</td>
                <td className="px-4 py-3 text-right font-mono">
                  R$ {Number(doc.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[doc.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {doc.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data?.total ?? 0) > 20 && (
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 text-sm text-slate-500 text-center">
            Mostrando 20 de {data?.total} documentos
          </div>
        )}
      </div>
    </div>
  )
}
