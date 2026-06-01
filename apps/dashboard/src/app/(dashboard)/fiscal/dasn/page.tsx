'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import { FileText, RefreshCw, CheckCircle, AlertCircle, Clock } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReceitaMensal {
  competencia: string
  receita: string
  pgdasCalculado: boolean
}

interface ResultadoDasn {
  cnpj: string
  ano: number
  receitaMensal: ReceitaMensal[]
  receitaAnualTotal: string
  mesesComPGDAS: number
  mesesCompletos: boolean
  obrigacaoId: string | null
  vencimento: string
}

interface Empresa {
  id: string
  cnpj: string
  razaoSocial: string
  regime: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MESES_PT = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
]

function BRL(value: string | number) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR')
}

const anoAtual = new Date().getFullYear()
const ANOS_DISPONIVEIS = Array.from({ length: 5 }, (_, i) => anoAtual - i)

// ─── Component ────────────────────────────────────────────────────────────────

export default function DasnPage() {
  const [empresaSelecionada, setEmpresaSelecionada] = useState<string>('')
  const [anoSelecionado, setAnoSelecionado] = useState<number>(anoAtual - 1)
  const qc = useQueryClient()

  const { data: empresas, isLoading: loadingEmpresas } = useQuery<Empresa[]>({
    queryKey: ['empresas-sn'],
    queryFn: () =>
      api.get('/empresas?regime=SIMPLES_NACIONAL').then((r) => r.data.empresas ?? r.data),
  })

  const {
    data: dasn,
    isLoading: loadingDasn,
    error: errorDasn,
  } = useQuery<ResultadoDasn>({
    queryKey: ['dasn', empresaSelecionada, anoSelecionado],
    queryFn: () =>
      api
        .get(`/fiscal/dasn/${empresaSelecionada}/${anoSelecionado}`)
        .then((r) => r.data)
        .catch(() => null),
    enabled: !!empresaSelecionada,
  })

  const gerarMutation = useMutation({
    mutationFn: () =>
      api.post(`/fiscal/dasn/${empresaSelecionada}/${anoSelecionado}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dasn', empresaSelecionada, anoSelecionado] })
    },
  })

  const snEmpresas = empresas?.filter(
    (e) => e.regime === 'SIMPLES_NACIONAL' || e.regime === 'MEI'
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">DASN / DEFIS</h1>
        <p className="text-sm text-slate-500 mt-1">
          Declaração Anual do Simples Nacional — vence em 31/03 do ano seguinte
        </p>
      </div>

      {/* Seleção empresa + ano */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Empresa</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={empresaSelecionada}
              onChange={(e) => setEmpresaSelecionada(e.target.value)}
              disabled={loadingEmpresas}
            >
              <option value="">Selecionar empresa…</option>
              {snEmpresas?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.razaoSocial} — {e.cnpj}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Ano-base</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={anoSelecionado}
              onChange={(e) => setAnoSelecionado(Number(e.target.value))}
            >
              {ANOS_DISPONIVEIS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <button
            onClick={() => gerarMutation.mutate()}
            disabled={!empresaSelecionada || gerarMutation.isPending}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {gerarMutation.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            {dasn ? 'Regenerar DASN' : 'Gerar DASN'}
          </button>
        </div>

        {gerarMutation.isError && (
          <p className="mt-3 text-sm text-red-600">
            Erro ao gerar DASN. Verifique se todos os meses possuem PGDAS calculado.
          </p>
        )}
      </div>

      {/* Resultado */}
      {loadingDasn && empresaSelecionada && (
        <div className="text-center py-12 text-slate-400">Carregando…</div>
      )}

      {dasn && (
        <>
          {/* Status geral */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">
                  DASN {dasn.ano} — {dasn.cnpj}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Vencimento: {formatDate(dasn.vencimento)}
                </p>
              </div>
              <div>
                {dasn.mesesCompletos ? (
                  <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 text-sm font-medium px-3 py-1 rounded-full">
                    <CheckCircle className="w-4 h-4" />
                    Completo (12/12 meses)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 bg-yellow-50 text-yellow-700 text-sm font-medium px-3 py-1 rounded-full">
                    <Clock className="w-4 h-4" />
                    Incompleto ({dasn.mesesComPGDAS}/12 meses)
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Receita Bruta Anual</p>
                <p className="text-xl font-bold text-slate-900 mt-0.5">
                  {BRL(dasn.receitaAnualTotal)}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Meses com PGDAS</p>
                <p className="text-xl font-bold text-slate-900 mt-0.5">
                  {dasn.mesesComPGDAS}
                  <span className="text-sm font-normal text-slate-500"> / 12</span>
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">Obrigação ID</p>
                <p className="text-sm font-mono text-slate-700 mt-0.5 truncate">
                  {dasn.obrigacaoId ?? '—'}
                </p>
              </div>
            </div>
          </div>

          {/* Receita mensal */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-800">Receita por Mês</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3">Mês</th>
                    <th className="text-right px-4 py-3">Receita Bruta</th>
                    <th className="text-center px-4 py-3">PGDAS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dasn.receitaMensal.map((m, idx) => (
                    <tr key={m.competencia} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-700">
                        {MESES_PT[idx]} / {dasn.ano}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{BRL(m.receita)}</td>
                      <td className="px-4 py-3 text-center">
                        {m.pgdasCalculado ? (
                          <CheckCircle className="w-4 h-4 text-green-500 inline" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-yellow-400 inline" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold">
                  <tr>
                    <td className="px-4 py-3 text-slate-700">Total</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                      {BRL(dasn.receitaAnualTotal)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {!dasn && !loadingDasn && empresaSelecionada && !errorDasn && (
        <div className="text-center py-12 text-slate-400">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>DASN não gerada para {anoSelecionado}. Clique em &quot;Gerar DASN&quot;.</p>
        </div>
      )}
    </div>
  )
}
