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

type PrejuizoAcumulado = {
  competencia: string
  prejuizoIRPJ: string
  prejuizoCSLL: string
  utilizadoIRPJ: string
  utilizadoCSLL: string
  saldoIRPJ: string
  saldoCSLL: string
}

type ResultadoCompensacao = {
  cnpj: string
  razaoSocial: string
  competencia: string
  lucroRealDoPeriodo: string
  baseCSLLdoPeriodo: string
  compensacaoIRPJ: string
  compensacaoCSLL: string
  saldoLucroRealAposCompensacao: string
  saldoBaseCSLLAposCompensacao: string
  prejuizosAcumulados: PrejuizoAcumulado[]
  saldoPrejuizoIRPJ: string
  saldoPrejuizoCSLL: string
}

export default function PrejuizosFiscaisLRPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [tab, setTab] = useState<'registrar' | 'compensar'>('compensar')
  const [prejuizoIRPJ, setPrejuizoIRPJ] = useState('')
  const [prejuizoCSLL, setPrejuizoCSLL] = useState('')
  const [lucroReal, setLucroReal] = useState('')
  const [baseCSLL, setBaseCSLL] = useState('')
  const [resultado, setResultado] = useState<ResultadoCompensacao | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const registrar = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/prejuizos-fiscais-lr/${empresaId}/${competencia}`, {
          prejuizoIRPJ: Number(prejuizoIRPJ),
          prejuizoCSLL: Number(prejuizoCSLL),
        })
        .then((r) => r.data),
    onSuccess: () => {
      alert('Prejuízo registrado com sucesso!')
    },
  })

  const compensar = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/prejuizos-fiscais-lr/${empresaId}/${competencia}/compensar`, {
          lucroRealDoPeriodo: Number(lucroReal),
          baseCSLLdoPeriodo: Number(baseCSLL),
        })
        .then((r) => r.data as ResultadoCompensacao),
    onSuccess: (data) => setResultado(data),
  })

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Prejuízos Fiscais — Lucro Real</h1>
        <p className="mt-1 text-sm text-gray-500">
          Registro e compensação de prejuízos fiscais (IRPJ) e base negativa (CSLL) com limite de
          30% do lucro real do período.
        </p>
      </div>

      {/* Seleção */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setTab('compensar')}
          className={`px-6 py-2.5 text-sm font-medium transition-colors ${tab === 'compensar' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Compensar Prejuízo
        </button>
        <button
          onClick={() => setTab('registrar')}
          className={`px-6 py-2.5 text-sm font-medium transition-colors ${tab === 'registrar' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Registrar Prejuízo
        </button>
      </div>

      {tab === 'compensar' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-800">
            Compensar Prejuízo no Período
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Lucro Real do Período (R$)
              </label>
              <input
                type="number"
                value={lucroReal}
                onChange={(e) => setLucroReal(e.target.value)}
                placeholder="500000.00"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Base CSLL do Período (R$)
              </label>
              <input
                type="number"
                value={baseCSLL}
                onChange={(e) => setBaseCSLL(e.target.value)}
                placeholder="500000.00"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <button
            onClick={() => compensar.mutate()}
            disabled={compensar.isPending || !empresaId || !lucroReal}
            className="mt-4 rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {compensar.isPending ? 'Calculando…' : 'Calcular Compensação'}
          </button>
        </div>
      )}

      {tab === 'registrar' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-800">
            Registrar Prejuízo do Período
          </h2>
          <div className="rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700 mb-4">
            Use quando a empresa apurou prejuízo neste período. O saldo será disponibilizado para
            compensação em períodos futuros (limite de 30%).
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Prejuízo IRPJ (R$)
              </label>
              <input
                type="number"
                value={prejuizoIRPJ}
                onChange={(e) => setPrejuizoIRPJ(e.target.value)}
                placeholder="100000.00"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Base Negativa CSLL (R$)
              </label>
              <input
                type="number"
                value={prejuizoCSLL}
                onChange={(e) => setPrejuizoCSLL(e.target.value)}
                placeholder="100000.00"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <button
            onClick={() => registrar.mutate()}
            disabled={registrar.isPending || !empresaId || !prejuizoIRPJ}
            className="mt-4 rounded bg-orange-500 px-6 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {registrar.isPending ? 'Registrando…' : 'Registrar Prejuízo'}
          </button>
        </div>
      )}

      {resultado && (
        <>
          {/* Resultado da compensação */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Compensação IRPJ</p>
              <p className="mt-1 text-xl font-bold text-green-700">
                {fmt(resultado.compensacaoIRPJ)}
              </p>
              <p className="text-xs text-gray-400">
                Saldo após: {fmt(resultado.saldoLucroRealAposCompensacao)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Compensação CSLL</p>
              <p className="mt-1 text-xl font-bold text-green-700">
                {fmt(resultado.compensacaoCSLL)}
              </p>
              <p className="text-xs text-gray-400">
                Saldo após: {fmt(resultado.saldoBaseCSLLAposCompensacao)}
              </p>
            </div>
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 shadow-sm">
              <p className="text-xs text-orange-600">Saldo Restante — Prejuízo IRPJ</p>
              <p className="mt-1 text-xl font-bold text-orange-700">
                {fmt(resultado.saldoPrejuizoIRPJ)}
              </p>
            </div>
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 shadow-sm">
              <p className="text-xs text-orange-600">Saldo Restante — Base Negativa CSLL</p>
              <p className="mt-1 text-xl font-bold text-orange-700">
                {fmt(resultado.saldoPrejuizoCSLL)}
              </p>
            </div>
          </div>

          {/* Histórico de prejuízos */}
          {resultado.prejuizosAcumulados.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-800">
                  Histórico de Prejuízos — FIFO
                </h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Competência</th>
                    <th className="px-4 py-2 text-right">Prejuízo IRPJ</th>
                    <th className="px-4 py-2 text-right">Utilizado IRPJ</th>
                    <th className="px-4 py-2 text-right">Saldo IRPJ</th>
                    <th className="px-4 py-2 text-right">Prejuízo CSLL</th>
                    <th className="px-4 py-2 text-right">Saldo CSLL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {resultado.prejuizosAcumulados.map((p) => (
                    <tr key={p.competencia} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-gray-700">{p.competencia}</td>
                      <td className="px-4 py-2 text-right text-red-600">{fmt(p.prejuizoIRPJ)}</td>
                      <td className="px-4 py-2 text-right text-green-600">
                        {fmt(p.utilizadoIRPJ)}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">
                        {fmt(p.saldoIRPJ)}
                      </td>
                      <td className="px-4 py-2 text-right text-red-600">{fmt(p.prejuizoCSLL)}</td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">
                        {fmt(p.saldoCSLL)}
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
