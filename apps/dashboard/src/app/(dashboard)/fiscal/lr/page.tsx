'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import {
  ChevronLeft,
  ChevronRight,
  Calculator,
  RefreshCw,
  CheckCircle,
  XCircle,
  Info,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Empresa {
  id: string
  cnpj: string
  razaoSocial: string
  regime: string
}

interface ResultadoIrpjCsllLR {
  cnpj: string
  competencia: string
  trimestreLabel: string
  lucroContabilTrimestral: string
  adicoesLALUR: string
  exclusoesLALUR: string
  lucroRealTrimestral: string
  baseCalculoIRPJ: string
  baseCalculoCSLL: string
  irpjNormal: string
  irpjAdicional: string
  irpjTotal: string
  csllTotal: string
  totalDevido: string
  prazoRecolhimento: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(valor: string | number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    typeof valor === 'string' ? parseFloat(valor) : valor
  )
}

function fmtData(data: string) {
  const [ano, mes, dia] = data.split('-')
  return `${dia}/${mes}/${ano}`
}

function competenciaLabel(comp: string) {
  const [ano, mes] = comp.split('-')
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${nomes[parseInt(mes!) - 1]} / ${ano}`
}

function navComp(comp: string, delta: number): string {
  const [ano, mes] = comp.split('-').map(Number)
  const d = new Date(ano!, mes! - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function trimestreDeCompetencia(comp: string): string {
  const mes = parseInt(comp.split('-')[1]!, 10)
  const ano = comp.split('-')[0]
  if (mes <= 3) return `${ano}-T1 (Jan–Mar)`
  if (mes <= 6) return `${ano}-T2 (Abr–Jun)`
  if (mes <= 9) return `${ano}-T3 (Jul–Set)`
  return `${ano}-T4 (Out–Dez)`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FiscalLRPage() {
  const hoje = new Date()
  const [competencia, setCompetencia] = useState(
    hoje.getMonth() === 0
      ? `${hoje.getFullYear() - 1}-12`
      : `${hoje.getFullYear()}-${String(hoje.getMonth()).padStart(2, '0')}`
  )
  const [empresaId, setEmpresaId] = useState('')
  const [resultado, setResultado] = useState<ResultadoIrpjCsllLR | null>(null)

  // Inputs manuais do LALUR
  const [lucroContabil, setLucroContabil] = useState('')
  const [adicoes, setAdicoes] = useState('')
  const [exclusoes, setExclusoes] = useState('')

  const { data: empresas = [] } = useQuery<Empresa[]>({
    queryKey: ['empresas-lr'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
    select: (data: Empresa[]) => data.filter((e) => e.regime === 'LUCRO_REAL'),
  })

  const apurar = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/irpj-csll-lr/${empresaId}/${competencia}`, {
          lucroContabilTrimestral: lucroContabil || '0',
          adicoesLALUR: adicoes || '0',
          exclusoesLALUR: exclusoes || '0',
        })
        .then((r) => r.data),
    onSuccess: (data: ResultadoIrpjCsllLR) => setResultado(data),
  })

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">IRPJ e CSLL — Lucro Real</h1>
          <p className="text-sm text-gray-500 mt-1">
            Apuração trimestral com base no lucro contábil ajustado
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 px-3 py-1.5 rounded-full">
          <Calculator className="w-4 h-4" />
          IRPJ 15% + 10% adicional / CSLL 9%
        </div>
      </div>

      {/* Informativo LALUR */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3">
        <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <strong>Lucro Real</strong> usa o lucro contábil ajustado pelo LALUR (Livro de Apuração do
          Lucro Real). Informe o lucro do trimestre e os ajustes de adições/exclusões para calcular
          IRPJ e CSLL corretamente.
        </div>
      </div>

      {/* Controles */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Navegação de competência */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Competência</label>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCompetencia(navComp(competencia, -1))}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="w-28 text-center font-semibold text-gray-800 text-sm">
                {competenciaLabel(competencia)}
              </span>
              <button
                onClick={() => setCompetencia(navComp(competencia, 1))}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-400">{trimestreDeCompetencia(competencia)}</p>
          </div>

          {/* Seletor de empresa */}
          <div className="flex flex-col gap-1 flex-1 min-w-48">
            <label className="text-xs font-medium text-gray-600">Empresa (Lucro Real)</label>
            <select
              value={empresaId}
              onChange={(e) => {
                setEmpresaId(e.target.value)
                setResultado(null)
              }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">Selecione uma empresa...</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.razaoSocial}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Inputs LALUR */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-gray-100">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">
              Lucro Contábil Trimestral (R$)
            </label>
            <input
              type="number"
              value={lucroContabil}
              onChange={(e) => setLucroContabil(e.target.value)}
              placeholder="Ex: 150000.00"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Adições ao LALUR (R$)</label>
            <input
              type="number"
              value={adicoes}
              onChange={(e) => setAdicoes(e.target.value)}
              placeholder="0.00"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-400">Despesas não dedutíveis, multas, etc.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Exclusões do LALUR (R$)</label>
            <input
              type="number"
              value={exclusoes}
              onChange={(e) => setExclusoes(e.target.value)}
              placeholder="0.00"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-400">JCP, dividendos recebidos, etc.</p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={() => apurar.mutate()}
            disabled={!empresaId || apurar.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {apurar.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Calculator className="w-4 h-4" />
            )}
            Apurar IRPJ e CSLL
          </button>
        </div>

        {apurar.isError && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">
            <XCircle className="w-4 h-4 shrink-0" />
            {(apurar.error as Error)?.message ?? 'Erro ao apurar IRPJ/CSLL LR'}
          </div>
        )}
      </div>

      {/* Resultado */}
      {resultado && (
        <>
          {/* LALUR resumo */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <h2 className="font-semibold text-gray-900">Apuração — {resultado.trimestreLabel}</h2>
            </div>

            <div className="grid grid-cols-3 gap-4 text-sm mb-4 bg-gray-50 rounded-lg p-4">
              <div className="text-center">
                <p className="text-gray-500 text-xs">Lucro Contábil</p>
                <p className="font-semibold text-gray-900">
                  {fmt(resultado.lucroContabilTrimestral)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-gray-500 text-xs">
                  + Adições: {fmt(resultado.adicoesLALUR)}
                  <br />− Exclusões: {fmt(resultado.exclusoesLALUR)}
                </p>
              </div>
              <div className="text-center border-l border-gray-200">
                <p className="text-gray-500 text-xs">= Lucro Real</p>
                <p className="font-bold text-blue-700 text-lg">
                  {fmt(resultado.lucroRealTrimestral)}
                </p>
              </div>
            </div>

            {/* Cards IRPJ e CSLL */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* IRPJ */}
              <div className="border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">IRPJ</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Normal (15%)</span>
                    <span className="font-medium">{fmt(resultado.irpjNormal)}</span>
                  </div>
                  {parseFloat(resultado.irpjAdicional) > 0 && (
                    <div className="flex justify-between text-orange-600">
                      <span>Adicional 10% (base &gt; R$60.000)</span>
                      <span className="font-medium">{fmt(resultado.irpjAdicional)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t border-gray-100 pt-2">
                    <span>Total IRPJ</span>
                    <span className="text-blue-700">{fmt(resultado.irpjTotal)}</span>
                  </div>
                </div>
              </div>

              {/* CSLL */}
              <div className="border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">CSLL</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Base de cálculo</span>
                    <span className="font-medium">{fmt(resultado.baseCalculoCSLL)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Alíquota</span>
                    <span className="font-medium">9%</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-gray-100 pt-2">
                    <span>Total CSLL</span>
                    <span className="text-purple-700">{fmt(resultado.csllTotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Total + Prazo */}
            <div className="mt-4 flex items-center justify-between bg-red-50 border border-red-100 rounded-xl p-4">
              <div>
                <p className="text-xs text-red-600 font-semibold uppercase tracking-wide">
                  Total a Recolher
                </p>
                <p className="text-3xl font-bold text-red-700">{fmt(resultado.totalDevido)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Prazo de recolhimento</p>
                <p className="text-lg font-bold text-gray-900">
                  {fmtData(resultado.prazoRecolhimento)}
                </p>
                <p className="text-xs text-gray-400">DARF código 2362 (IRPJ) / 2484 (CSLL)</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Estado vazio */}
      {!resultado && !apurar.isPending && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <Calculator className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">
            Informe o lucro contábil do trimestre, selecione a empresa e clique em{' '}
            <strong>Apurar IRPJ e CSLL</strong>.
          </p>
          <p className="text-gray-400 text-xs mt-2">
            O sistema aplica IRPJ 15% (+ 10% se base &gt; R$60.000/trim.) e CSLL 9% sobre o lucro
            real ajustado.
          </p>
        </div>
      )}
    </div>
  )
}
