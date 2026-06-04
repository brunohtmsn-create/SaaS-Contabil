'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

function competenciaAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function DeSTDAPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [conteudo, setConteudo] = useState<string | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const gerar = useMutation({
    mutationFn: () =>
      api.post(`/fiscal/destda/${empresaId}/${competencia}`).then((r) => r.data as string),
    onSuccess: (data) => setConteudo(data),
  })

  const consultar = useMutation({
    mutationFn: () =>
      api.get(`/fiscal/destda/${empresaId}/${competencia}`).then((r) => r.data as any),
    onSuccess: (data) => {
      if (data?.dados?.content) setConteudo(data.dados.content)
    },
  })

  function baixarArquivo() {
    if (!conteudo) return
    const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `DeSTDA-${competencia.replace('-', '')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const linhas = conteudo ? conteudo.split('\r\n').filter(Boolean) : []

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">DeSTDA</h1>
        <p className="mt-1 text-sm text-gray-500">
          Declaração de Substituição Tributária, Diferencial de Alíquota e Antecipação — obrigatória
          para empresas do Simples Nacional com operações interestaduais (DIFAL e ICMS-ST).
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
              {gerar.isPending ? 'Gerando…' : 'Gerar DeSTDA'}
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
        {(gerar.isError || consultar.isError) && (
          <p className="mt-2 text-sm text-red-600">
            Erro ao processar. Verifique se há apuração DIFAL para a competência.
          </p>
        )}
      </div>

      {/* Info */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        <p className="font-semibold">Pré-requisitos</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>Empresa do Simples Nacional com operações interestaduais</li>
          <li>DIFAL apurado para a competência (NF-e com status CONCILIADO)</li>
          <li>Vencimento: dia 28 do mês seguinte ao da competência</li>
        </ul>
      </div>

      {conteudo && (
        <>
          {/* Resumo de registros */}
          <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-4">
            <div>
              <p className="font-semibold text-green-800">DeSTDA gerado</p>
              <p className="text-sm text-green-700">
                {linhas.length} registro(s) · Competência {competencia}
              </p>
            </div>
            <button
              onClick={baixarArquivo}
              className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
            >
              Baixar .txt
            </button>
          </div>

          {/* Preview do arquivo SPED */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-800">Conteúdo do Arquivo</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left w-12">#</th>
                    <th className="px-4 py-2 text-left">Registro</th>
                    <th className="px-4 py-2 text-left">Conteúdo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {linhas.map((linha, i) => {
                    const partes = linha.split('|').filter((_, idx) => idx > 0)
                    const registro = partes[0] ?? ''
                    const resto = partes.slice(1).join(' | ')
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-1.5 text-gray-400">{i + 1}</td>
                        <td className="px-4 py-1.5 font-bold text-blue-700">{registro}</td>
                        <td className="px-4 py-1.5 text-gray-600">{resto}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
