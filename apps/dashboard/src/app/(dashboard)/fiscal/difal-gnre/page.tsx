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

type ItemGNRE = {
  uf: string
  tipo: string
  codReceita: string
  valorTotal: string
  vencimento?: string
}

type ResultadoDifal = {
  cnpj: string
  razaoSocial: string
  competencia: string
  totalDIFAL: string
  documentos: number
}

type ResultadoGNRE = ItemGNRE[]

export default function DifalGNREPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [difal, setDifal] = useState<ResultadoDifal | null>(null)
  const [gnre, setGNRE] = useState<ResultadoGNRE | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const calcularDifal = useMutation({
    mutationFn: () =>
      api.post(`/fiscal/difal/${empresaId}/${competencia}`).then((r) => r.data as ResultadoDifal),
    onSuccess: (data) => setDifal(data),
  })

  const gerarGNRE = useMutation({
    mutationFn: () =>
      api.post(`/fiscal/gnre/${empresaId}/${competencia}`).then((r) => r.data as ResultadoGNRE),
    onSuccess: (data) => setGNRE(data),
  })

  const totalGNRE = (gnre ?? []).reduce((s, g) => s + Number(g.valorTotal), 0)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">DIFAL / GNRE</h1>
        <p className="mt-1 text-sm text-gray-500">
          Diferencial de Alíquota (DIFAL) e Guia Nacional de Recolhimento de Tributos Estaduais
          (GNRE) para operações interestaduais.
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
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
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
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={() => calcularDifal.mutate()}
              disabled={calcularDifal.isPending || !empresaId}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {calcularDifal.isPending ? 'Calculando…' : 'Calcular DIFAL'}
            </button>
            <button
              onClick={() => gerarGNRE.mutate()}
              disabled={gerarGNRE.isPending || !empresaId}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {gerarGNRE.isPending ? 'Gerando…' : 'Gerar GNRE'}
            </button>
          </div>
        </div>
      </div>

      {/* Info box */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        <p className="font-semibold">Sobre DIFAL e GNRE</p>
        <p className="mt-1">
          DIFAL: diferença entre alíquota interna do estado destinatário e a alíquota interestadual,
          pago pelo remetente nas vendas para consumidor final não contribuinte. Calculado apenas de
          NF-e com <code>status = CONCILIADO</code>.
        </p>
        <p className="mt-1">
          GNRE: guia de recolhimento gerada por UF de destino com código de receita 10008-0.
        </p>
      </div>

      {difal && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-800">Resultado DIFAL</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-gray-500">Empresa</p>
              <p className="font-medium text-gray-900">{difal.razaoSocial}</p>
              <p className="text-xs text-gray-400">CNPJ: {difal.cnpj}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Documentos com DIFAL</p>
              <p className="text-2xl font-bold text-gray-900">{difal.documentos}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total DIFAL</p>
              <p className="text-2xl font-bold text-blue-700">{fmt(difal.totalDIFAL)}</p>
            </div>
          </div>
        </div>
      )}

      {gnre && gnre.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-800">
              GNREs Geradas — {gnre.length} guia(s)
            </h2>
            <span className="text-sm font-bold text-indigo-700">Total: {fmt(totalGNRE)}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">UF</th>
                <th className="px-4 py-2 text-left">Tipo</th>
                <th className="px-4 py-2 text-left">Código Receita</th>
                <th className="px-4 py-2 text-right">Valor</th>
                <th className="px-4 py-2 text-center">Vencimento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {gnre.map((item, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-bold text-gray-900">{item.uf}</td>
                  <td className="px-4 py-2 text-gray-600">{item.tipo}</td>
                  <td className="px-4 py-2 font-mono text-gray-600">{item.codReceita}</td>
                  <td className="px-4 py-2 text-right font-medium text-indigo-700">
                    {fmt(item.valorTotal)}
                  </td>
                  <td className="px-4 py-2 text-center text-xs text-gray-500">
                    {item.vencimento ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gnre && gnre.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-400">
          Nenhuma GNRE gerada para o período selecionado.
        </div>
      )}
    </div>
  )
}
