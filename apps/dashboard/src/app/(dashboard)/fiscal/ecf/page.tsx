'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  RefreshCw,
  CheckCircle,
  XCircle,
  Calendar,
  TrendingUp,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Empresa {
  id: string
  cnpj: string
  razaoSocial: string
  regime: string
}

interface TrimestralECF {
  trimestre: string
  receita: string
  baseIRPJ: string
  baseCSLL: string
  irpjNormal: string
  irpjAdicional: string
  irpjTotal: string
  csllTotal: string
  totalDevido: string
}

interface ResultadoECF {
  cnpj: string
  ano: number
  regime: string
  receitaBrutaAnual: string
  baseIRPJAnual: string
  baseCSLLAnual: string
  irpjAnual: string
  csllAnual: string
  totalDevidoAnual: string
  trimestres: TrimestralECF[]
  dataEntrega: string
  situacao: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMoeda(valor: string | number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    typeof valor === 'string' ? parseFloat(valor) : valor
  )
}

function formatData(data: string) {
  const [ano, mes, dia] = data.split('-')
  return `${dia}/${mes}/${ano}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FiscalECFPage() {
  const queryClient = useQueryClient()
  const [ano, setAno] = useState(new Date().getFullYear() - 1)
  const [empresaId, setEmpresaId] = useState('')
  const [resultado, setResultado] = useState<ResultadoECF | null>(null)

  const { data: empresas = [] } = useQuery<Empresa[]>({
    queryKey: ['empresas-ecf'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
    select: (data: Empresa[]) =>
      data.filter((e) => e.regime === 'LUCRO_PRESUMIDO' || e.regime === 'LUCRO_REAL'),
  })

  const gerarECF = useMutation({
    mutationFn: ({ id, a }: { id: string; a: number }) =>
      api.post(`/fiscal/ecf/${id}/${a}`).then((r) => r.data),
    onSuccess: (data) => {
      setResultado(data)
      queryClient.invalidateQueries({ queryKey: ['obrigacoes'] })
    },
  })

  const trimestresPorcentagem = resultado
    ? resultado.trimestres.map((t) => ({
        ...t,
        percentualAnual:
          parseFloat(resultado.receitaBrutaAnual) > 0
            ? ((parseFloat(t.receita) / parseFloat(resultado.receitaBrutaAnual)) * 100).toFixed(1)
            : '0',
      }))
    : []

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ECF — Escrituração Contábil Fiscal</h1>
          <p className="text-slate-500 mt-1">Declaração anual IRPJ + CSLL para LP / LR</p>
        </div>

        {/* Navegação de ano */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAno((a) => a - 1)}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600"
            aria-label="Ano anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="border border-slate-200 rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 min-w-[80px] text-center">
            {ano}
          </div>
          <button
            onClick={() => setAno((a) => a + 1)}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600"
            aria-label="Próximo ano"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Informativo prazo */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <Calendar className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-800">
          <strong>Prazo ECF {ano}:</strong> 31 de julho de {ano + 1}. A ECF consolida todos os
          trimestres de IRPJ e CSLL apurados durante o ano-calendário.
        </div>
      </div>

      {/* Seletor de empresa */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <label className="block text-sm font-medium text-slate-700 mb-2">Empresa LP / LR</label>
        <select
          value={empresaId}
          onChange={(e) => {
            setEmpresaId(e.target.value)
            setResultado(null)
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
          {/* Geração ECF */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">ECF {ano}</h2>
                <p className="text-sm text-slate-500">Consolidação anual dos 4 trimestres</p>
              </div>
              <button
                disabled={gerarECF.isPending}
                onClick={() => gerarECF.mutate({ id: empresaId, a: ano })}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {gerarECF.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
                Gerar ECF
              </button>
            </div>

            {gerarECF.isError && (
              <div className="flex items-center gap-2 text-red-600 text-sm mb-4">
                <XCircle className="w-4 h-4" />
                <span>
                  Erro:{' '}
                  {(gerarECF.error as any)?.response?.data?.error ?? 'Falha na geração da ECF'}
                </span>
              </div>
            )}

            {resultado && (
              <div className="space-y-6">
                {/* Status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-green-600 text-sm">
                    <CheckCircle className="w-4 h-4" />
                    <span>
                      ECF {resultado.ano} gerada — prazo{' '}
                      <strong>{formatData(resultado.dataEntrega)}</strong>
                    </span>
                  </div>
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full font-medium">
                    {resultado.situacao}
                  </span>
                </div>

                {/* Totais anuais */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Receita Anual</p>
                    <p className="text-lg font-semibold text-slate-900 mt-1">
                      {formatMoeda(resultado.receitaBrutaAnual)}
                    </p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Base IRPJ</p>
                    <p className="text-lg font-semibold text-blue-900 mt-1">
                      {formatMoeda(resultado.baseIRPJAnual)}
                    </p>
                  </div>
                  <div className="bg-indigo-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">IRPJ Anual</p>
                    <p className="text-lg font-semibold text-indigo-900 mt-1">
                      {formatMoeda(resultado.irpjAnual)}
                    </p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">CSLL Anual</p>
                    <p className="text-lg font-semibold text-purple-900 mt-1">
                      {formatMoeda(resultado.csllAnual)}
                    </p>
                  </div>
                </div>

                {/* Total devido */}
                <div className="border-t border-slate-200 pt-4 flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-700">
                    Total Devido (IRPJ + CSLL)
                  </span>
                  <span className="text-xl font-bold text-red-700">
                    {formatMoeda(resultado.totalDevidoAnual)}
                  </span>
                </div>

                {/* Detalhamento trimestral */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Detalhamento por Trimestre
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left py-2 pr-4 text-slate-500 font-medium">
                            Trimestre
                          </th>
                          <th className="text-right py-2 px-4 text-slate-500 font-medium">
                            Receita
                          </th>
                          <th className="text-right py-2 px-4 text-slate-500 font-medium">IRPJ</th>
                          <th className="text-right py-2 px-4 text-slate-500 font-medium">CSLL</th>
                          <th className="text-right py-2 pl-4 text-slate-500 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trimestresPorcentagem.map((t) => {
                          const temDados = parseFloat(t.receita) > 0
                          return (
                            <tr
                              key={t.trimestre}
                              className={`border-b border-slate-100 ${!temDados ? 'opacity-40' : ''}`}
                            >
                              <td className="py-2 pr-4 font-medium text-slate-800">
                                {t.trimestre}
                                {!temDados && (
                                  <span className="ml-2 text-xs text-slate-400">sem apuração</span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-right text-slate-700">
                                {formatMoeda(t.receita)}
                                {temDados && (
                                  <span className="text-xs text-slate-400 ml-1">
                                    ({t.percentualAnual}%)
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-right text-indigo-700">
                                {formatMoeda(t.irpjTotal)}
                              </td>
                              <td className="py-2 px-4 text-right text-purple-700">
                                {formatMoeda(t.csllTotal)}
                              </td>
                              <td className="py-2 pl-4 text-right font-semibold text-red-700">
                                {formatMoeda(t.totalDevido)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Informativo */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <strong>Atenção:</strong> A ECF exige que todos os trimestres do ano estejam apurados.
            Trimestres sem apuração de IRPJ/CSLL aparecerão com valores zerados. Acesse{' '}
            <strong>Fiscal → LP/LR</strong> para apurar cada trimestre antes de gerar a ECF.
          </div>
        </>
      )}
    </div>
  )
}
