'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

function formatBRL(val: string | number | undefined): string {
  if (val === undefined || val === null) return 'R$ 0,00'
  const n = typeof val === 'string' ? parseFloat(val) : val
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatPct(val: string | number | undefined): string {
  if (val === undefined || val === null) return '0,00%'
  const n = typeof val === 'string' ? parseFloat(val) : val
  return (n * 100).toFixed(2).replace('.', ',') + '%'
}

const REGIME_LABELS: Record<string, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
}

const GRAU_COLORS: Record<string, string> = {
  ALTO: 'bg-red-100 text-red-800 border border-red-200',
  MEDIO: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
  BAIXO: 'bg-green-100 text-green-800 border border-green-200',
}

type ComparativoItem = {
  regime: string
  totalTributos: string
  cargaEfetiva: string
  diferençaVsRecomendado: string
}

type RiscoItem = {
  regime: string
  descricao: string
  grau: 'ALTO' | 'MEDIO' | 'BAIXO'
}

type ResultadoPlanejamento = {
  cnpj: string
  razaoSocial: string
  exercicio: number
  receitaProjetadaAnual: string
  regimeAtual: string
  regimeRecomendado: string
  economiaEstimadaVsAtual: string
  economiaEstimadaVsMaior: string
  riscos: RiscoItem[]
  comparativo: ComparativoItem[]
  prazoMudancaRegime: string
  observacoes: string[]
}

export default function PlanejamentoTributarioPage() {
  const anoAtual = new Date().getFullYear()
  const [empresaId, setEmpresaId] = useState('')
  const [exercicio, setExercicio] = useState(String(anoAtual))
  const [receitaProjetada, setReceitaProjetada] = useState('')
  const [folhaProjetada, setFolhaProjetada] = useState('')
  const [lucroProjetado, setLucroProjetado] = useState('')

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const mutation = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/planejamento-tributario/${empresaId}`, {
          exercicio: Number(exercicio),
          ...(receitaProjetada ? { receitaProjetadaAnual: receitaProjetada } : {}),
          ...(folhaProjetada ? { folhaProjetadaAnual: folhaProjetada } : {}),
          ...(lucroProjetado ? { lucroProjetadoAnual: lucroProjetado } : {}),
        })
        .then((r) => r.data as ResultadoPlanejamento),
  })

  const r = mutation.data

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Planejamento Tributário</h1>
        <p className="mt-1 text-sm text-gray-500">
          Análise comparativa de regimes fiscais com recomendação para o próximo exercício.
        </p>
      </div>

      {/* Formulário */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-800">Projeções</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <label className="mb-1 block text-sm font-medium text-gray-700">Exercício</label>
            <input
              type="number"
              value={exercicio}
              onChange={(e) => setExercicio(e.target.value)}
              min="2020"
              max="2040"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Receita Projetada Anual (R$)
            </label>
            <input
              type="number"
              value={receitaProjetada}
              onChange={(e) => setReceitaProjetada(e.target.value)}
              placeholder="ex: 500000"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0"
              step="1000"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Folha de Pagamento Anual (R$)
            </label>
            <input
              type="number"
              value={folhaProjetada}
              onChange={(e) => setFolhaProjetada(e.target.value)}
              placeholder="ex: 120000"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0"
              step="1000"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Lucro Projetado Anual (R$)
            </label>
            <input
              type="number"
              value={lucroProjetado}
              onChange={(e) => setLucroProjetado(e.target.value)}
              placeholder="Padrão: 10% da receita"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0"
              step="1000"
            />
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !empresaId || !exercicio}
            className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Analisando…' : 'Gerar Planejamento'}
          </button>
        </div>
        {mutation.isError && (
          <p className="mt-2 text-sm text-red-600">Erro ao gerar. Verifique os dados.</p>
        )}
      </div>

      {r && (
        <>
          {/* Recomendação principal */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                  Regime Recomendado para {r.exercicio}
                </p>
                <p className="mt-1 text-2xl font-bold text-blue-900">
                  {REGIME_LABELS[r.regimeRecomendado] ?? r.regimeRecomendado}
                </p>
                <p className="text-sm text-blue-700">
                  Prazo para formalizar mudança: <strong>{r.prazoMudancaRegime}</strong>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-blue-600">Economia vs regime atual</p>
                <p className="text-xl font-bold text-green-700">
                  {formatBRL(r.economiaEstimadaVsAtual)}
                </p>
                <p className="text-xs text-blue-500">
                  Economia total possível: {formatBRL(r.economiaEstimadaVsMaior)}
                </p>
              </div>
            </div>
          </div>

          {/* Comparativo */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800">Comparativo de Regimes</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Regime</th>
                  <th className="px-4 py-2 text-right">Total Tributos</th>
                  <th className="px-4 py-2 text-right">Carga Efetiva</th>
                  <th className="px-4 py-2 text-right">Diferença vs Recomendado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.comparativo.map((c) => (
                  <tr
                    key={c.regime}
                    className={`hover:bg-gray-50 ${c.regime === r.regimeRecomendado ? 'bg-green-50' : ''}`}
                  >
                    <td className="px-4 py-2 font-medium text-gray-900">
                      {REGIME_LABELS[c.regime] ?? c.regime}
                      {c.regime === r.regimeRecomendado && (
                        <span className="ml-2 rounded bg-green-600 px-1.5 py-0.5 text-xs text-white">
                          Recomendado
                        </span>
                      )}
                      {c.regime === r.regimeAtual && c.regime !== r.regimeRecomendado && (
                        <span className="ml-2 rounded bg-gray-400 px-1.5 py-0.5 text-xs text-white">
                          Atual
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">{formatBRL(c.totalTributos)}</td>
                    <td className="px-4 py-2 text-right">{formatPct(c.cargaEfetiva)}</td>
                    <td
                      className={`px-4 py-2 text-right font-semibold ${parseFloat(c.diferençaVsRecomendado) > 0 ? 'text-red-600' : 'text-gray-500'}`}
                    >
                      {parseFloat(c.diferençaVsRecomendado) > 0
                        ? `+${formatBRL(c.diferençaVsRecomendado)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Riscos */}
          {r.riscos.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-800">Riscos Identificados</h2>
              </div>
              <div className="divide-y divide-gray-100">
                {r.riscos.map((risco, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${GRAU_COLORS[risco.grau]}`}
                    >
                      {risco.grau}
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-gray-600">
                        {REGIME_LABELS[risco.regime] ?? risco.regime}
                      </p>
                      <p className="text-sm text-gray-700">{risco.descricao}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Observações */}
          {r.observacoes.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
              <h2 className="mb-2 text-sm font-semibold text-yellow-800">Observações</h2>
              <ul className="space-y-1">
                {r.observacoes.map((obs, i) => (
                  <li key={i} className="text-sm text-yellow-700">
                    • {obs}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
