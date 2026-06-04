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

type Funcionario = {
  id: string
  nome: string
  salarioBase: string
  adicional13?: string
  adicionaisVariaveis?: string
}

type ItemINSS = {
  funcionarioId: string
  nome: string
  baseCalculo: string
  cpp: string
  gilrat: string
  terceiros: string
  totalPatronal: string
}

type ResultadoINSS = {
  cnpj: string
  razaoSocial: string
  competencia: string
  funcionarios: ItemINSS[]
  totalCPP: string
  totalGILRAT: string
  totalTerceiros: string
  totalPatronal: string
  aliquotaEfetivaTotal: string
  folhaTotalBase: string
}

const GRAUS_RISCO = [
  { value: 'leve', label: 'Leve (1%)' },
  { value: 'medio', label: 'Médio (2%)' },
  { value: 'grave', label: 'Grave (3%)' },
]

const ATIVIDADES = [
  { value: 'comercio', label: 'Comércio (5,8%)' },
  { value: 'industria', label: 'Indústria (5,7%)' },
  { value: 'servicos', label: 'Serviços (5,1%)' },
  { value: 'outros', label: 'Outros (5,8%)' },
]

export default function INSSPatronalPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [grauRisco, setGrauRisco] = useState('leve')
  const [atividade, setAtividade] = useState('servicos')
  const [fap, setFap] = useState('1.0')
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([
    { id: '1', nome: '', salarioBase: '', adicional13: '', adicionaisVariaveis: '' },
  ])
  const [resultado, setResultado] = useState<ResultadoINSS | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const calcular = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/inss-patronal/${empresaId}/${competencia}`, {
          funcionarios: funcionarios
            .filter((f) => f.nome && f.salarioBase)
            .map((f) => ({
              id: f.id,
              nome: f.nome,
              salarioBase: Number(f.salarioBase),
              ...(f.adicional13 ? { adicional13: Number(f.adicional13) } : {}),
              ...(f.adicionaisVariaveis
                ? { adicionaisVariaveis: Number(f.adicionaisVariaveis) }
                : {}),
            })),
          grauRisco,
          fap: Number(fap),
          atividadeTerceiros: atividade,
        })
        .then((r) => r.data as ResultadoINSS),
    onSuccess: (data) => setResultado(data),
  })

  function addFuncionario() {
    setFuncionarios((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        nome: '',
        salarioBase: '',
        adicional13: '',
        adicionaisVariaveis: '',
      },
    ])
  }

  function removeFuncionario(id: string) {
    setFuncionarios((prev) => prev.filter((f) => f.id !== id))
  }

  function updateFuncionario(id: string, field: keyof Funcionario, value: string) {
    setFuncionarios((prev) => prev.map((f) => (f.id === id ? { ...f, [field]: value } : f)))
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">INSS Patronal</h1>
        <p className="mt-1 text-sm text-gray-500">
          Contribuição previdenciária do empregador — CPP 20% + GILRAT + Terceiros (Lei 8.212/1991).
        </p>
      </div>

      {/* Parâmetros */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-gray-800">Parâmetros</h2>
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
            <label className="mb-1 block text-sm font-medium text-gray-700">Grau de Risco</label>
            <select
              value={grauRisco}
              onChange={(e) => setGrauRisco(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {GRAUS_RISCO.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Atividade</label>
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
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">FAP</label>
            <input
              type="number"
              step="0.01"
              min="0.5"
              max="2.0"
              value={fap}
              onChange={(e) => setFap(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="1.00"
            />
            <p className="mt-1 text-xs text-gray-400">Fator Acidentário de Prevenção (0,5 a 2,0)</p>
          </div>
        </div>
      </div>

      {/* Funcionários */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-800">Funcionários</h2>
          <button
            onClick={addFuncionario}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
          >
            + Adicionar
          </button>
        </div>
        <div className="divide-y divide-gray-100">
          {funcionarios.map((f, idx) => (
            <div key={f.id} className="grid grid-cols-5 gap-3 px-4 py-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  #{idx + 1} Nome
                </label>
                <input
                  value={f.nome}
                  onChange={(e) => updateFuncionario(f.id, 'nome', e.target.value)}
                  placeholder="João da Silva"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Salário Base (R$)
                </label>
                <input
                  type="number"
                  value={f.salarioBase}
                  onChange={(e) => updateFuncionario(f.id, 'salarioBase', e.target.value)}
                  placeholder="3000.00"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">13° (R$)</label>
                <input
                  type="number"
                  value={f.adicional13}
                  onChange={(e) => updateFuncionario(f.id, 'adicional13', e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Variáveis (R$)
                </label>
                <input
                  type="number"
                  value={f.adicionaisVariaveis}
                  onChange={(e) => updateFuncionario(f.id, 'adicionaisVariaveis', e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex items-end">
                {funcionarios.length > 1 && (
                  <button
                    onClick={() => removeFuncionario(f.id)}
                    className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 px-4 py-3">
          <button
            onClick={() => calcular.mutate()}
            disabled={calcular.isPending || !empresaId}
            className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {calcular.isPending ? 'Calculando…' : 'Calcular INSS Patronal'}
          </button>
          {calcular.isError && (
            <p className="mt-2 text-sm text-red-600">Erro ao calcular. Verifique os dados.</p>
          )}
        </div>
      </div>

      {resultado && (
        <>
          {/* Resumo */}
          <div className="grid gap-4 sm:grid-cols-4">
            {[
              { label: 'Folha Base', value: fmt(resultado.folhaTotalBase) },
              { label: 'CPP (20%)', value: fmt(resultado.totalCPP) },
              { label: 'GILRAT + FAP', value: fmt(resultado.totalGILRAT) },
              { label: 'Terceiros', value: fmt(resultado.totalTerceiros) },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
              >
                <p className="text-xs text-gray-500">{card.label}</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-800">Total INSS Patronal</p>
                <p className="text-xs text-blue-600">
                  {resultado.razaoSocial} · {resultado.competencia}
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-blue-700">{fmt(resultado.totalPatronal)}</p>
                <p className="text-xs text-blue-500">
                  Alíquota efetiva: {fmtPct(resultado.aliquotaEfetivaTotal)}
                </p>
              </div>
            </div>
          </div>

          {/* Tabela por funcionário */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800">Detalhamento por Funcionário</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Funcionário</th>
                    <th className="px-4 py-2 text-right">Base de Cálculo</th>
                    <th className="px-4 py-2 text-right">CPP</th>
                    <th className="px-4 py-2 text-right">GILRAT</th>
                    <th className="px-4 py-2 text-right">Terceiros</th>
                    <th className="px-4 py-2 text-right font-bold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {resultado.funcionarios.map((item) => (
                    <tr key={item.funcionarioId} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{item.nome}</td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {fmt(item.baseCalculo)}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">{fmt(item.cpp)}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{fmt(item.gilrat)}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{fmt(item.terceiros)}</td>
                      <td className="px-4 py-2 text-right font-bold text-blue-700">
                        {fmt(item.totalPatronal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
