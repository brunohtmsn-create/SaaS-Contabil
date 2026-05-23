'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import { ChevronLeft, ChevronRight, Play, RefreshCw } from 'lucide-react'

type Empresa = { id: string; cnpj: string; razaoSocial: string; regime: string }

type Apuracao = {
  id: string
  empresaId: string
  competencia: string
  tipo: string
  status: string
  dados: Record<string, unknown>
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

function formatBRL(value: unknown): string {
  const n = Number(value ?? 0)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

function statusBadge(status: string) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold'
  switch (status) {
    case 'TRANSMITIDO': return <span className={`${base} bg-green-100 text-green-700`}>Transmitido</span>
    case 'CALCULADO':   return <span className={`${base} bg-blue-100 text-blue-700`}>Calculado</span>
    case 'ERRO':        return <span className={`${base} bg-red-100 text-red-700`}>Erro</span>
    default:            return <span className={`${base} bg-slate-100 text-slate-500`}>Pendente</span>
  }
}

export default function FiscalPage() {
  const queryClient = useQueryClient()
  const [competencia, setCompetencia] = useState(() => new Date().toISOString().slice(0, 7))

  const { data: empresas = [] } = useQuery<Empresa[]>({
    queryKey: ['empresas'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
  })

  const { data: apuracoes = [] } = useQuery<Apuracao[]>({
    queryKey: ['apuracoes', competencia],
    queryFn: () => api.get(`/fiscal/apuracoes?competencia=${competencia}`).then((r) => r.data),
  })

  const apurarPGDAS = useMutation({
    mutationFn: ({ empresaId }: { empresaId: string }) =>
      api.post(`/fiscal/pgdas/${empresaId}/${competencia}`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['apuracoes', competencia] }),
  })

  const transmitirPGDAS = useMutation({
    mutationFn: ({ empresaId }: { empresaId: string }) =>
      api.post(`/fiscal/pgdas/transmitir/${empresaId}/${competencia}`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['apuracoes', competencia] }),
  })

  const apuracaoPorEmpresa = (empresaId: string, tipo: string) =>
    apuracoes.find((a) => a.empresaId === empresaId && a.tipo === tipo)

  const totalDAS = apuracoes
    .filter((a) => a.tipo === 'PGDAS')
    .reduce((acc, a) => acc + Number((a.dados as any)?.valorDAS ?? 0), 0)

  const snEmpresas = empresas.filter((e) => e.regime === 'SIMPLES_NACIONAL')

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Apuração Fiscal</h1>
          <p className="text-slate-500 text-sm mt-1">Simples Nacional — PGDAS-D, DIFAL, DeSTDA</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCompetencia(prevMonth(competencia))}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => setCompetencia(nextMonth(competencia))}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Empresas SN</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{snEmpresas.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Total DAS — {competencia}</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{formatBRL(totalDAS)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">PGDAS apurados</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">
            {apuracoes.filter((a) => a.tipo === 'PGDAS').length}
          </p>
          <p className="text-xs text-slate-400 mt-1">de {snEmpresas.length} empresas</p>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Empresa</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">CNPJ</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">Fator R</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">PGDAS</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Valor DAS</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">DIFAL</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">DeSTDA</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {snEmpresas.map((emp) => {
              const pgdas = apuracaoPorEmpresa(emp.id, 'PGDAS')
              const difal = apuracaoPorEmpresa(emp.id, 'DIFAL')
              const destda = apuracaoPorEmpresa(emp.id, 'DESTDA')
              const dados = pgdas?.dados as any
              const fatorR = dados?.fatorR != null ? `${Number(dados.fatorR).toFixed(1)}%` : '—'
              const anexo = dados?.faixaAnexo ? `Anexo ${dados.faixaAnexo}` : null
              const isPending = apurarPGDAS.isPending && (apurarPGDAS.variables as any)?.empresaId === emp.id

              return (
                <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-800">{emp.razaoSocial}</td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">{emp.cnpj}</td>
                  <td className="px-6 py-4 text-center">
                    {pgdas ? (
                      <div>
                        <span className="font-mono text-sm">{fatorR}</span>
                        {anexo && (
                          <span className="ml-1 text-xs text-slate-400">({anexo})</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {pgdas ? statusBadge(pgdas.status) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-6 py-4 text-right font-mono">
                    {dados?.valorDAS ? formatBRL(dados.valorDAS) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {difal ? statusBadge(difal.status) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {destda ? statusBadge(destda.status) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {!pgdas && (
                        <button
                          onClick={() => apurarPGDAS.mutate({ empresaId: emp.id })}
                          disabled={isPending}
                          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          {isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          Apurar
                        </button>
                      )}
                      {pgdas?.status === 'CALCULADO' && (
                        <button
                          onClick={() => transmitirPGDAS.mutate({ empresaId: emp.id })}
                          disabled={transmitirPGDAS.isPending}
                          className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                        >
                          Transmitir
                        </button>
                      )}
                      {pgdas?.status === 'TRANSMITIDO' && (
                        <span className="text-xs text-green-600 font-medium">OK</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {snEmpresas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                  Nenhuma empresa do Simples Nacional cadastrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
