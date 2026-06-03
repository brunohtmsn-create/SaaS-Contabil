'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

function formatBRL(val: string | number | undefined): string {
  if (val === undefined || val === null) return 'R$ 0,00'
  const n = typeof val === 'string' ? parseFloat(val) : val
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function competenciaAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type AjusteItem = { descricao: string; valor: string }

type ResultadoLALUR = {
  cnpj: string
  competencia: string
  lucroLiquidoAntesCSTLL: string
  totalAdicoes: string
  totalExclusoes: string
  totalCompensacoes: string
  lucroReal: string
  baseCSLL: string
  limiteCompensacao: string
  saldoPrejuizosRemanescentes: string
  adicoes: AjusteItem[]
  exclusoes: AjusteItem[]
  compensacoes: Array<{
    competenciaOrigem: string
    valorDisponivel: string
    valorUtilizado: string
  }>
}

export default function LALURPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [lucroLiquido, setLucroLiquido] = useState('')
  const [adicoes, setAdicoes] = useState<AjusteItem[]>([])
  const [exclusoes, setExclusoes] = useState<AjusteItem[]>([])

  const { data: empresas } = useQuery({
    queryKey: ['empresas-lr'],
    queryFn: () =>
      api.get('/empresas', { params: { regime: 'LUCRO_REAL' } }).then((r) => r.data as any[]),
  })

  const mutation = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/lalur/${empresaId}/${competencia}`, {
          lucroLiquido,
          adicoes: adicoes.filter((a) => a.descricao && a.valor),
          exclusoes: exclusoes.filter((e) => e.descricao && e.valor),
        })
        .then((r) => r.data as ResultadoLALUR),
  })

  function addItem(list: AjusteItem[], set: (v: AjusteItem[]) => void) {
    set([...list, { descricao: '', valor: '' }])
  }

  function updateItem(
    list: AjusteItem[],
    set: (v: AjusteItem[]) => void,
    idx: number,
    field: keyof AjusteItem,
    value: string
  ) {
    const next = list.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    set(next)
  }

  function removeItem(list: AjusteItem[], set: (v: AjusteItem[]) => void, idx: number) {
    set(list.filter((_, i) => i !== idx))
  }

  const r = mutation.data

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">LALUR — Apuração do Lucro Real</h1>
        <p className="mt-1 text-sm text-gray-500">
          Livro de Apuração do Lucro Real. Registre adições, exclusões e compensações de prejuízos.
        </p>
      </div>

      {/* Formulário */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-800">Dados</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Empresa</label>
            <select
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
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
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Lucro Líquido (R$)
            </label>
            <input
              type="number"
              value={lucroLiquido}
              onChange={(e) => setLucroLiquido(e.target.value)}
              placeholder="0"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              step="0.01"
            />
          </div>
        </div>

        {/* Adições */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Adições</h3>
            <button
              onClick={() => addItem(adicoes, setAdicoes)}
              className="text-xs text-blue-600 hover:underline"
            >
              + Adicionar linha
            </button>
          </div>
          {adicoes.map((item, idx) => (
            <div key={idx} className="mb-2 flex gap-2">
              <input
                type="text"
                value={item.descricao}
                onChange={(e) => updateItem(adicoes, setAdicoes, idx, 'descricao', e.target.value)}
                placeholder="Descrição"
                className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="number"
                value={item.valor}
                onChange={(e) => updateItem(adicoes, setAdicoes, idx, 'valor', e.target.value)}
                placeholder="Valor"
                className="w-32 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                step="0.01"
                min="0"
              />
              <button
                onClick={() => removeItem(adicoes, setAdicoes, idx)}
                className="text-red-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Exclusões */}
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Exclusões</h3>
            <button
              onClick={() => addItem(exclusoes, setExclusoes)}
              className="text-xs text-blue-600 hover:underline"
            >
              + Adicionar linha
            </button>
          </div>
          {exclusoes.map((item, idx) => (
            <div key={idx} className="mb-2 flex gap-2">
              <input
                type="text"
                value={item.descricao}
                onChange={(e) =>
                  updateItem(exclusoes, setExclusoes, idx, 'descricao', e.target.value)
                }
                placeholder="Descrição"
                className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="number"
                value={item.valor}
                onChange={(e) => updateItem(exclusoes, setExclusoes, idx, 'valor', e.target.value)}
                placeholder="Valor"
                className="w-32 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                step="0.01"
                min="0"
              />
              <button
                onClick={() => removeItem(exclusoes, setExclusoes, idx)}
                className="text-red-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !empresaId || !lucroLiquido}
            className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Calculando…' : 'Apurar LALUR'}
          </button>
        </div>
        {mutation.isError && (
          <p className="mt-2 text-sm text-red-600">Erro ao apurar. Verifique os dados.</p>
        )}
      </div>

      {/* Resultado */}
      {r && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Lucro Líquido', value: r.lucroLiquidoAntesCSTLL },
              { label: 'Total Adições', value: r.totalAdicoes },
              { label: 'Total Exclusões', value: r.totalExclusoes },
              { label: 'Total Compensações', value: r.totalCompensacoes },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs text-gray-500">{label}</p>
                <p className="mt-1 text-lg font-bold text-gray-900">{formatBRL(value)}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs text-blue-600">Lucro Real</p>
              <p className="mt-1 text-2xl font-bold text-blue-800">{formatBRL(r.lucroReal)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs text-gray-500">Base CSLL</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{formatBRL(r.baseCSLL)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs text-gray-500">Saldo Prejuízos Remanescentes</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {formatBRL(r.saldoPrejuizosRemanescentes)}
              </p>
            </div>
          </div>

          {r.compensacoes.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-800">
                  Compensações de Prejuízos Utilizadas
                </h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Competência Origem</th>
                    <th className="px-4 py-2 text-right">Disponível</th>
                    <th className="px-4 py-2 text-right">Utilizado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {r.compensacoes.map((c, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">{c.competenciaOrigem}</td>
                      <td className="px-4 py-2 text-right">{formatBRL(c.valorDisponivel)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-green-700">
                        {formatBRL(c.valorUtilizado)}
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
