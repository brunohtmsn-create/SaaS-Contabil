'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

function competenciaAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  OK: { label: 'OK', cls: 'bg-green-100 text-green-800 border border-green-200' },
  PENDENTE: { label: 'Pendente', cls: 'bg-yellow-100 text-yellow-800 border border-yellow-200' },
  ATRASADO: { label: 'Atrasado', cls: 'bg-red-100 text-red-800 border border-red-200' },
  INCOMPLETO: {
    label: 'Incompleto',
    cls: 'bg-orange-100 text-orange-800 border border-orange-200',
  },
  NAO_APLICAVEL: { label: 'N/A', cls: 'bg-gray-100 text-gray-500 border border-gray-200' },
}

type ItemDiag = {
  categoria: string
  item: string
  status: string
  detalhe?: string
  prazo?: string
}

type Indicador = {
  total: number
  ok: number
  pendentes: number
  atrasados: number
  percentualCompliance: number
}

type ResultadoDiag = {
  cnpj: string
  razaoSocial: string
  regime: string
  competencia: string
  itens: ItemDiag[]
  indicador: Indicador
  alertasAtivos: number
  documentosPendenteConciliacao: number
  recomendacoes: string[]
}

export default function DiagnosticoFiscalPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const {
    data: diagnostico,
    isFetching,
    refetch,
    isError,
  } = useQuery<ResultadoDiag>({
    queryKey: ['diagnostico', empresaId, competencia],
    queryFn: () => api.get(`/fiscal/diagnostico/${empresaId}/${competencia}`).then((r) => r.data),
    enabled: false,
  })

  function handleGerar() {
    if (empresaId && competencia) refetch()
  }

  const d = diagnostico

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Diagnóstico Fiscal</h1>
        <p className="mt-1 text-sm text-gray-500">
          Panorama completo de compliance e pendências fiscais de uma empresa em um período.
        </p>
      </div>

      {/* Seleção */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Empresa</label>
            <select
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Selecione…</option>
              {(empresas ?? []).map((emp: any) => (
                <option key={emp.id} value={emp.id}>
                  {emp.razaoSocial}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Competência</label>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleGerar}
              disabled={isFetching || !empresaId}
              className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isFetching ? 'Consultando…' : 'Ver Diagnóstico'}
            </button>
          </div>
        </div>
        {isError && <p className="mt-2 text-sm text-red-600">Erro ao carregar diagnóstico.</p>}
      </div>

      {d && (
        <>
          {/* Cabeçalho da empresa */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-lg font-bold text-gray-900">{d.razaoSocial}</p>
                <p className="text-sm text-gray-500">
                  CNPJ: {d.cnpj} · Regime: {d.regime.replace('_', ' ')} · {d.competencia}
                </p>
              </div>
              <div className="flex gap-4 text-center">
                <div>
                  <p
                    className={`text-3xl font-bold ${d.indicador.percentualCompliance >= 80 ? 'text-green-600' : d.indicador.percentualCompliance >= 50 ? 'text-yellow-600' : 'text-red-600'}`}
                  >
                    {d.indicador.percentualCompliance}%
                  </p>
                  <p className="text-xs text-gray-500">Compliance</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">{d.indicador.ok}</p>
                  <p className="text-xs text-gray-500">OK</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-yellow-600">{d.indicador.pendentes}</p>
                  <p className="text-xs text-gray-500">Pendentes</p>
                </div>
                {d.indicador.atrasados > 0 && (
                  <div>
                    <p className="text-2xl font-bold text-red-600">{d.indicador.atrasados}</p>
                    <p className="text-xs text-gray-500">Atrasados</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Itens do diagnóstico */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800">Checklist de Obrigações</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Categoria</th>
                  <th className="px-4 py-2 text-left">Item</th>
                  <th className="px-4 py-2 text-center">Status</th>
                  <th className="px-4 py-2 text-left">Detalhe</th>
                  <th className="px-4 py-2 text-center">Prazo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {d.itens.map((item, i) => {
                  const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG['PENDENTE']!
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-xs font-medium uppercase text-gray-500">
                        {item.categoria}
                      </td>
                      <td className="px-4 py-2 font-medium text-gray-900">{item.item}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-600">{item.detalhe ?? '—'}</td>
                      <td className="px-4 py-2 text-center text-xs text-gray-500">
                        {item.prazo ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Recomendações */}
          {d.recomendacoes.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
              <h2 className="mb-2 text-sm font-semibold text-yellow-800">Recomendações</h2>
              <ul className="space-y-1">
                {d.recomendacoes.map((rec, i) => (
                  <li key={i} className="text-sm text-yellow-700">
                    • {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Indicadores adicionais */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Alertas Ativos</p>
              <p
                className={`mt-1 text-2xl font-bold ${d.alertasAtivos > 0 ? 'text-red-600' : 'text-green-600'}`}
              >
                {d.alertasAtivos}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Documentos Pendentes de Conciliação</p>
              <p
                className={`mt-1 text-2xl font-bold ${d.documentosPendenteConciliacao > 0 ? 'text-orange-600' : 'text-green-600'}`}
              >
                {d.documentosPendenteConciliacao}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
