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

type LinhaLivro = {
  data: string
  tipo: string
  numero: string
  cnpjContraparte: string
  nomeContraparte: string
  cfop: string
  valorTotal: string
  valorIcms: string
  valorIss: string
  valorPis: string
  valorCofins: string
  valorIrrf: string
  status: string
}

type TotaisLivro = {
  valorTotal: string
  valorIcms: string
  valorIss: string
  valorPis: string
  valorCofins: string
}

type LivroFiscal = {
  competencia: string
  cnpj: string
  entradas: LinhaLivro[]
  saidas: LinhaLivro[]
  servicos: LinhaLivro[]
  servicosTomados: LinhaLivro[]
  totaisEntradas: TotaisLivro
  totaisSaidas: TotaisLivro
  totalServicosEmitidos: string
  totalServicosTomados: string
}

type Aba = 'entradas' | 'saidas' | 'servicos' | 'servicosTomados'

const ABA_LABELS: Record<Aba, string> = {
  entradas: 'Entradas (NF-e)',
  saidas: 'Saídas (NF-e)',
  servicos: 'Serviços Emitidos',
  servicosTomados: 'Serviços Tomados',
}

function dataFormatada(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleDateString('pt-BR')
  } catch {
    return isoStr
  }
}

function TabelaLivro({ linhas, label }: { linhas: LinhaLivro[]; label: string }) {
  if (linhas.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-400">
        Nenhum documento em {label.toLowerCase()} para o período.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left">Data</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Número</th>
              <th className="px-3 py-2 text-left">Contraparte</th>
              <th className="px-3 py-2 text-left">CFOP</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">ICMS</th>
              <th className="px-3 py-2 text-right">ISS</th>
              <th className="px-3 py-2 text-right">PIS</th>
              <th className="px-3 py-2 text-right">COFINS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map((linha, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-xs text-gray-500">{dataFormatada(linha.data)}</td>
                <td className="px-3 py-2">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-600">
                    {linha.tipo}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-600">{linha.numero}</td>
                <td className="px-3 py-2">
                  <div className="max-w-[160px] truncate">
                    <p className="text-xs font-medium text-gray-800">{linha.nomeContraparte}</p>
                    <p className="font-mono text-xs text-gray-400">{linha.cnpjContraparte}</p>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500">{linha.cfop || '—'}</td>
                <td className="px-3 py-2 text-right font-medium text-gray-800">
                  {fmt(linha.valorTotal)}
                </td>
                <td className="px-3 py-2 text-right text-gray-600">{fmt(linha.valorIcms)}</td>
                <td className="px-3 py-2 text-right text-gray-600">{fmt(linha.valorIss)}</td>
                <td className="px-3 py-2 text-right text-gray-600">{fmt(linha.valorPis)}</td>
                <td className="px-3 py-2 text-right text-gray-600">{fmt(linha.valorCofins)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function LivroFiscalPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [livro, setLivro] = useState<LivroFiscal | null>(null)
  const [aba, setAba] = useState<Aba>('entradas')

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const gerar = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/livro-fiscal/${empresaId}/${competencia}`)
        .then((r) => r.data as LivroFiscal),
    onSuccess: (data) => {
      setLivro(data)
      setAba('entradas')
    },
  })

  const { data: livroSalvo } = useQuery({
    queryKey: ['livro-fiscal', empresaId, competencia],
    queryFn: () =>
      empresaId
        ? api
            .get(`/fiscal/livro-fiscal/${empresaId}/${competencia}`)
            .then((r) => (r.data?.dados ?? null) as LivroFiscal | null)
            .catch(() => null)
        : null,
    enabled: !!empresaId,
  })

  const exibir = livro ?? livroSalvo

  const totalGeral = exibir
    ? Number(exibir.totaisEntradas.valorTotal) +
      Number(exibir.totaisSaidas.valorTotal) +
      Number(exibir.totalServicosEmitidos) +
      Number(exibir.totalServicosTomados)
    : 0

  const linhasPorAba: Record<Aba, LinhaLivro[]> = exibir
    ? {
        entradas: exibir.entradas,
        saidas: exibir.saidas,
        servicos: exibir.servicos,
        servicosTomados: exibir.servicosTomados,
      }
    : { entradas: [], saidas: [], servicos: [], servicosTomados: [] }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Livro Fiscal</h1>
        <p className="mt-1 text-sm text-gray-500">
          Relatório consolidado de entradas, saídas, serviços emitidos e tomados do período.
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
                setLivro(null)
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
              onClick={() => gerar.mutate()}
              disabled={gerar.isPending || !empresaId}
              className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {gerar.isPending ? 'Gerando…' : 'Gerar Livro Fiscal'}
            </button>
          </div>
        </div>
        {gerar.isError && (
          <p className="mt-3 text-sm text-red-600">Erro ao gerar o livro fiscal.</p>
        )}
      </div>

      {exibir && (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Total Entradas</p>
              <p className="text-xl font-bold text-gray-900">
                {fmt(exibir.totaisEntradas.valorTotal)}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">{exibir.entradas.length} doc(s)</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Total Saídas</p>
              <p className="text-xl font-bold text-blue-700">
                {fmt(exibir.totaisSaidas.valorTotal)}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">{exibir.saidas.length} doc(s)</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Serviços Emitidos</p>
              <p className="text-xl font-bold text-green-700">
                {fmt(exibir.totalServicosEmitidos)}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">{exibir.servicos.length} NFS-e</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Serviços Tomados</p>
              <p className="text-xl font-bold text-purple-700">
                {fmt(exibir.totalServicosTomados)}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">{exibir.servicosTomados.length} NFS-e</p>
            </div>
          </div>

          {/* Totais por imposto */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">
                Impostos — Entradas
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">ICMS:</span>{' '}
                  <span className="font-medium">{fmt(exibir.totaisEntradas.valorIcms)}</span>
                </div>
                <div>
                  <span className="text-gray-500">ISS:</span>{' '}
                  <span className="font-medium">{fmt(exibir.totaisEntradas.valorIss)}</span>
                </div>
                <div>
                  <span className="text-gray-500">PIS:</span>{' '}
                  <span className="font-medium">{fmt(exibir.totaisEntradas.valorPis)}</span>
                </div>
                <div>
                  <span className="text-gray-500">COFINS:</span>{' '}
                  <span className="font-medium">{fmt(exibir.totaisEntradas.valorCofins)}</span>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">
                Impostos — Saídas
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">ICMS:</span>{' '}
                  <span className="font-medium">{fmt(exibir.totaisSaidas.valorIcms)}</span>
                </div>
                <div>
                  <span className="text-gray-500">ISS:</span>{' '}
                  <span className="font-medium">{fmt(exibir.totaisSaidas.valorIss)}</span>
                </div>
                <div>
                  <span className="text-gray-500">PIS:</span>{' '}
                  <span className="font-medium">{fmt(exibir.totaisSaidas.valorPis)}</span>
                </div>
                <div>
                  <span className="text-gray-500">COFINS:</span>{' '}
                  <span className="font-medium">{fmt(exibir.totaisSaidas.valorCofins)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Abas */}
          <div>
            <div className="flex gap-1 border-b border-gray-200">
              {(Object.keys(ABA_LABELS) as Aba[]).map((a) => (
                <button
                  key={a}
                  onClick={() => setAba(a)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    aba === a
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {ABA_LABELS[a]}{' '}
                  <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                    {linhasPorAba[a].length}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-4">
              <TabelaLivro linhas={linhasPorAba[aba]} label={ABA_LABELS[aba]} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
