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

type ResultadoEstimativa = {
  cnpj: string
  razaoSocial: string
  competencia: string
  atividadePrincipal: string
  receitaBruta: string
  baseIRPJEstimada: string
  baseCSLLEstimada: string
  irpjEstimativa: string
  csllEstimativa: string
  totalEstimativa: string
  adicionalIRPJ: string
  darfVencimento?: string
}

const ATIVIDADES = [
  { value: 'comercio', label: 'Comércio (8%)' },
  { value: 'industria', label: 'Indústria (8%)' },
  { value: 'servicos', label: 'Serviços em Geral (32%)' },
  { value: 'construcao', label: 'Construção Civil (8%)' },
  { value: 'transporte', label: 'Transporte de Cargas (8%)' },
  { value: 'transporte_passageiros', label: 'Transporte de Passageiros (16%)' },
  { value: 'financeiro', label: 'Atividades Financeiras (16%)' },
]

export default function IrpjEstimativaLRPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [atividade, setAtividade] = useState('servicos')
  const [resultado, setResultado] = useState<ResultadoEstimativa | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const calcular = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/irpj-csll-lr-estimativa/${empresaId}/${competencia}`, {
          atividadePrincipal: atividade,
        })
        .then((r) => r.data as ResultadoEstimativa),
    onSuccess: (data) => setResultado(data),
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">IRPJ/CSLL — Estimativa Mensal LR</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cálculo do IRPJ e CSLL por estimativa mensal no Lucro Real — alternativa ao balanço de
          suspensão/redução.
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
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Atividade Principal
            </label>
            <select
              value={atividade}
              onChange={(e) => setAtividade(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {ATIVIDADES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={() => calcular.mutate()}
            disabled={calcular.isPending || !empresaId}
            className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {calcular.isPending ? 'Calculando…' : 'Calcular Estimativa'}
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        <p className="font-semibold">Estimativa vs Balanço de Suspensão</p>
        <p className="mt-1">
          A estimativa usa percentuais de presunção sobre a receita bruta do mês (como LP). Já o
          balanço de suspensão usa o lucro real apurado — pode suspender ou reduzir pagamentos se o
          imposto acumulado for menor que as estimativas pagas.
        </p>
      </div>

      {resultado && (
        <>
          <div
            className={`rounded-lg border p-4 shadow-sm ${resultado.darfVencimento ? 'border-gray-200 bg-white' : 'border-gray-200 bg-white'}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">{resultado.razaoSocial}</p>
                <p className="text-sm text-gray-500">
                  {resultado.competencia} · {resultado.atividadePrincipal}
                </p>
              </div>
              {resultado.darfVencimento && (
                <p className="text-sm text-gray-500">Vencimento: {resultado.darfVencimento}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Receita Bruta do Período</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{fmt(resultado.receitaBruta)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Base IRPJ Estimada</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {fmt(resultado.baseIRPJEstimada)}
              </p>
            </div>
            <div className="rounded-lg border border-red-100 bg-red-50 p-4 shadow-sm">
              <p className="text-xs text-red-600">IRPJ (15%)</p>
              <p className="mt-1 text-2xl font-bold text-red-700">
                {fmt(resultado.irpjEstimativa)}
              </p>
              {Number(resultado.adicionalIRPJ) > 0 && (
                <p className="text-xs text-red-500">
                  + Adicional 10%: {fmt(resultado.adicionalIRPJ)}
                </p>
              )}
            </div>
            <div className="rounded-lg border border-orange-100 bg-orange-50 p-4 shadow-sm">
              <p className="text-xs text-orange-600">CSLL (9%)</p>
              <p className="mt-1 text-2xl font-bold text-orange-700">
                {fmt(resultado.csllEstimativa)}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-blue-800">Total IRPJ + CSLL (estimativa)</p>
              <p className="text-2xl font-bold text-blue-700">{fmt(resultado.totalEstimativa)}</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
