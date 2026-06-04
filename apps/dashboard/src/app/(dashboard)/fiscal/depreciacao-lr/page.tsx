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

const fmtPct = (v: string | number) =>
  `${(Number(v) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`

type Categoria = {
  categoria: string
  vidaUtilAnos: number
  taxaAnual: string
}

type ItemDepreciacao = {
  bemId: string
  descricao: string
  categoria: string
  valorAquisicao: string
  valorContabil: string
  depreciacaoMensal: string
  depreciacaoAcumulada: string
  taxaMensal: string
  totalMeses: number
  mesesDecorridos: number
  mesesRestantes: number
  percentualDepreciado: string
  totalmenteDepreciado: boolean
}

type ResultadoDepreciacaoLR = {
  cnpj: string
  competencia: string
  totalBens: number
  totalValorAquisicao: string
  totalDepreciacaoMensal: string
  totalDepreciacaoAcumulada: string
  totalValorContabil: string
  itens: ItemDepreciacao[]
}

type BemForm = {
  id: string
  descricao: string
  categoria: string
  valorAquisicao: string
  dataAquisicao: string
  turnoTrabalho: 'simples' | 'duplo' | 'triplo'
  valorResidual: string
}

const TURNO_LABEL = {
  simples: '1 turno (normal)',
  duplo: '2 turnos (+50%)',
  triplo: '3 turnos (+100%)',
}

let proxId = 1

function novoBem(): BemForm {
  return {
    id: String(proxId++),
    descricao: '',
    categoria: 'maquinas_equipamentos',
    valorAquisicao: '',
    dataAquisicao: '',
    turnoTrabalho: 'simples',
    valorResidual: '0',
  }
}

