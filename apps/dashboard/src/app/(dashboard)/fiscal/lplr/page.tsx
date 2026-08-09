'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import {
  ChevronLeft,
  ChevronRight,
  Calculator,
  RefreshCw,
  CheckCircle,
  XCircle,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Empresa {
  id: string
  cnpj: string
  razaoSocial: string
  regime: string
}

interface ResultadoIrpjCsll {
  empresaId: string
  trimestreLabel: string
  categoria: string
  percentualPresuncaoIRPJ: number
  percentualPresuncaoCSLL: number
  receitaBrutaTrimestral: string
  baseCalculoIRPJ: string
  baseCalculoCSLL: string
  irpjNormal: string
  irpjAdicional: string
  irpjTotal: string
  csllTotal: string
  totalDevido: string
}

interface ResultadoPisCofins {
  empresaId: string
  competencia: string
  receitaBruta: string
  pis: string
  cofins: string
  totalDevido: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMoeda(valor: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    parseFloat(valor)
  )
}

function formatCompetencia(comp: string) {
  const [ano, mes] = comp.split('-')
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${meses[parseInt(mes!) - 1]}/${ano}`
}

function prevMonth(c: string) {
  const [a, m] = c.split('-').map(Number)
  return m === 1 ? `${a! - 1}-12` : `${a}-${String(m! - 1).padStart(2, '0')}`
}

function nextMonth(c: string) {
  const [a, m] = c.split('-').map(Number)
  return m === 12 ? `${a! + 1}-01` : `${a}-${String(m! + 1).padStart(2, '0')}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FiscalLPLRPage() {
  const queryClient = useQueryClient()
  const hoje = new Date()
  const [competencia, setCompetencia] = useState(
    `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
  )
  const [empresaId, setEmpresaId] = useState('')
  const [resultadoIrpj, setResultadoIrpj] = useState<ResultadoIrpjCsll | null>(null)
  const [resultadoPisCofins, setResultadoPisCofins] = useState<ResultadoPisCofins | null>(null)

  const { data: empresas = [] } = useQuery<Empresa[]>({
    queryKey: ['empresas-lplr'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
    select: (data: Empresa[]) =>
      data.filter((e) => e.regime === 'LUCRO_PRESUMIDO' || e.regime === 'LUCRO_REAL'),
  })

  const apurarIrpjCsll = useMutation({
    mutationFn: ({ id, comp }: { id: string; comp: string }) =>
      api.post(`/fiscal/irpj-csll-lp/${id}/${comp}`).then((r) => r.data),
    onSuccess: (data) => {
      setResultadoIrpj(data)
      queryClient.invalidateQueries({ queryKey: ['obrigacoes'] })
    },
  })

  const apurarPisCofins = useMutation({
    mutationFn: ({ id, comp }: { id: string; comp: string }) =>
      api.post(`/fiscal/pis-cofins-lp/${id}/${comp}`).then((r) => r.data),
    onSuccess: (data) => {
      setResultadoPisCofins(data)
      queryClient.invalidateQueries({ queryKey: ['obrigacoes'] })
    },
  })

  const empresaSelecionada = empresas.find((e) => e.id === empresaId)

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Fiscal — Lucro Presumido / Real</h1>
          <p className="text-slate-500 mt-1">Apuração IRPJ, CSLL, PIS e COFINS</p>
        </div>

        {/* Navegação de mês */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCompetencia(prevMonth(competencia))}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600"
            aria-label="Mês anterior"
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
            aria-label="Próximo mês"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Seletor de empresa */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">Empresa LP/LR</label>
        <select
          value={empresaId}
          onChange={(e) => {
            setEmpresaId(e.target.value)
            setResultadoIrpj(null)
            setResultadoPisCofins(null)
          }}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Selecione uma empresa…</option>
          {empresas.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.razaoSocial} — {emp.regime === 'LUCRO_PRESUMIDO' ? 'LP' : 'LR'}
            </option>
          ))}
        </select>
        {empresas.length === 0 && (
          <p className="text-sm text-slate-400 mt-2">Nenhuma empresa LP ou LR cadastrada.</p>
        )}
      </div>

      {empresaId && (
        <>
          {/* IRPJ + CSLL */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">IRPJ + CSLL</h2>
                <p className="text-sm text-slate-500">
                  Apuração trimestral — {competencia.split('-')[0]}
                </p>
              </div>
              <button
                disabled={!empresaId || apurarIrpjCsll.isPending}
                onClick={() => apurarIrpjCsll.mutate({ id: empresaId, comp: competencia })}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {apurarIrpjCsll.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Calculator className="w-4 h-4" />
                )}
                Apurar IRPJ/CSLL
              </button>
            </div>

            {apurarIrpjCsll.isError && (
              <div className="flex items-center gap-2 text-red-600 text-sm mb-4">
                <XCircle className="w-4 h-4" />
                <span>
                  Erro:{' '}
                  {(apurarIrpjCsll.error as any)?.response?.data?.error ?? 'Falha na apuração'}
                </span>
              </div>
            )}

            {resultadoIrpj && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  <span>
                    Trimestre {resultadoIrpj.trimestreLabel} — Categoria:{' '}
                    {resultadoIrpj.categoria.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Receita Bruta</p>
                    <p className="text-lg font-semibold text-slate-900 mt-1">
                      {formatMoeda(resultadoIrpj.receitaBrutaTrimestral)}
                    </p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">
                      Base IRPJ ({resultadoIrpj.percentualPresuncaoIRPJ}%)
                    </p>
                    <p className="text-lg font-semibold text-blue-900 mt-1">
                      {formatMoeda(resultadoIrpj.baseCalculoIRPJ)}
                    </p>
                  </div>
                  <div className="bg-indigo-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">IRPJ Total</p>
                    <p className="text-lg font-semibold text-indigo-900 mt-1">
                      {formatMoeda(resultadoIrpj.irpjTotal)}
                    </p>
                    {parseFloat(resultadoIrpj.irpjAdicional) > 0 && (
                      <p className="text-xs text-indigo-600 mt-0.5">
                        incl. adicional {formatMoeda(resultadoIrpj.irpjAdicional)}
                      </p>
                    )}
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">CSLL (9%)</p>
                    <p className="text-lg font-semibold text-purple-900 mt-1">
                      {formatMoeda(resultadoIrpj.csllTotal)}
                    </p>
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-4 flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-700">Total IRPJ + CSLL</span>
                  <span className="text-xl font-bold text-red-700">
                    {formatMoeda(resultadoIrpj.totalDevido)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* PIS + COFINS */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">PIS + COFINS</h2>
                <p className="text-sm text-slate-500">
                  Regime cumulativo — {formatCompetencia(competencia)}
                </p>
              </div>
              <button
                disabled={!empresaId || apurarPisCofins.isPending}
                onClick={() => apurarPisCofins.mutate({ id: empresaId, comp: competencia })}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {apurarPisCofins.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Calculator className="w-4 h-4" />
                )}
                Apurar PIS/COFINS
              </button>
            </div>

            {apurarPisCofins.isError && (
              <div className="flex items-center gap-2 text-red-600 text-sm mb-4">
                <XCircle className="w-4 h-4" />
                <span>
                  Erro:{' '}
                  {(apurarPisCofins.error as any)?.response?.data?.error ?? 'Falha na apuração'}
                </span>
              </div>
            )}

            {resultadoPisCofins && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  <span>Apurado para {formatCompetencia(resultadoPisCofins.competencia)}</span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Receita Bruta</p>
                    <p className="text-lg font-semibold text-slate-900 mt-1">
                      {formatMoeda(resultadoPisCofins.receitaBruta)}
                    </p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">PIS (0,65%)</p>
                    <p className="text-lg font-semibold text-emerald-900 mt-1">
                      {formatMoeda(resultadoPisCofins.pis)}
                    </p>
                  </div>
                  <div className="bg-teal-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">COFINS (3%)</p>
                    <p className="text-lg font-semibold text-teal-900 mt-1">
                      {formatMoeda(resultadoPisCofins.cofins)}
                    </p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Total Devido</p>
                    <p className="text-lg font-semibold text-red-900 mt-1">
                      {formatMoeda(resultadoPisCofins.totalDevido)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Informativo */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <strong>Regime Cumulativo (LP):</strong> PIS 0,65% e COFINS 3% sobre receita bruta
            integral, sem aproveitamento de créditos. Empresas no Lucro Real utilizam regime
            não-cumulativo com alíquotas de 1,65% e 7,6% respectivamente.
          </div>
        </>
      )}
    </div>
  )
}
