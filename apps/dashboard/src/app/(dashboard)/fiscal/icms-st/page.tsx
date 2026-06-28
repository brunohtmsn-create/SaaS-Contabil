'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

function competenciaAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const fmt = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const fmtPct = (v: string | number) => `${Number(v).toFixed(2)}%`

type ItemIcmsSt = {
  ufOrigem: string
  ufDestino: string
  cfop: string
  baseCalculo: string
  aliquotaInterna: string
  aliquotaInterestadual: string
  valorIcmsProprioRemetente: string
  valorIcmsSt: string
}

type ResultadoIcmsSt = {
  cnpj: string
  competencia: string
  totalBaseCalculo: string
  totalIcmsSt: string
  itens: ItemIcmsSt[]
}

export default function IcmsStPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [resultado, setResultado] = useState<ResultadoIcmsSt | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const calcular = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/icms-st/${empresaId}/${competencia}`)
        .then((r) => r.data as ResultadoIcmsSt),
    onSuccess: (data) => setResultado(data),
  })

  const { data: salvo, refetch } = useQuery({
    queryKey: ['icms-st', empresaId, competencia],
    queryFn: () =>
      empresaId
        ? api
            .get(`/fiscal/icms-st/${empresaId}/${competencia}`)
            .then((r) => (r.data?.dados ?? null) as ResultadoIcmsSt | null)
            .catch(() => null)
        : null,
    enabled: !!empresaId,
  })

  const exibir = resultado ?? salvo

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ICMS-ST — Substituição Tributária</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cálculo do ICMS por substituição tributária em operações interestaduais de entrada (comércio
          e indústria no Simples Nacional).
        </p>
      </div>

      {/* Seleção */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Empresa</label>
            <select
              value={empresaId}
              onChange={(e) => {
                setEmpresaId(e.target.value)
                setResultado(null)
              }}
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
              onClick={() => calcular.mutate()}
              disabled={calcular.isPending || !empresaId}
              className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {calcular.isPending ? 'Calculando…' : 'Calcular ICMS-ST'}
            </button>
          </div>
        </div>
        {calcular.isError && (
          <p className="mt-3 text-sm text-red-600">
            Erro ao calcular. Verifique se há NF-e de entrada interestaduais no período.
          </p>
        )}
      </div>

      {/* Info */}
      <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm text-amber-700">
        <p className="font-semibold">Sobre ICMS-ST</p>
        <p className="mt-1">
          Calculado sobre NF-e de entrada com CFOPs de ST (1.401–1.409, 2.401–2.409), operações
          interestaduais, usando a fórmula: Base ST = (Valor + IPI) × (1 + MVA) → ICMS-ST = Base ×
          Alíquota Interna − ICMS próprio do remetente. Gera obrigação GNRE-ST com vencimento no dia
          9 do mês seguinte.
        </p>
      </div>

      {exibir && (
        <>
          {/* Totais */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-800">
              Resultado — {exibir.competencia}
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-gray-500">CNPJ</p>
                <p className="font-mono text-sm font-medium text-gray-900">{exibir.cnpj}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Base de Cálculo Total</p>
                <p className="text-2xl font-bold text-gray-900">{fmt(exibir.totalBaseCalculo)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total ICMS-ST a Recolher</p>
                <p className="text-2xl font-bold text-amber-700">{fmt(exibir.totalIcmsSt)}</p>
              </div>
            </div>
          </div>

          {/* Tabela de itens */}
          {exibir.itens.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-800">
                  Documentos com ST — {exibir.itens.length} item(ns)
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">UF Orig.</th>
                      <th className="px-4 py-2 text-left">UF Dest.</th>
                      <th className="px-4 py-2 text-left">CFOP</th>
                      <th className="px-4 py-2 text-right">Base Cálc.</th>
                      <th className="px-4 py-2 text-right">Alíq. Interna</th>
                      <th className="px-4 py-2 text-right">Alíq. Interestad.</th>
                      <th className="px-4 py-2 text-right">ICMS Remetente</th>
                      <th className="px-4 py-2 text-right">ICMS-ST</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {exibir.itens.map((item, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-bold text-gray-900">{item.ufOrigem}</td>
                        <td className="px-4 py-2 text-gray-600">{item.ufDestino}</td>
                        <td className="px-4 py-2 font-mono text-gray-600">{item.cfop}</td>
                        <td className="px-4 py-2 text-right text-gray-700">
                          {fmt(item.baseCalculo)}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600">
                          {fmtPct(item.aliquotaInterna)}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600">
                          {fmtPct(item.aliquotaInterestadual)}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600">
                          {fmt(item.valorIcmsProprioRemetente)}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-amber-700">
                          {fmt(item.valorIcmsSt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-400">
              Nenhum documento com ICMS-ST encontrado para o período.
            </div>
          )}
        </>
      )}
    </div>
  )
}
