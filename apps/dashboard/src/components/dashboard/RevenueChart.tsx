'use client'

import { useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { api } from '@/lib/api'

type VolumeMes = { mes: string; nfe: number; nfce: number; nfse: number }

export function RevenueChart() {
  const { data = [], isLoading } = useQuery<VolumeMes[]>({
    queryKey: ['dashboard-volume'],
    queryFn: () => api.get('/dashboard/volume').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const total = data.reduce((s, d) => s + d.nfe + d.nfce + d.nfse, 0)

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold text-slate-900">Volume de Documentos — 6 meses</h3>
        {!isLoading && (
          <span className="text-sm text-slate-500">
            Total:{' '}
            <span className="font-semibold text-slate-900">{total.toLocaleString('pt-BR')}</span>
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="h-[280px] flex items-center justify-center text-slate-400">
          Carregando...
        </div>
      ) : total === 0 ? (
        <div className="h-[280px] flex items-center justify-center text-slate-400">
          Nenhum documento nos últimos 6 meses.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#94a3b8' }} />
            <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} allowDecimals={false} />
            <Tooltip
              formatter={(value: number, name: string) => [value.toLocaleString('pt-BR'), name]}
            />
            <Legend />
            <Bar dataKey="nfe" name="NF-e" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="nfce" name="NFC-e" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="nfse" name="NFS-e" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
