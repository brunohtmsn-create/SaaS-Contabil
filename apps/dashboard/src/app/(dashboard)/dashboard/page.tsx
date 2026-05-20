'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { AlertasPanel } from '@/components/dashboard/AlertasPanel'
import { RevenueChart } from '@/components/dashboard/RevenueChart'

export default function DashboardPage() {
  const { data: resumo } = useQuery({
    queryKey: ['dashboard-resumo'],
    queryFn: () => api.get('/dashboard/resumo').then((r) => r.data),
  })

  const { data: alertas } = useQuery({
    queryKey: ['dashboard-alertas'],
    queryFn: () => api.get('/dashboard/alertas').then((r) => r.data),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Painel Principal</h1>
        <p className="text-slate-500 mt-1">Competência: {resumo?.competencia ?? '...'}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Empresas Ativas"
          value={resumo?.totalEmpresas ?? 0}
          icon="building"
          color="blue"
        />
        <StatsCard
          title="Documentos"
          value={resumo?.totalDocumentos ?? 0}
          icon="file"
          color="green"
        />
        <StatsCard
          title="Alertas"
          value={resumo?.alertasNaoLidos ?? 0}
          icon="bell"
          color="yellow"
        />
        <StatsCard
          title="Obrig. Vencendo"
          value={resumo?.obrigacoesVencendo ?? 0}
          icon="calendar"
          color="red"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RevenueChart />
        </div>
        <div>
          <AlertasPanel alertas={alertas ?? []} />
        </div>
      </div>
    </div>
  )
}
