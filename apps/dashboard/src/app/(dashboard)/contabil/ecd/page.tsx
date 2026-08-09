'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

type ResultadoECD = {
  cnpj: string
  ano: number
  totalLancamentos: number
  blocos: string[]
  conteudo: string
}

export default function ECDPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [ano, setAno] = useState(new Date().getFullYear() - 1)
  const [resultado, setResultado] = useState<ResultadoECD | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const empresasLPLR = (empresas ?? []).filter(
    (e: any) => e.regime === 'LUCRO_PRESUMIDO' || e.regime === 'LUCRO_REAL'
  )

  const gerar = useMutation({
    mutationFn: () =>
      api.post(`/contabil/ecd/${empresaId}/${ano}`).then((r) => r.data as ResultadoECD),
    onSuccess: (data) => setResultado(data),
  })

  const linhasSPED = resultado?.conteudo
    ? resultado.conteudo.split('\r\n').filter(Boolean).slice(0, 50)
    : []

  function downloadSPED() {
    if (!resultado?.conteudo) return
    const blob = new Blob([resultado.conteudo], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ECD_${resultado.cnpj.replace(/\D/g, '')}_${resultado.ano}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ECD — Escrituração Contábil Digital</h1>
        <p className="mt-1 text-sm text-gray-500">
          Obrigação anual para empresas do Lucro Presumido e Lucro Real. Transmite ao SPED o livro
          Diário, Razão e Balancetes. Prazo: 31 de maio do ano seguinte ao exercício.
        </p>
      </div>

      {/* Seleção */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Empresa (LP / LR)
            </label>
            <select
              value={empresaId}
              onChange={(e) => {
                setEmpresaId(e.target.value)
                setResultado(null)
              }}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="">Selecione…</option>
              {empresasLPLR.map((emp: any) => (
                <option key={emp.id} value={emp.id}>
                  {emp.razaoSocial} — {emp.regime === 'LUCRO_PRESUMIDO' ? 'LP' : 'LR'}
                </option>
              ))}
            </select>
            {empresas && empresasLPLR.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">Nenhuma empresa LP ou LR cadastrada.</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Ano-Exercício</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAno((a) => a - 1)}
                className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
              >
                ‹
              </button>
              <span className="flex-1 rounded border border-gray-300 px-3 py-2 text-center text-sm font-semibold text-gray-700">
                {ano}
              </span>
              <button
                onClick={() => setAno((a) => a + 1)}
                className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
              >
                ›
              </button>
            </div>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => gerar.mutate()}
              disabled={gerar.isPending || !empresaId}
              className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {gerar.isPending ? 'Gerando…' : 'Gerar ECD'}
            </button>
          </div>
        </div>
        {gerar.isError && (
          <p className="mt-2 text-sm text-red-600">
            {(gerar.error as any)?.response?.data?.error ??
              'Erro ao gerar ECD. Verifique se todos os lançamentos estão conciliados com o bancário.'}
          </p>
        )}
      </div>

      {/* Aviso obrigatoriedade */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-semibold">Pré-requisito obrigatório</p>
        <p className="mt-1">
          A ECD só pode ser gerada após{' '}
          <strong>
            todos os lançamentos contábeis do exercício estarem conciliados com o extrato bancário
          </strong>
          . Acesse <strong>Contábil → Conciliação Bancária</strong> para verificar o status antes de
          gerar.
        </p>
      </div>

      {resultado && (
        <>
          {/* Cabeçalho resumo */}
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-green-800">
                  ECD {resultado.ano} gerada com sucesso
                </p>
                <p className="text-sm text-green-700">CNPJ: {resultado.cnpj}</p>
              </div>
              <button
                onClick={downloadSPED}
                className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
              >
                Baixar arquivo .txt
              </button>
            </div>
          </div>

          {/* Cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Total Lançamentos</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {resultado.totalLancamentos.toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Blocos SPED</p>
              <p className="mt-1 text-2xl font-bold text-blue-700">{resultado.blocos.length}</p>
              <p className="text-xs text-gray-400">{resultado.blocos.join(', ')}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Prazo Entrega</p>
              <p className="mt-1 text-lg font-bold text-gray-900">31/05/{resultado.ano + 1}</p>
              <p className="text-xs text-gray-400">Via transmissão SPED</p>
            </div>
          </div>

          {/* Preview do arquivo SPED */}
          {linhasSPED.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-800">
                  Preview do arquivo SPED (primeiras {linhasSPED.length} linhas)
                </h2>
                <span className="text-xs text-gray-400">
                  {resultado.conteudo.split('\r\n').filter(Boolean).length} linhas no total
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="w-12 px-3 py-2 text-right text-gray-400">#</th>
                      <th className="px-3 py-2 text-left text-gray-500">Registro</th>
                      <th className="px-3 py-2 text-left text-gray-500">Conteúdo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 font-mono">
                    {linhasSPED.map((linha, i) => {
                      const partes = linha.split('|').filter((_, idx) => idx > 0)
                      const registro = partes[0] ?? ''
                      const resto = partes.slice(1).join(' | ')
                      return (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-3 py-1 text-right text-gray-300">{i + 1}</td>
                          <td className="px-3 py-1 font-semibold text-blue-700">{registro}</td>
                          <td className="max-w-0 truncate px-3 py-1 text-gray-600">{resto}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
