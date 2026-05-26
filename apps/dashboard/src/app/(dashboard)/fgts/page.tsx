'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ChevronLeft, ChevronRight, Play, RefreshCw, AlertTriangle } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Empresa = { id: string; cnpj: string; razaoSocial: string }

type ResultadoFGTS = {
  competencia: string
  cnpj: string
  baseCalculo: string
  aliquota: string
  valorFGTS: string
  totalEmpregados: number
}

type ResultadoGRRF = {
  competencia: string
  cnpj: string
  saldoFGTS: string
  multaRescisoria: string
  totalGuia: string
}

type Apuracao = {
  id: string
  empresaId: string
  competencia: string
  tipo: string
  status: string
  dados: ResultadoFGTS | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function formatBRL(value: string | number | null | undefined): string {
  if (value == null) return '—'
  return fmt.format(Number(value))
}

function statusBadge(status: string) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold'
  switch (status) {
    case 'CALCULADO':
      return <span className={`${base} bg-blue-100 text-blue-700`}>Calculado</span>
    case 'TRANSMITIDO':
      return <span className={`${base} bg-green-100 text-green-700`}>Transmitido</span>
    case 'PAGO':
      return <span className={`${base} bg-green-100 text-green-700`}>Pago</span>
    case 'ERRO':
      return <span className={`${base} bg-red-100 text-red-700`}>Erro</span>
    default:
      return <span className={`${base} bg-slate-100 text-slate-500`}>Pendente</span>
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FGTSPage() {
  const queryClient = useQueryClient()
  const [competencia, setCompetencia] = useState(() => new Date().toISOString().slice(0, 7))
  const [grrfEmpresaId, setGrrfEmpresaId] = useState<string>('')
  const [grrfResult, setGrrfResult] = useState<ResultadoGRRF | null>(null)

  const { data: empresas = [] } = useQuery<Empresa[]>({
    queryKey: ['empresas'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
  })

  const { data: apuracoes = [], isLoading } = useQuery<Apuracao[]>({
    queryKey: ['fgts-apuracoes', competencia],
    queryFn: () =>
      api.get(`/fiscal/apuracoes?competencia=${competencia}&tipo=FGTS`).then((r) => r.data),
  })

  // Apurar FGTS para uma empresa
  const apurarFGTS = useMutation({
    mutationFn: (empresaId: string) =>
      api.post(`/fiscal/fgts/${empresaId}/${competencia}`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fgts-apuracoes', competencia] })
    },
  })

  // Gerar GRRF (rescisão)
  const gerarGRRF = useMutation({
    mutationFn: (empresaId: string) =>
      api.post(`/fiscal/fgts/grrf/${empresaId}/${competencia}`).then((r) => r.data),
    onSuccess: (data: ResultadoGRRF) => {
      setGrrfResult(data)
    },
  })

  const apuracoesPorEmpresa = new Map<string, Apuracao>()
  for (const ap of apuracoes) {
    apuracoesPorEmpresa.set(ap.empresaId, ap)
  }

  const totalFGTS = apuracoes.reduce((acc, ap) => {
    const d = ap.dados as any
    return acc + Number(d?.valorFGTS ?? 0)
  }, 0)

  const totalEmpregados = apuracoes.reduce((acc, ap) => {
    const d = ap.dados as any
    return acc + Number(d?.totalEmpregados ?? 0)
  }, 0)

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">FGTS Digital</h1>
          <p className="text-slate-500 mt-1 text-sm">Apuração mensal e GRRF rescisório</p>
        </div>

        {/* Navegação de competência */}
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

      {/* Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Empresas apuradas</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{apuracoes.length}</p>
          <p className="text-xs text-slate-400 mt-1">de {empresas.length} cadastradas</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Total FGTS a recolher</p>
          <p className="text-3xl font-bold text-blue-700 mt-1">{formatBRL(totalFGTS)}</p>
          <p className="text-xs text-slate-400 mt-1">8% sobre folha salarial</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Total de empregados</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{totalEmpregados}</p>
          <p className="text-xs text-slate-400 mt-1">com lançamentos no período</p>
        </div>
      </div>

      {/* Tabela de apurações */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Apuração por Empresa</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                Empresa
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">
                Base de Cálculo
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">
                FGTS (8%)
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">
                Empregados
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">
                Status
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  Carregando apurações…
                </td>
              </tr>
            ) : empresas.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  Nenhuma empresa cadastrada.
                </td>
              </tr>
            ) : (
              empresas.map((empresa) => {
                const apuracao = apuracoesPorEmpresa.get(empresa.id)
                const dados = apuracao?.dados as any
                const isPending = apurarFGTS.isPending && apurarFGTS.variables === empresa.id

                return (
                  <tr key={empresa.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-800">{empresa.razaoSocial}</div>
                      <div className="text-xs text-slate-400 font-mono mt-0.5">{empresa.cnpj}</div>
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-slate-700">
                      {apuracao ? formatBRL(dados?.baseCalculo) : '—'}
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-semibold text-blue-700">
                      {apuracao ? formatBRL(dados?.valorFGTS) : '—'}
                    </td>
                    <td className="px-6 py-4 text-center text-slate-700">
                      {apuracao ? (dados?.totalEmpregados ?? 0) : '—'}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {apuracao ? (
                        statusBadge(apuracao.status)
                      ) : (
                        <span className="text-xs text-slate-400">Não apurado</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => apurarFGTS.mutate(empresa.id)}
                        disabled={isPending}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 mx-auto"
                      >
                        {isPending ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        {apuracao ? 'Re-apurar' : 'Apurar'}
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* GRRF — Guia de Rescisão */}
      <div className="bg-white rounded-xl border border-orange-200 p-6">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
          <div>
            <h2 className="font-semibold text-slate-900">GRRF — Rescisão sem Justa Causa</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Calcula a guia de recolhimento rescisório com multa de 40% sobre o saldo FGTS
              acumulado.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Empresa</label>
            <select
              value={grrfEmpresaId}
              onChange={(e) => {
                setGrrfEmpresaId(e.target.value)
                setGrrfResult(null)
              }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="">Selecione a empresa…</option>
              {empresas.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.razaoSocial}
                </option>
              ))}
            </select>
          </div>
          <button
            disabled={!grrfEmpresaId || gerarGRRF.isPending}
            onClick={() => gerarGRRF.mutate(grrfEmpresaId)}
            className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {gerarGRRF.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            Gerar GRRF
          </button>
        </div>

        {grrfResult && (
          <div className="mt-4 grid grid-cols-3 gap-4 p-4 bg-orange-50 rounded-lg border border-orange-200">
            <div>
              <p className="text-xs text-orange-600 font-medium">Saldo FGTS</p>
              <p className="text-lg font-bold text-slate-800 mt-0.5">
                {formatBRL(grrfResult.saldoFGTS)}
              </p>
            </div>
            <div>
              <p className="text-xs text-orange-600 font-medium">Multa Rescisória (40%)</p>
              <p className="text-lg font-bold text-orange-700 mt-0.5">
                {formatBRL(grrfResult.multaRescisoria)}
              </p>
            </div>
            <div>
              <p className="text-xs text-orange-600 font-medium">Total da Guia</p>
              <p className="text-lg font-bold text-red-700 mt-0.5">
                {formatBRL(grrfResult.totalGuia)}
              </p>
            </div>
          </div>
        )}

        {gerarGRRF.isError && (
          <p className="mt-3 text-sm text-red-600">Erro ao gerar GRRF. Verifique as apurações.</p>
        )}
      </div>
    </div>
  )
}
