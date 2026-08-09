'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Apuracao = {
  id: string
  empresaId: string
  competencia: string
  tipo: string
  status: string
  dados: Record<string, unknown>
  empresa?: { cnpj: string; razaoSocial: string }
}

type HistoricoItem = {
  id: string
  competencia: string
  empresasCount: number
  geradoEm: string
  lido: boolean
}

type ObrigacaoVencendo = {
  id: string
  tipo: string
  competencia: string
  vencimento: string
  valor: string | null
  empresa: { razaoSocial: string; cnpj: string }
}

type ObrigacoesVencendoResponse = {
  periodo: { de: string; ate: string }
  total: number
  obrigacoes: ObrigacaoVencendo[]
}

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

const DIAS_OPTIONS = [
  { value: '3', label: '3 dias' },
  { value: '7', label: '7 dias' },
  { value: '15', label: '15 dias' },
  { value: '30', label: '30 dias' },
]

export default function RelatoriosPage() {
  const qc = useQueryClient()
  const [competencia, setCompetencia] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [baixando, setBaixando] = useState(false)
  const [diasVencendo, setDiasVencendo] = useState('7')

  const { data: apuracoes = [], isLoading } = useQuery<Apuracao[]>({
    queryKey: ['apuracoes-consolidadas', competencia],
    queryFn: () => api.get(`/fiscal/apuracoes?competencia=${competencia}`).then((r) => r.data),
  })

  const { data: historico = [] } = useQuery<HistoricoItem[]>({
    queryKey: ['relatorios-historico'],
    queryFn: () => api.get('/relatorios/historico?limit=12').then((r) => r.data),
  })

  const { data: vencendoData, isLoading: isLoadingVencendo } = useQuery<ObrigacoesVencendoResponse>(
    {
      queryKey: ['obrigacoes-vencendo', diasVencendo],
      queryFn: () =>
        api.get(`/relatorios/obrigacoes-vencendo?dias=${diasVencendo}`).then((r) => r.data),
      staleTime: 60000,
    }
  )

  const gerarRelatorio = useMutation({
    mutationFn: () => api.post(`/relatorios/consolidado/${competencia}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['relatorios-historico'] }),
  })

  async function baixarCSV() {
    setBaixando(true)
    try {
      const { data } = await api.get(`/relatorios/consolidado/${competencia}`)
      window.open(data.url, '_blank')
    } catch {
      alert('Relatório ainda não gerado. Clique em "Gerar CSV" primeiro.')
    } finally {
      setBaixando(false)
    }
  }

  const pgdasApuracoes = apuracoes.filter((a) => a.tipo === 'PGDAS')
  const totalDAS = pgdasApuracoes.reduce((acc, a) => {
    const d = a.dados as any
    return acc + Number(d?.valorDAS ?? d?.valorDas ?? 0)
  }, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Relatórios</h1>
          <p className="text-slate-500 text-sm mt-1">Consolidado mensal de apurações</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={baixarCSV}
            disabled={baixando}
            className="border border-slate-300 hover:border-slate-400 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {baixando ? 'Abrindo...' : 'Baixar CSV'}
          </button>
          <button
            onClick={() => gerarRelatorio.mutate()}
            disabled={gerarRelatorio.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {gerarRelatorio.isPending ? 'Gerando...' : 'Gerar CSV'}
          </button>
        </div>
      </div>

      {gerarRelatorio.isSuccess && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
          Relatório enfileirado com sucesso. Clique em "Baixar CSV" em alguns instantes.
        </div>
      )}

      {/* KPIs do mês */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Empresas com PGDAS</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{pgdasApuracoes.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Total DAS — {competencia}</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{fmt.format(totalDAS)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Apurações no período</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{apuracoes.length}</p>
          <p className="text-xs text-slate-400 mt-1">PGDAS + DIFAL + EFD-Reinf + outros</p>
        </div>
      </div>

      {/* Tabela PGDAS */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">PGDAS — {competencia}</h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-slate-400">Carregando...</div>
        ) : pgdasApuracoes.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            Nenhuma apuração PGDAS encontrada para {competencia}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Empresa / CNPJ</th>
                <th className="px-4 py-3 text-right">RB Mensal</th>
                <th className="px-4 py-3 text-right">RB 12 Meses</th>
                <th className="px-4 py-3 text-right">Alíquota</th>
                <th className="px-4 py-3 text-right">Valor DAS</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pgdasApuracoes.map((ap) => {
                const d = ap.dados as any
                return (
                  <tr key={ap.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 font-mono text-xs">
                        {ap.empresa?.cnpj ?? d?.cnpj ?? '—'}
                      </p>
                      {ap.empresa?.razaoSocial && (
                        <p className="text-xs text-slate-400">{ap.empresa.razaoSocial}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {fmt.format(Number(d?.receitaBrutaTotal ?? 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {fmt.format(Number(d?.receitaBruta12Meses ?? 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {Number(d?.aliquotaEfetiva ?? 0).toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-blue-600">
                      {fmt.format(Number(d?.valorDAS ?? d?.valorDas ?? 0))}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          ap.status === 'TRANSMITIDO'
                            ? 'bg-green-100 text-green-700'
                            : ap.status === 'CALCULADO'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {ap.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold border-t border-slate-200">
              <tr>
                <td className="px-4 py-3 text-slate-700">Total</td>
                <td colSpan={3} />
                <td className="px-4 py-3 text-right text-blue-700">{fmt.format(totalDAS)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Obrigações vencendo */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Obrigações Vencendo</h2>
            {vencendoData && (
              <p className="text-xs text-slate-400 mt-0.5">
                {vencendoData.total} obrigação(ões) nos próximos {diasVencendo} dias
              </p>
            )}
          </div>
          <div className="flex gap-1">
            {DIAS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDiasVencendo(opt.value)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  diasVencendo === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {isLoadingVencendo ? (
          <div className="p-6 text-center text-slate-400 text-sm">Carregando...</div>
        ) : !vencendoData || vencendoData.obrigacoes.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-sm">
            Nenhuma obrigação vencendo nos próximos {diasVencendo} dias.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Empresa</th>
                <th className="px-4 py-3 text-left">Obrigação</th>
                <th className="px-4 py-3 text-left">Competência</th>
                <th className="px-4 py-3 text-center">Vencimento</th>
                <th className="px-4 py-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vencendoData.obrigacoes.map((obr) => {
                const venc = new Date(obr.vencimento)
                const hoje = new Date()
                const diffDias = Math.ceil(
                  (venc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)
                )
                const urgente = diffDias <= 3

                return (
                  <tr key={obr.id} className={urgente ? 'bg-red-50' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 truncate max-w-[180px]">
                        {obr.empresa.razaoSocial}
                      </p>
                      <p className="font-mono text-xs text-slate-400">{obr.empresa.cnpj}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                        {obr.tipo.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{obr.competencia}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                          urgente
                            ? 'bg-red-100 text-red-700'
                            : diffDias <= 7
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {venc.toLocaleDateString('pt-BR')}
                        {urgente && ` (${diffDias}d)`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {obr.valor ? fmt.format(Number(obr.valor)) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Histórico de relatórios gerados */}
      {historico.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">Histórico de relatórios gerados</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Competência</th>
                <th className="px-4 py-3 text-right">Empresas</th>
                <th className="px-4 py-3 text-left">Gerado em</th>
                <th className="px-4 py-3 text-center">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {historico.map((h) => (
                <tr key={h.id} className={`hover:bg-slate-50 ${!h.lido ? 'bg-blue-50/30' : ''}`}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {h.competencia}
                    {!h.lido && (
                      <span className="ml-2 text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded-full">
                        novo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{h.empresasCount}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {h.geradoEm ? new Date(h.geradoEm).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={async () => {
                        try {
                          const { data } = await api.get(`/relatorios/consolidado/${h.competencia}`)
                          window.open(data.url, '_blank')
                          await api.patch(`/relatorios/historico/${h.id}/lido`)
                          qc.invalidateQueries({ queryKey: ['relatorios-historico'] })
                        } catch {
                          alert('Não foi possível obter o download.')
                        }
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Baixar CSV
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
