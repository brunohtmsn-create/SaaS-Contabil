'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatBRL } from '@saas-contabil/shared'

type Apuracao = {
  id: string
  empresaId: string
  competencia: string
  tipo: string
  status: string
  dados: Record<string, unknown>
  empresa?: { cnpj: string; razaoSocial: string }
}

export default function RelatoriosPage() {
  const [competencia, setCompetencia] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const { data: apuracoes = [], isLoading } = useQuery<Apuracao[]>({
    queryKey: ['apuracoes-consolidadas', competencia],
    queryFn: () => api.get(`/fiscal/apuracoes?competencia=${competencia}`).then((r) => r.data),
  })

  const gerarRelatorio = useMutation({
    mutationFn: () => api.post(`/relatorios/consolidado/${competencia}`).then((r) => r.data),
  })

  const pgdasApuracoes = apuracoes.filter((a) => a.tipo === 'PGDAS')
  const totalDAS = pgdasApuracoes.reduce((acc, a) => {
    const dados = a.dados as any
    return acc + Number(dados?.valorDAS ?? 0)
  }, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
          <p className="text-gray-500 text-sm mt-1">Consolidado mensal de apurações</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={() => gerarRelatorio.mutate()}
            disabled={gerarRelatorio.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {gerarRelatorio.isPending ? 'Gerando...' : 'Exportar CSV'}
          </button>
        </div>
      </div>

      {/* KPIs do mês */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Empresas apuradas</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{pgdasApuracoes.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total DAS — {competencia}</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalDAS)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Apurações totais</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{apuracoes.length}</p>
          <p className="text-xs text-gray-400 mt-1">PGDAS + DIFAL + EFD-Reinf</p>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">PGDAS — {competencia}</h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Carregando...</div>
        ) : pgdasApuracoes.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            Nenhuma apuração encontrada para {competencia}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Empresa</th>
                <th className="px-4 py-3 text-right">Receita Bruta</th>
                <th className="px-4 py-3 text-right">RB 12 Meses</th>
                <th className="px-4 py-3 text-right">Alíquota Efetiva</th>
                <th className="px-4 py-3 text-right">Valor DAS</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pgdasApuracoes.map((ap) => {
                const d = ap.dados as any
                return (
                  <tr key={ap.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{d?.cnpj ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(d?.receitaBrutaTotal ?? 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(d?.receitaBruta12Meses ?? 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {Number(d?.aliquotaEfetiva ?? 0).toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-blue-600">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(d?.valorDAS ?? 0))}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        ap.status === 'TRANSMITIDO' ? 'bg-green-100 text-green-700' :
                        ap.status === 'CALCULADO' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {ap.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold">
              <tr>
                <td className="px-4 py-3 text-gray-700">Total</td>
                <td colSpan={3} />
                <td className="px-4 py-3 text-right text-blue-700">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalDAS)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}