export default function DepreciacaoLRPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [bens, setBens] = useState<BemForm[]>([novoBem()])
  const [resultado, setResultado] = useState<ResultadoDepreciacaoLR | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const { data: catData } = useQuery({
    queryKey: ['depreciacao-categorias'],
    queryFn: () =>
      api
        .get('/fiscal/depreciacao-lr/categorias')
        .then((r) => r.data as { categorias: Categoria[] }),
  })

  const categorias = catData?.categorias ?? []

  const calcular = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/depreciacao-lr/${empresaId}/${competencia}`, {
          bens: bens
            .filter((b) => b.descricao && b.valorAquisicao && b.dataAquisicao)
            .map((b) => ({
              id: b.id,
              descricao: b.descricao,
              categoria: b.categoria,
              valorAquisicao: b.valorAquisicao,
              dataAquisicao: b.dataAquisicao,
              turnoTrabalho: b.turnoTrabalho,
              valorResidual: b.valorResidual || '0',
            })),
        })
        .then((r) => r.data as ResultadoDepreciacaoLR),
    onSuccess: (data) => setResultado(data),
  })

  function addBem() {
    setBens((prev) => [...prev, novoBem()])
  }

  function removeBem(id: string) {
    setBens((prev) => prev.filter((b) => b.id !== id))
  }

  function updateBem(id: string, field: keyof BemForm, value: string) {
    setBens((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)))
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Depreciação — Lucro Real</h1>
        <p className="mt-1 text-sm text-gray-500">
          Controle de depreciação fiscal de bens do ativo imobilizado (método linear, IN SRF
          162/1998 / RIR/2018 art. 305–323). Dedutível na apuração do IRPJ/CSLL.
        </p>
      </div>

      {/* Seleção empresa / competência */}
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

      {/* Lista de bens */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-800">Bens do Ativo Imobilizado</h2>
          <button
            onClick={addBem}
            className="rounded bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
          >
            + Adicionar Bem
          </button>
        </div>

        <div className="divide-y divide-gray-100">
          {bens.map((bem, idx) => (
            <div key={bem.id} className="grid gap-3 p-4 sm:grid-cols-6">
              <div className="sm:col-span-2">
                {idx === 0 && (
                  <label className="mb-1 block text-xs font-medium text-gray-500">Descrição</label>
                )}
                <input
                  type="text"
                  value={bem.descricao}
                  onChange={(e) => updateBem(bem.id, 'descricao', e.target.value)}
                  placeholder="Ex: Servidor Dell R740"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div>
                {idx === 0 && (
                  <label className="mb-1 block text-xs font-medium text-gray-500">Categoria</label>
                )}
                <select
                  value={bem.categoria}
                  onChange={(e) => updateBem(bem.id, 'categoria', e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {categorias.map((c) => (
                    <option key={c.categoria} value={c.categoria}>
                      {c.categoria.replace(/_/g, ' ')} ({fmtPct(c.taxaAnual)} a.a.)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                {idx === 0 && (
                  <label className="mb-1 block text-xs font-medium text-gray-500">
                    Valor Aquisição (R$)
                  </label>
                )}
                <input
                  type="number"
                  value={bem.valorAquisicao}
                  onChange={(e) => updateBem(bem.id, 'valorAquisicao', e.target.value)}
                  placeholder="50000.00"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div>
                {idx === 0 && (
                  <label className="mb-1 block text-xs font-medium text-gray-500">
                    Data Aquisição
                  </label>
                )}
                <input
                  type="date"
                  value={bem.dataAquisicao}
                  onChange={(e) => updateBem(bem.id, 'dataAquisicao', e.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  {idx === 0 && (
                    <label className="mb-1 block text-xs font-medium text-gray-500">Turno</label>
                  )}
                  <select
                    value={bem.turnoTrabalho}
                    onChange={(e) => updateBem(bem.id, 'turnoTrabalho', e.target.value as any)}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    {Object.entries(TURNO_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                {bens.length > 1 && (
                  <button
                    onClick={() => removeBem(bem.id)}
                    className="mb-0.5 rounded px-2 py-1.5 text-xs text-red-500 hover:bg-red-50"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 px-4 py-3">
          <button
            onClick={() => calcular.mutate()}
            disabled={calcular.isPending || !empresaId || bens.every((b) => !b.descricao)}
            className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {calcular.isPending ? 'Calculando…' : 'Calcular Depreciação'}
          </button>
          {calcular.isError && (
            <p className="mt-2 text-sm text-red-600">
              Erro ao calcular. Verifique se a empresa é Lucro Real.
            </p>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        <p className="font-semibold">Taxas anuais (IN SRF 162/1998)</p>
        <div className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-3 text-xs">
          <span>Edifícios: 4% a.a. (25 anos)</span>
          <span>Máquinas/Instalações: 10% a.a. (10 anos)</span>
          <span>Veículos/Computadores: 20% a.a. (5 anos)</span>
        </div>
      </div>

      {resultado && (
        <>
          {/* Totais */}
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Total Valor Aquisição</p>
              <p className="mt-1 text-xl font-bold text-gray-900">
                {fmt(resultado.totalValorAquisicao)}
              </p>
            </div>
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 shadow-sm">
              <p className="text-xs text-blue-600">Depreciação do Mês</p>
              <p className="mt-1 text-xl font-bold text-blue-700">
                {fmt(resultado.totalDepreciacaoMensal)}
              </p>
            </div>
            <div className="rounded-lg border border-orange-100 bg-orange-50 p-4 shadow-sm">
              <p className="text-xs text-orange-600">Depreciação Acumulada</p>
              <p className="mt-1 text-xl font-bold text-orange-700">
                {fmt(resultado.totalDepreciacaoAcumulada)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Valor Contábil Líquido</p>
              <p className="mt-1 text-xl font-bold text-gray-900">
                {fmt(resultado.totalValorContabil)}
              </p>
            </div>
          </div>

          {/* Tabela de itens */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800">
                Depreciação por Bem — {resultado.totalBens} item(ns)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Bem</th>
                    <th className="px-4 py-2 text-right">Valor Aquisição</th>
                    <th className="px-4 py-2 text-right">Deprec. Mensal</th>
                    <th className="px-4 py-2 text-right">Deprec. Acumulada</th>
                    <th className="px-4 py-2 text-right">Valor Contábil</th>
                    <th className="px-4 py-2 text-center">Progresso</th>
                    <th className="px-4 py-2 text-center">Meses Rest.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {resultado.itens.map((item) => (
                    <tr
                      key={item.bemId}
                      className={`hover:bg-gray-50 ${item.totalmenteDepreciado ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-2">
                        <p className="font-medium text-gray-900">{item.descricao}</p>
                        <p className="text-xs text-gray-400">{item.categoria}</p>
                      </td>
                      <td className="px-4 py-2 text-right text-gray-700">
                        {fmt(item.valorAquisicao)}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-blue-600">
                        {fmt(item.depreciacaoMensal)}
                      </td>
                      <td className="px-4 py-2 text-right text-orange-600">
                        {fmt(item.depreciacaoAcumulada)}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">
                        {fmt(item.valorContabil)}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="mx-auto w-24">
                          <div className="h-1.5 rounded-full bg-gray-200">
                            <div
                              className="h-1.5 rounded-full bg-blue-500"
                              style={{
                                width: `${Math.min(100, Number(item.percentualDepreciado) * 100).toFixed(0)}%`,
                              }}
                            />
                          </div>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {(Number(item.percentualDepreciado) * 100).toFixed(1)}%
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-center text-xs text-gray-500">
                        {item.totalmenteDepreciado ? (
                          <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-400">
                            Encerrado
                          </span>
                        ) : (
                          item.mesesRestantes
                        )}
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
