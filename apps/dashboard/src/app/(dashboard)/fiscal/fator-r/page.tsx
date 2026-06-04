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

const fmtPct = (v: string | number) => `${(Number(v) * 100).toFixed(2)}%`

type ResultadoFatorR = {
  cnpj: string
  razaoSocial: string
  competencia: string
  folha12meses: string
  receita12meses: string
  fatorR: string
  anexo: 'III' | 'V'
  aliquotaAnexoIII: string
  aliquotaAnexoV: string
  economiaAnexoIII: string
  recomendacao: string
}

export default function FatorRPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [resultado, setResultado] = useState<ResultadoFatorR | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const calcular = useMutation({
    mutationFn: () =>
      api.get(`/fiscal/fator-r/${empresaId}/${competencia}`).then((r) => r.data as ResultadoFatorR),
    onSuccess: (data) => setResultado(data),
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Fator R — Simples Nacional</h1>
        <p className="mt-1 text-sm text-gray-500">
          Calcula o Fator R (folha/receita) para determinar o enquadramento no Anexo III ou V do
          Simples Nacional. Fator R ≥ 28% → Anexo III (menor carga).
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
              onClick={() => calcular.mutate()}
              disabled={calcular.isPending || !empresaId}
              className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {calcular.isPending ? 'Calculando…' : 'Calcular Fator R'}
            </button>
          </div>
        </div>
        {calcular.isError && <p className="mt-2 text-sm text-red-600">Erro ao calcular Fator R.</p>}
      </div>

      {/* Explicação */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        <p className="font-semibold">Como funciona o Fator R?</p>
        <p className="mt-1">
          Fator R = (Folha de Pagamento dos últimos 12 meses) ÷ (Receita Bruta dos últimos 12 meses)
        </p>
        <ul className="mt-2 space-y-0.5 list-disc list-inside">
          <li>
            <strong>Fator R ≥ 28%</strong>: empresa usa o <strong>Anexo III</strong> (alíquotas
            menores para serviços)
          </li>
          <li>
            <strong>Fator R &lt; 28%</strong>: empresa usa o <strong>Anexo V</strong> (alíquotas
            maiores para serviços)
          </li>
        </ul>
      </div>

      {resultado && (
        <>
          {/* Resultado principal */}
          <div
            className={`rounded-lg border p-6 shadow-sm ${resultado.anexo === 'III' ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p
                  className={`text-sm font-semibold ${resultado.anexo === 'III' ? 'text-green-800' : 'text-yellow-800'}`}
                >
                  {resultado.razaoSocial}
                </p>
                <p
                  className={`text-xs ${resultado.anexo === 'III' ? 'text-green-600' : 'text-yellow-600'}`}
                >
                  CNPJ: {resultado.cnpj} · {resultado.competencia}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={`text-5xl font-bold ${resultado.anexo === 'III' ? 'text-green-700' : 'text-yellow-700'}`}
                >
                  {fmtPct(resultado.fatorR)}
                </p>
                <p
                  className={`text-sm font-semibold ${resultado.anexo === 'III' ? 'text-green-700' : 'text-yellow-700'}`}
                >
                  Fator R → <span className="text-lg">Anexo {resultado.anexo}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Cards de dados */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Folha de Pagamento (12 meses)</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{fmt(resultado.folha12meses)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Receita Bruta (12 meses)</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {fmt(resultado.receita12meses)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Alíquota Anexo III (atual)</p>
              <p className="mt-1 text-2xl font-bold text-green-600">
                {fmtPct(resultado.aliquotaAnexoIII)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Alíquota Anexo V (alternativa)</p>
              <p className="mt-1 text-2xl font-bold text-yellow-600">
                {fmtPct(resultado.aliquotaAnexoV)}
              </p>
            </div>
          </div>

          {/* Economia e recomendação */}
          {Number(resultado.economiaAnexoIII) > 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-semibold text-green-800">
                Economia com Anexo III: {fmt(resultado.economiaAnexoIII)}/mês
              </p>
              <p className="mt-1 text-sm text-green-700">{resultado.recomendacao}</p>
            </div>
          )}

          {resultado.anexo === 'V' && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
              <p className="text-sm font-semibold text-yellow-800">Atenção: Anexo V em uso</p>
              <p className="mt-1 text-sm text-yellow-700">{resultado.recomendacao}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
