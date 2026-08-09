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
  `${(Number(v) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

type MunicipioISS = {
  municipioIBGE: string
  totalServicos: string
  aliquotaISS: string
  totalISS: string
  nfseIds: string[]
}

type ResultadoDMS = {
  competencia: string
  cnpj: string
  totalNFSe: number
  totalServicos: string
  totalISS: string
  porMunicipio: MunicipioISS[]
}

export default function DMSPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [resultado, setResultado] = useState<ResultadoDMS | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const apurar = useMutation({
    mutationFn: () =>
      api.post(`/fiscal/dms/${empresaId}/${competencia}`).then((r) => r.data as ResultadoDMS),
    onSuccess: (data) => setResultado(data),
  })

  const consultar = useMutation({
    mutationFn: () =>
      api.get(`/fiscal/dms/${empresaId}/${competencia}`).then((r) => r.data as ResultadoDMS),
    onSuccess: (data) => setResultado(data),
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">DMS — Declaração Mensal de Serviços</h1>
        <p className="mt-1 text-sm text-gray-500">
          Declaração de ISS sobre NFS-e emitidas. Apura o ISS por município tomador e registra a
          obrigação mensal. Para Simples Nacional, o ISS compõe o DAS, mas muitos municípios exigem
          entrega independente da DMS.
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
              onClick={() => apurar.mutate()}
              disabled={apurar.isPending || !empresaId}
              className="flex-1 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {apurar.isPending ? 'Apurando…' : 'Apurar DMS'}
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
        {(apurar.isError || consultar.isError) && (
          <p className="mt-2 text-sm text-red-600">
            Erro ao processar. Verifique se há NFS-e emitidas e conciliadas no período.
          </p>
        )}
      </div>

      {/* Info */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        <p className="font-semibold">Regra de apuração</p>
        <p className="mt-1">
          Somente NFS-e com <strong>status CONCILIADO</strong> são incluídas. O ISS é calculado pela
          alíquota municipal (padrão 2% quando não configurada). A declaração é agrupada por
          município IBGE do prestador de serviço.
        </p>
      </div>

      {resultado && (
        <>
          {/* Cards de totais */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Total NFS-e</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{resultado.totalNFSe}</p>
              <p className="text-xs text-gray-400">documentos conciliados</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Total Serviços</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {fmt(resultado.totalServicos)}
              </p>
            </div>
            <div className="rounded-lg border border-orange-100 bg-orange-50 p-4 shadow-sm">
              <p className="text-xs text-orange-600">Total ISS</p>
              <p className="mt-1 text-2xl font-bold text-orange-700">{fmt(resultado.totalISS)}</p>
            </div>
          </div>

          {resultado.totalNFSe === 0 ? (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-700">
              Nenhuma NFS-e conciliada encontrada neste período. Verifique se a conciliação foi
              concluída antes de gerar a DMS.
            </div>
          ) : (
            /* Tabela por município */
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-800">
                  ISS por Município — {resultado.porMunicipio.length} município(s)
                </h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Município IBGE</th>
                    <th className="px-4 py-2 text-right">NFS-e</th>
                    <th className="px-4 py-2 text-right">Total Serviços</th>
                    <th className="px-4 py-2 text-center">Alíquota ISS</th>
                    <th className="px-4 py-2 text-right">Total ISS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {resultado.porMunicipio.map((m) => (
                    <tr key={m.municipioIBGE} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-gray-800">{m.municipioIBGE}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{m.nfseIds.length}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{fmt(m.totalServicos)}</td>
                      <td className="px-4 py-2 text-center text-gray-600">
                        {fmtPct(m.aliquotaISS)}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-orange-700">
                        {fmt(m.totalISS)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                  <tr>
                    <td className="px-4 py-2 font-semibold text-gray-800" colSpan={2}>
                      Total
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-800">
                      {fmt(resultado.totalServicos)}
                    </td>
                    <td />
                    <td className="px-4 py-2 text-right font-bold text-orange-700">
                      {fmt(resultado.totalISS)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
