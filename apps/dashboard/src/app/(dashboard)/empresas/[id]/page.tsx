'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useState } from 'react'
import { FechamentoPanel } from '@/components/empresa/FechamentoPanel'
import { DocumentosPanel } from '@/components/empresa/DocumentosPanel'
import { ApuracoesPanel } from '@/components/empresa/ApuracoesPanel'
import { EmpresaAuditoriaPanel } from '@/components/empresa/EmpresaAuditoriaPanel'
import { CredenciaisPanel } from '@/components/empresa/CredenciaisPanel'

export default function EmpresaDetailPage({ params }: { params: { id: string } }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'documentos' | 'fiscal' | 'fechamento' | 'credenciais' | 'auditoria'>('documentos')
  const [competencia, setCompetencia] = useState(() => new Date().toISOString().slice(0, 7))

  const { data: empresa } = useQuery({
    queryKey: ['empresa', params.id],
    queryFn: () => api.get(`/empresas/${params.id}`).then((r) => r.data),
  })

  const iniciarFechamento = useMutation({
    mutationFn: () => api.post(`/fechamento/run/${params.id}/${competencia}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['fechamento-status', params.id, competencia] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{empresa?.razaoSocial ?? '...'}</h1>
          <p className="text-slate-500 mt-1 font-mono">{empresa?.cnpj}</p>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 mt-2">
            {empresa?.regime?.replace(/_/g, ' ')}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <button
            onClick={() => iniciarFechamento.mutate()}
            disabled={iniciarFechamento.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {iniciarFechamento.isPending ? 'Iniciando...' : 'Fechar Competência'}
          </button>
        </div>
      </div>

      <div className="flex border-b border-slate-200">
        {(
          [
            { key: 'documentos', label: 'Documentos' },
            { key: 'fiscal', label: 'Fiscal' },
            { key: 'fechamento', label: 'Fechamento' },
            { key: 'credenciais', label: 'Credenciais' },
            { key: 'auditoria', label: 'Auditoria' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'documentos' && <DocumentosPanel empresaId={params.id} competencia={competencia} />}
      {tab === 'fiscal' && <ApuracoesPanel empresaId={params.id} competencia={competencia} />}
      {tab === 'fechamento' && <FechamentoPanel empresaId={params.id} competencia={competencia} />}
      {tab === 'credenciais' && (
        <CredenciaisPanel empresaId={params.id} cnpj={empresa?.cnpj ?? ''} />
      )}
      {tab === 'auditoria' && <EmpresaAuditoriaPanel empresaId={params.id} />}
    </div>
  )
}
