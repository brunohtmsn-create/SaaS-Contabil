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

type ItemDCTF = {
  codigoReceita: string
  descricao: string
  valorDebito: string
  valorCredito: string
  valorLiquido: string
}

type ResultadoDCTFMensal = {
  cnpj: string
  competencia: string
  regime: string
  itens: ItemDCTF[]
  totalDebitos: string
  totalCreditos: string
  saldoDevedor: string
  prazoEntrega: string
}

export default function DCTFMensalPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [resultado, setResultado] = useState<ResultadoDCTFMensal | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const gerar = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/dctf-mensal/${empresaId}/${competencia}`)
        .then((r) => r.data as ResultadoDCTFMensal),
    onSuccess: (data) => setResultado(data),
  })

  const consultar = useMutation({
    mutationFn: () =>
      api.get(`/fiscal/dctf-mensal/${empresaId}/${competencia}`).then((r) => r.data as any),
    onSuccess: (data) => {
      if (data?.dados) setResultado(data.dados)
    },
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">DCTF Mensal</h1>
        <p className="mt-1 text-sm text-gray-500">
          Declaração de Débitos e Créditos Tributários Federais — obrigatória para empresas do Lucro
          Presumido e Lucro Real. Agrega PIS, COFINS e estimativas mensais de IRPJ/CSLL.
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
              onClick={() => gerar.mutate()}
              disabled={gerar.isPending || !empresaId}
              className="flex-1 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {gerar.isPending ? 'Gerando…' : 'Gerar DCTF'}
            </button>
            <button
              onClick={() => consultar.mutate()}
              disabled={consultar.isPending || !empresaId}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Consultar
            </button>
          </div>
        </div>
        {gerar.isError && (
          <p className="mt-2 text-sm text-red-600">
            Erro ao gerar. Verifique se a empresa é Lucro Presumido ou Lucro Real e se as apurações
            PIS/COFINS estão disponíveis.
          </p>
        )}
      </div>

      {/* Info */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        <p className="font-semibold">DCTF Mensal vs DCTFWeb</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>
            <strong>DCTF Mensal:</strong> LP/LR — PIS, COFINS, IRPJ/CSLL estimativa
          </li>
          <li>
            <strong>DCTFWeb:</strong> Simples Nacional — gerada após EFD-Reinf + eSocial
          </li>
          <li>Prazo DCTF Mensal: 15º dia útil do 2º mês seguinte à competência</li>
        </ul>
      </div>

      {resultado && (
        <>
          {/* Cabeçalho */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">CNPJ: {resultado.cnpj}</p>
                <p className="text-sm text-gray-500">
                  Competência: {resultado.competencia} · Regime: {resultado.regime}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400">Prazo de entrega</p>
                <p className="font-medium text-gray-700">{resultado.prazoEntrega}</p>
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

          {/* Itens da DCTF */}
          {resultado.itens.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-800">Itens da Declaração</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Código</th>
                    <th className="px-4 py-2 text-left">Tributo</th>
                    <th className="px-4 py-2 text-right">Débito</th>
                    <th className="px-4 py-2 text-right">Crédito</th>
                    <th className="px-4 py-2 text-right">Líquido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {resultado.itens.map((item) => (
                    <tr key={item.codigoReceita} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-gray-700">{item.codigoReceita}</td>
                      <td className="px-4 py-2 text-gray-800">{item.descricao}</td>
                      <td className="px-4 py-2 text-right text-red-600">{fmt(item.valorDebito)}</td>
                      <td className="px-4 py-2 text-right text-green-600">
                        {fmt(item.valorCredito)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-semibold ${Number(item.valorLiquido) > 0 ? 'text-red-700' : 'text-gray-500'}`}
                      >
                        {fmt(item.valorLiquido)}
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
