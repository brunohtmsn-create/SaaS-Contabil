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

type ResultadoDCTFWeb = {
  cnpj: string
  razaoSocial: string
  competencia: string
  totalDebitos: string
  totalCreditos: string
  saldoDevedor: string
  status: string
  recibo?: string
  vencimento?: string
  darf?: { codigoReceita: string; valor: string; vencimento: string }[]
}

const STATUS_BADGE: Record<string, string> = {
  TRANSMITIDA: 'bg-green-100 text-green-800',
  PENDENTE: 'bg-yellow-100 text-yellow-800',
  ERRO: 'bg-red-100 text-red-800',
  GERADA: 'bg-blue-100 text-blue-800',
}

export default function DCTFWebPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [resultado, setResultado] = useState<ResultadoDCTFWeb | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const gerar = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/dctfweb/${empresaId}/${competencia}`)
        .then((r) => r.data as ResultadoDCTFWeb),
    onSuccess: (data) => setResultado(data),
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">DCTFWeb</h1>
        <p className="mt-1 text-sm text-gray-500">
          Declaração de Débitos e Créditos Tributários Federais — gerada após fechamento do
          EFD-Reinf e eSocial.
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
          <div className="flex items-end">
            <button
              onClick={() => gerar.mutate()}
              disabled={gerar.isPending || !empresaId}
              className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {gerar.isPending ? 'Gerando…' : 'Gerar DCTFWeb'}
            </button>
          </div>
        </div>
        {gerar.isError && (
          <p className="mt-2 text-sm text-red-600">
            Erro ao gerar DCTFWeb. Verifique se o EFD-Reinf e eSocial estão fechados.
          </p>
        )}
      </div>

      {/* Info */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        <p className="font-semibold">Pré-requisitos</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>EFD-Reinf fechado (R-2099 enviado)</li>
          <li>eSocial fechado (S-1299 enviado) — somente se tiver empregados</li>
          <li>Vencimento: até o dia 15 do mês seguinte</li>
        </ul>
      </div>

      {resultado && (
        <>
          {/* Cabeçalho */}
          <div
            className={`rounded-lg border p-4 shadow-sm ${resultado.saldoDevedor === '0' ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">{resultado.razaoSocial}</p>
                <p className="text-sm text-gray-500">
                  CNPJ: {resultado.cnpj} · {resultado.competencia}
                </p>
                {resultado.recibo && (
                  <p className="mt-1 text-xs text-green-600">Recibo: {resultado.recibo}</p>
                )}
              </div>
              <div className="text-right">
                <span
                  className={`rounded px-3 py-1 text-sm font-semibold ${STATUS_BADGE[resultado.status] ?? STATUS_BADGE['PENDENTE']}`}
                >
                  {resultado.status}
                </span>
                {resultado.vencimento && (
                  <p className="mt-1 text-xs text-gray-500">Vencimento: {resultado.vencimento}</p>
                )}
              </div>
            </div>
          </div>

          {/* Totais */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Total Débitos</p>
              <p className="mt-1 text-2xl font-bold text-red-600">{fmt(resultado.totalDebitos)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Total Créditos</p>
              <p className="mt-1 text-2xl font-bold text-green-600">
                {fmt(resultado.totalCreditos)}
              </p>
            </div>
            <div
              className={`rounded-lg border p-4 shadow-sm ${Number(resultado.saldoDevedor) > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}
            >
              <p
                className={`text-xs ${Number(resultado.saldoDevedor) > 0 ? 'text-red-500' : 'text-green-600'}`}
              >
                Saldo Devedor
              </p>
              <p
                className={`mt-1 text-2xl font-bold ${Number(resultado.saldoDevedor) > 0 ? 'text-red-700' : 'text-green-700'}`}
              >
                {fmt(resultado.saldoDevedor)}
              </p>
            </div>
          </div>

          {/* DARFs */}
          {resultado.darf && resultado.darf.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-800">DARFs a Recolher</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Código Receita</th>
                    <th className="px-4 py-2 text-right">Valor</th>
                    <th className="px-4 py-2 text-center">Vencimento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {resultado.darf.map((d, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-gray-700">{d.codigoReceita}</td>
                      <td className="px-4 py-2 text-right font-semibold text-red-600">
                        {fmt(d.valor)}
                      </td>
                      <td className="px-4 py-2 text-center text-xs text-gray-500">
                        {d.vencimento}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
