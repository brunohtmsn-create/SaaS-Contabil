'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

function competenciaAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  PAGO: { label: 'Pago', cls: 'bg-green-100 text-green-800 border border-green-200' },
  PENDENTE: { label: 'Pendente', cls: 'bg-yellow-100 text-yellow-800 border border-yellow-200' },
  TRANSMITIDO: {
    label: 'Transmitido',
    cls: 'bg-blue-100 text-blue-800 border border-blue-200',
  },
  NAO_APURADO: { label: 'Não Apurado', cls: 'bg-gray-100 text-gray-500 border border-gray-200' },
}

type LinhaRelatorio = {
  tributo: string
  regime: string
  baseCalculo: string
  aliquota: string
  valorApurado: string
  valorPago: string
  status: 'PAGO' | 'PENDENTE' | 'TRANSMITIDO' | 'NAO_APURADO'
  vencimento?: string
  observacao?: string
}

type ResultadoRelatorio = {
  cnpj: string
  razaoSocial: string
  competencia: string
  geradoEm: string
  regime: string
  tributos: LinhaRelatorio[]
  totalApurado: string
  totalPago: string
  totalPendente: string
  percentualPago: number
}

function fmt(val: string | number): string {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtPct(val: string | number): string {
  return `${(Number(val) * 100).toFixed(2)}%`
}

export default function RelatorioFiscalPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const {
    data: relatorio,
    isFetching,
    refetch,
    isError,
  } = useQuery<ResultadoRelatorio>({
    queryKey: ['relatorio-fiscal', empresaId, competencia],
    queryFn: () => api.get(`/fiscal/relatorio/${empresaId}/${competencia}`).then((r) => r.data),
    enabled: false,
  })

  function handleGerar() {
    if (empresaId && competencia) refetch()
  }

  const r = relatorio

  const pagoCount = r?.tributos.filter((t) => t.status === 'PAGO').length ?? 0
  const pendCount = r?.tributos.filter((t) => t.status === 'PENDENTE').length ?? 0
  const transmCount = r?.tributos.filter((t) => t.status === 'TRANSMITIDO').length ?? 0

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Relatório Fiscal Consolidado</h1>
        <p className="mt-1 text-sm text-gray-500">
          Sumário de todos os tributos apurados, pagos e pendentes no período.
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
              {isFetching ? 'Gerando…' : 'Gerar Relatório'}
            </button>
          </div>
        </div>
        {isError && <p className="mt-2 text-sm text-red-600">Erro ao gerar relatório.</p>}
      </div>

      {r && (
        <>
          {/* Cabeçalho da empresa */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-lg font-bold text-gray-900">{r.razaoSocial}</p>
                <p className="text-sm text-gray-500">
                  CNPJ: {r.cnpj} · Regime: {r.regime.replace(/_/g, ' ')} · {r.competencia}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  Gerado em: {new Date(r.geradoEm).toLocaleString('pt-BR')}
                </p>
              </div>
              <div className="flex gap-6 text-center">
                <div>
                  <p
                    className={`text-3xl font-bold ${r.percentualPago >= 80 ? 'text-green-600' : r.percentualPago >= 50 ? 'text-yellow-600' : 'text-red-600'}`}
                  >
                    {r.percentualPago}%
                  </p>
                  <p className="text-xs text-gray-500">Pago</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-green-700">{pagoCount}</p>
                  <p className="text-xs text-gray-500">Pagos</p>
                </div>
                {transmCount > 0 && (
                  <div>
                    <p className="text-xl font-bold text-blue-600">{transmCount}</p>
                    <p className="text-xs text-gray-500">Transmitidos</p>
                  </div>
                )}
                {pendCount > 0 && (
                  <div>
                    <p className="text-xl font-bold text-yellow-600">{pendCount}</p>
                    <p className="text-xs text-gray-500">Pendentes</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Cards de totais */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Total Apurado</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{fmt(r.totalApurado)}</p>
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 shadow-sm">
              <p className="text-xs text-green-700">Total Pago</p>
              <p className="mt-1 text-2xl font-bold text-green-700">{fmt(r.totalPago)}</p>
            </div>
            <div
              className={`rounded-lg border p-4 shadow-sm ${Number(r.totalPendente) > 0 ? 'border-yellow-200 bg-yellow-50' : 'border-gray-200 bg-white'}`}
            >
              <p
                className={`text-xs ${Number(r.totalPendente) > 0 ? 'text-yellow-700' : 'text-gray-500'}`}
              >
                Total Pendente
              </p>
              <p
                className={`mt-1 text-2xl font-bold ${Number(r.totalPendente) > 0 ? 'text-yellow-700' : 'text-gray-900'}`}
              >
                {fmt(r.totalPendente)}
              </p>
            </div>
          </div>

          {/* Tabela de tributos */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800">Tributos do Período</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Tributo</th>
                    <th className="px-4 py-2 text-right">Base de Cálculo</th>
                    <th className="px-4 py-2 text-right">Alíquota</th>
                    <th className="px-4 py-2 text-right">Valor Apurado</th>
                    <th className="px-4 py-2 text-right">Valor Pago</th>
                    <th className="px-4 py-2 text-center">Status</th>
                    <th className="px-4 py-2 text-center">Vencimento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {r.tributos.map((t, i) => {
                    const cfg = STATUS_CONFIG[t.status] ?? STATUS_CONFIG['PENDENTE']!
                    const apurado = Number(t.valorApurado)
                    return (
                      <tr
                        key={i}
                        className={`hover:bg-gray-50 ${t.status === 'NAO_APURADO' ? 'opacity-50' : ''}`}
                      >
                        <td className="px-4 py-2 font-medium text-gray-900">{t.tributo}</td>
                        <td className="px-4 py-2 text-right text-gray-600">
                          {apurado > 0 ? fmt(t.baseCalculo) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600">
                          {Number(t.aliquota) > 0 ? fmtPct(t.aliquota) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">
                          {apurado > 0 ? fmt(t.valorApurado) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600">
                          {Number(t.valorPago) > 0 ? fmt(t.valorPago) : '—'}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${cfg.cls}`}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-center text-xs text-gray-500">
                          {t.vencimento ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
