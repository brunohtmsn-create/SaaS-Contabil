'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Lancamento = {
  id: string
  data: string
  historico: string
  contaDebito: string
  contaCredito: string
  valor: string
  competencia: string
  empresaId: string
}

type BemAtivo = {
  id: string
  descricao: string
  dataAquisicao: string
  valorAquisicao: string
  vidaUtil: number
  valorResidual: string
  status: string
  empresaId: string
}

type EmpresaOption = { id: string; razaoSocial: string; cnpj: string }

type Transacao = {
  id: string
  data: string
  valor: string
  tipo: 'CREDITO' | 'DEBITO'
  descricao: string
  banco: string
  status: 'CONCILIADA' | 'NAO_CONCILIADA'
}

type StatusBancario = { total: number; conciliadas: number; naoConciliadas: number }

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export default function ContabilPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'lancamentos' | 'bens' | 'bancario'>('lancamentos')
  const [competencia, setCompetencia] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [empresaId, setEmpresaId] = useState('')
  const [showNovoBem, setShowNovoBem] = useState(false)
  const [novoBem, setNovoBem] = useState({
    descricao: '',
    dataAquisicao: '',
    valorAquisicao: '',
    vidaUtil: '60',
    valorResidual: '0',
  })

  const { data: empresas = [] } = useQuery<EmpresaOption[]>({
    queryKey: ['empresas-lista'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
  })

  const { data: lancamentos = [], isLoading: loadingLanc } = useQuery<Lancamento[]>({
    queryKey: ['lancamentos', empresaId, competencia],
    queryFn: () =>
      api.get(`/contabil/lancamentos/${empresaId}?competencia=${competencia}`).then((r) => r.data),
    enabled: !!empresaId,
  })

  const { data: bens = [], isLoading: loadingBens } = useQuery<BemAtivo[]>({
    queryKey: ['bens', empresaId],
    queryFn: () => api.get(`/contabil/bens/${empresaId}`).then((r) => r.data),
    enabled: !!empresaId,
  })

  const gerarLancamentos = useMutation({
    mutationFn: () => api.post(`/contabil/lancamentos/${empresaId}/${competencia}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lancamentos', empresaId, competencia] }),
  })

  const calcularDepreciacao = useMutation({
    mutationFn: () => api.post(`/contabil/depreciacao/${empresaId}/${competencia}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lancamentos', empresaId, competencia] }),
  })

  const criarBem = useMutation({
    mutationFn: () =>
      api.post(`/contabil/bens/${empresaId}`, {
        descricao: novoBem.descricao,
        dataAquisicao: novoBem.dataAquisicao,
        valorAquisicao: Number(novoBem.valorAquisicao),
        vidaUtil: Number(novoBem.vidaUtil),
        valorResidual: Number(novoBem.valorResidual),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bens', empresaId] })
      setShowNovoBem(false)
      setNovoBem({
        descricao: '',
        dataAquisicao: '',
        valorAquisicao: '',
        vidaUtil: '60',
        valorResidual: '0',
      })
    },
  })

  const { data: transacoes = [], isLoading: loadingTx } = useQuery<Transacao[]>({
    queryKey: ['transacoes', empresaId, competencia],
    queryFn: () =>
      api.get(`/contabil/transacoes/${empresaId}?competencia=${competencia}`).then((r) => r.data),
    enabled: !!empresaId,
  })

  const { data: statusBancario } = useQuery<StatusBancario>({
    queryKey: ['transacoes-status', empresaId, competencia],
    queryFn: () =>
      api
        .get(`/contabil/transacoes/status/${empresaId}?competencia=${competencia}`)
        .then((r) => r.data),
    enabled: !!empresaId,
  })

  const sincronizarOpenFinance = useMutation({
    mutationFn: () =>
      api.post(`/contabil/open-finance/sincronizar/${empresaId}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transacoes', empresaId, competencia] })
      qc.invalidateQueries({ queryKey: ['transacoes-status', empresaId, competencia] })
    },
  })

  const conciliarBancario = useMutation({
    mutationFn: () =>
      api.post(`/contabil/bancario/${empresaId}/${competencia}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transacoes', empresaId, competencia] })
      qc.invalidateQueries({ queryKey: ['transacoes-status', empresaId, competencia] })
    },
  })

  const totalLancamentos = lancamentos.reduce((s, l) => s + Number(l.valor ?? 0), 0)
  const totalBens = bens.reduce((s, b) => s + Number(b.valorAquisicao ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contabilidade</h1>
          <p className="text-slate-500 text-sm mt-1">
            Lançamentos contábeis, depreciação e bens ativos
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-w-48"
          >
            <option value="">Selecionar empresa...</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.razaoSocial}
              </option>
            ))}
          </select>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Lançamentos no período</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{lancamentos.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Valor total lançado</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{fmt.format(totalLancamentos)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Patrimônio ativo</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{fmt.format(totalBens)}</p>
          <p className="text-xs text-slate-400 mt-1">
            {bens.filter((b) => b.status === 'ATIVO').length} bens ativos
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Conciliação bancária</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">
            {statusBancario
              ? `${statusBancario.total > 0 ? Math.round((statusBancario.conciliadas / statusBancario.total) * 100) : 0}%`
              : '—'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {statusBancario
              ? `${statusBancario.conciliadas}/${statusBancario.total} transações`
              : 'Selecione uma empresa'}
          </p>
        </div>
      </div>

      <div className="flex border-b border-slate-200">
        {(
          [
            { key: 'lancamentos', label: 'Lançamentos Contábeis' },
            { key: 'bens', label: 'Bens do Ativo' },
            { key: 'bancario', label: 'Bancário' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'lancamentos' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Lançamentos — {competencia}</h3>
            {empresaId && (
              <div className="flex gap-2">
                <button
                  onClick={() => calcularDepreciacao.mutate()}
                  disabled={calcularDepreciacao.isPending}
                  className="text-sm border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  Calcular Depreciação
                </button>
                <button
                  onClick={() => gerarLancamentos.mutate()}
                  disabled={gerarLancamentos.isPending}
                  className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {gerarLancamentos.isPending ? 'Gerando...' : 'Gerar Lançamentos'}
                </button>
              </div>
            )}
          </div>

          {!empresaId ? (
            <div className="p-12 text-center text-slate-400">
              Selecione uma empresa para ver os lançamentos.
            </div>
          ) : loadingLanc ? (
            <div className="p-12 text-center text-slate-400">Carregando...</div>
          ) : lancamentos.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              Nenhum lançamento em {competencia}. Clique em "Gerar Lançamentos" para processar.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                    Data
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                    Histórico
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                    Débito
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                    Crédito
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lancamentos.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(l.data).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700 max-w-xs truncate">
                      {l.historico}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{l.contaDebito}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{l.contaCredito}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">
                      {new Intl.NumberFormat('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      }).format(Number(l.valor))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'bens' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Bens do Ativo Imobilizado</h3>
            {empresaId && (
              <button
                onClick={() => setShowNovoBem(true)}
                className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
              >
                + Novo Bem
              </button>
            )}
          </div>

          {showNovoBem && (
            <div className="p-6 border-b border-slate-100 bg-slate-50">
              <h4 className="font-medium text-slate-900 mb-4">Cadastrar Bem</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Descrição</label>
                  <input
                    value={novoBem.descricao}
                    onChange={(e) => setNovoBem((n) => ({ ...n, descricao: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Ex: Computador Dell Optiplex 7000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Data de Aquisição
                  </label>
                  <input
                    type="date"
                    value={novoBem.dataAquisicao}
                    onChange={(e) => setNovoBem((n) => ({ ...n, dataAquisicao: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Valor de Aquisição (R$)
                  </label>
                  <input
                    type="number"
                    value={novoBem.valorAquisicao}
                    onChange={(e) => setNovoBem((n) => ({ ...n, valorAquisicao: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="5000.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Vida Útil (meses)
                  </label>
                  <input
                    type="number"
                    value={novoBem.vidaUtil}
                    onChange={(e) => setNovoBem((n) => ({ ...n, vidaUtil: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Valor Residual (R$)
                  </label>
                  <input
                    type="number"
                    value={novoBem.valorResidual}
                    onChange={(e) => setNovoBem((n) => ({ ...n, valorResidual: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => criarBem.mutate()}
                  disabled={criarBem.isPending || !novoBem.descricao || !novoBem.dataAquisicao}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {criarBem.isPending ? 'Salvando...' : 'Salvar Bem'}
                </button>
                <button
                  onClick={() => setShowNovoBem(false)}
                  className="border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {!empresaId ? (
            <div className="p-12 text-center text-slate-400">Selecione uma empresa.</div>
          ) : loadingBens ? (
            <div className="p-12 text-center text-slate-400">Carregando...</div>
          ) : bens.length === 0 ? (
            <div className="p-12 text-center text-slate-400">Nenhum bem cadastrado.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                    Descrição
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                    Aquisição
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">
                    Valor
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">
                    Vida Útil
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">
                    Dep./Mês
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bens.map((bem) => {
                  const depMes =
                    (Number(bem.valorAquisicao) - Number(bem.valorResidual)) / bem.vidaUtil
                  return (
                    <tr key={bem.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{bem.descricao}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {new Date(bem.dataAquisicao).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {new Intl.NumberFormat('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        }).format(Number(bem.valorAquisicao))}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-600">{bem.vidaUtil} meses</td>
                      <td className="px-4 py-3 text-right text-blue-600 font-medium">
                        {new Intl.NumberFormat('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        }).format(depMes)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            bem.status === 'ATIVO'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {bem.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'bancario' && (
        <div className="space-y-4">
          {/* Ações bancárias */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4 flex-wrap">
            <span className="text-lg shrink-0">🏦</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700">Open Finance</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Importa extrato bancário e concilia com documentos fiscais
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => sincronizarOpenFinance.mutate()}
                disabled={!empresaId || sincronizarOpenFinance.isPending}
                className="text-sm px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                {sincronizarOpenFinance.isPending ? 'Sincronizando...' : 'Sincronizar Extrato'}
              </button>
              <button
                onClick={() => conciliarBancario.mutate()}
                disabled={!empresaId || conciliarBancario.isPending}
                className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {conciliarBancario.isPending ? 'Conciliando...' : 'Conciliar Bancário'}
              </button>
            </div>
            {sincronizarOpenFinance.isSuccess && (
              <span className="text-xs text-green-600 font-medium">Extrato importado!</span>
            )}
            {conciliarBancario.isSuccess && (
              <span className="text-xs text-green-600 font-medium">Conciliação concluída!</span>
            )}
          </div>

          {/* Tabela de transações */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Transações Bancárias — {competencia}</h3>
              {statusBancario && (
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span>
                    <span className="text-green-600 font-semibold">
                      {statusBancario.conciliadas}
                    </span>{' '}
                    conciliadas
                  </span>
                  <span>
                    <span className="text-orange-500 font-semibold">
                      {statusBancario.naoConciliadas}
                    </span>{' '}
                    pendentes
                  </span>
                </div>
              )}
            </div>

            {!empresaId ? (
              <div className="p-12 text-center text-slate-400">
                Selecione uma empresa para ver as transações.
              </div>
            ) : loadingTx ? (
              <div className="p-12 text-center text-slate-400">Carregando...</div>
            ) : transacoes.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                Nenhuma transação encontrada.{' '}
                <button
                  onClick={() => sincronizarOpenFinance.mutate()}
                  className="text-blue-600 hover:underline"
                >
                  Sincronizar extrato
                </button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Data
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Descrição
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Banco
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">
                      Valor
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transacoes.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {new Date(tx.data).toLocaleDateString('pt-BR', {
                          timeZone: 'America/Sao_Paulo',
                        })}
                      </td>
                      <td className="px-4 py-3 text-slate-700 max-w-xs truncate">{tx.descricao}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{tx.banco}</td>
                      <td
                        className={`px-4 py-3 text-right font-mono font-semibold ${
                          tx.tipo === 'CREDITO' ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {tx.tipo === 'DEBITO' ? '-' : '+'}
                        {fmt.format(Number(tx.valor))}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tx.status === 'CONCILIADA' ? (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                            Conciliada
                          </span>
                        ) : (
                          <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">
                            Pendente
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
