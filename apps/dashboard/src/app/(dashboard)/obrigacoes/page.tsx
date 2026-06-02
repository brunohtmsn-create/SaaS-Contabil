'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import { CalendarDays, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoObrigacao =
  | 'DAS'
  | 'PGDAS'
  | 'EFD_REINF'
  | 'DCTFWEB'
  | 'DESTDA'
  | 'GNRE_DIFAL'
  | 'GNRE_ST'
  | 'ISS'
  | 'DMS'
  | 'ECD'
  | 'ECF'
  | 'DASN'
  | 'ESOCIAL'
  | 'FGTS_DIGITAL'
  | 'DCTF'
  | 'IRPJ'
  | 'CSLL'

type StatusObrigacao = 'PENDENTE' | 'TRANSMITIDA' | 'PAGA' | 'ATRASADA' | 'DISPENSADA' | 'ERRO'

interface Empresa {
  id: string
  cnpj: string
  razaoSocial: string
}

interface Obrigacao {
  id: string
  tenantId: string
  empresaId: string
  tipo: TipoObrigacao
  competencia: string
  vencimento: string
  status: StatusObrigacao
  valor: string | null
  recibo: string | null
  s3Key: string | null
  criadoEm: string
  cumprideEm: string | null
  empresa: Empresa
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS: Array<{ value: StatusObrigacao | 'TODAS'; label: string }> = [
  { value: 'TODAS', label: 'Todas' },
  { value: 'PENDENTE', label: 'Pendente' },
  { value: 'ATRASADA', label: 'Atrasada' },
  { value: 'TRANSMITIDA', label: 'Transmitida' },
  { value: 'PAGA', label: 'Paga' },
  { value: 'DISPENSADA', label: 'Dispensada' },
  { value: 'ERRO', label: 'Erro' },
]

function statusBadge(status: StatusObrigacao) {
  const base = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold'
  switch (status) {
    case 'ATRASADA':
      return <span className={`${base} bg-red-100 text-red-700`}>Atrasada</span>
    case 'PENDENTE':
      return <span className={`${base} bg-yellow-100 text-yellow-700`}>Pendente</span>
    case 'PAGA':
    case 'TRANSMITIDA':
      return (
        <span className={`${base} bg-green-100 text-green-700`}>
          {status === 'PAGA' ? 'Paga' : 'Transmitida'}
        </span>
      )
    case 'DISPENSADA':
      return <span className={`${base} bg-slate-100 text-slate-600`}>Dispensada</span>
    case 'ERRO':
      return <span className={`${base} bg-orange-100 text-orange-700`}>Erro</span>
    default:
      return <span className={`${base} bg-slate-100 text-slate-600`}>{status}</span>
  }
}

function formatCompetencia(value: string): string {
  const [year, month] = value.split('-')
  const months = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
  ]
  return `${months[Number(month) - 1]} ${year}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function formatMoney(value: string | null): string {
  if (!value) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    parseFloat(value)
  )
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  if (m === 1) return `${y - 1}-12`
  return `${y}-${String(m - 1).padStart(2, '0')}`
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  if (m === 12) return `${y + 1}-01`
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ObrigacoesPage() {
  const queryClient = useQueryClient()
  const [competencia, setCompetencia] = useState<string>(() => new Date().toISOString().slice(0, 7))
  const [statusFiltro, setStatusFiltro] = useState<StatusObrigacao | 'TODAS'>('TODAS')
  const [calendarioEmpresaId, setCalendarioEmpresaId] = useState<string>('')

  // Busca obrigações do mês
  const { data: obrigacoes = [], isLoading } = useQuery<Obrigacao[]>({
    queryKey: ['obrigacoes', competencia, statusFiltro],
    queryFn: () => {
      const params = new URLSearchParams({ competencia })
      if (statusFiltro !== 'TODAS') params.set('status', statusFiltro)
      return api.get(`/fiscal/obrigacoes?${params.toString()}`).then((r) => r.data)
    },
  })

  // Busca lista de empresas para o select do calendário anual
  const { data: empresas = [] } = useQuery<Empresa[]>({
    queryKey: ['empresas'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
  })

  // Mutation para gerar calendário anual de uma empresa
  const gerarCalendario = useMutation({
    mutationFn: ({ empresaId, ano }: { empresaId: string; ano: number }) =>
      api.post(`/fiscal/obrigacoes/calendario/${empresaId}/${ano}`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['obrigacoes'] })
    },
  })

  // Mutation para gerar calendário de TODAS as empresas SN/MEI
  const gerarCalendarioTodas = useMutation({
    mutationFn: (ano: number) =>
      api.post(`/fiscal/obrigacoes/calendario/batch/${ano}`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['obrigacoes'] })
    },
  })

  // Mutation para gerar calendário de TODAS as empresas LP/LR
  const gerarCalendarioTodasLPLR = useMutation({
    mutationFn: (ano: number) =>
      api.post(`/fiscal/obrigacoes/calendario/batch-lplr/${ano}`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['obrigacoes'] })
    },
  })

  // Mutation para atualizar status da obrigação
  const atualizarStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: StatusObrigacao }) =>
      api.patch(`/fiscal/obrigacoes/${id}`, { status }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['obrigacoes'] })
    },
  })

  // Ordena por vencimento mais próximo primeiro
  const obrigacoesOrdenadas = [...obrigacoes].sort(
    (a, b) => new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime()
  )

  const anoAtual = new Date().getFullYear()

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Obrigações Fiscais</h1>
          <p className="text-slate-500 mt-1">{formatCompetencia(competencia)}</p>
        </div>

        {/* Navegação de mês */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCompetencia(prevMonth(competencia))}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => setCompetencia(nextMonth(competencia))}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600"
            aria-label="Próximo mês"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Gerar Calendário Anual */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4 flex-wrap">
        <CalendarDays className="w-5 h-5 text-blue-600 shrink-0" />
        <span className="text-sm font-medium text-slate-700">Gerar Calendário Anual</span>
        <select
          value={calendarioEmpresaId}
          onChange={(e) => setCalendarioEmpresaId(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Selecione a empresa…</option>
          {empresas.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.razaoSocial}
            </option>
          ))}
        </select>
        <button
          disabled={!calendarioEmpresaId || gerarCalendario.isPending}
          onClick={() => gerarCalendario.mutate({ empresaId: calendarioEmpresaId, ano: anoAtual })}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {gerarCalendario.isPending ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <CalendarDays className="w-4 h-4" />
          )}
          Gerar {anoAtual}
        </button>
        {gerarCalendario.isSuccess && (
          <span className="text-sm text-green-600 font-medium">Calendário gerado com sucesso!</span>
        )}
        {gerarCalendario.isError && (
          <span className="text-sm text-red-600 font-medium">Erro ao gerar calendário.</span>
        )}

        <div className="border-l border-slate-200 pl-4 ml-2 flex items-center gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 font-medium">SN / MEI</span>
            <button
              disabled={gerarCalendarioTodas.isPending}
              onClick={() => gerarCalendarioTodas.mutate(anoAtual)}
              className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {gerarCalendarioTodas.isPending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <CalendarDays className="w-4 h-4" />
              )}
              Gerar Todas ({anoAtual})
            </button>
            {gerarCalendarioTodas.isSuccess && (
              <span className="text-xs text-green-600 font-medium">
                {(gerarCalendarioTodas.data as any)?.sucesso} empresa(s) gerada(s)!
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 font-medium">LP / LR</span>
            <button
              disabled={gerarCalendarioTodasLPLR.isPending}
              onClick={() => gerarCalendarioTodasLPLR.mutate(anoAtual)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {gerarCalendarioTodasLPLR.isPending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <CalendarDays className="w-4 h-4" />
              )}
              Gerar Todas ({anoAtual})
            </button>
            {gerarCalendarioTodasLPLR.isSuccess && (
              <span className="text-xs text-green-600 font-medium">
                {(gerarCalendarioTodasLPLR.data as any)?.sucesso} empresa(s) gerada(s)!
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Filtro por status */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-slate-500 font-medium mr-1">Status:</span>
        {STATUS_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatusFiltro(opt.value as StatusObrigacao | 'TODAS')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              statusFiltro === opt.value
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                Empresa
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                Tipo
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                Vencimento
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">
                Valor DAS
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  Carregando obrigações…
                </td>
              </tr>
            ) : obrigacoesOrdenadas.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  Nenhuma obrigação encontrada para o período selecionado.
                </td>
              </tr>
            ) : (
              obrigacoesOrdenadas.map((obr) => {
                const vencida = obr.status === 'PENDENTE' && new Date(obr.vencimento) < new Date()

                return (
                  <tr key={obr.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-800">
                        {obr.empresa?.razaoSocial ?? '—'}
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-0.5">
                        {obr.empresa?.cnpj ?? ''}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                        {obr.tipo.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td
                      className={`px-6 py-4 ${vencida ? 'text-red-600 font-semibold' : 'text-slate-700'}`}
                    >
                      {formatDate(obr.vencimento)}
                    </td>
                    <td className="px-6 py-4 text-center">{statusBadge(obr.status)}</td>
                    <td className="px-6 py-4 text-right font-mono text-slate-700">
                      {formatMoney(obr.valor)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {obr.recibo ? (
                        <span className="text-xs text-green-600 font-medium">
                          Recibo: {obr.recibo.slice(0, 12)}…
                        </span>
                      ) : obr.status === 'PENDENTE' || obr.status === 'ATRASADA' ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => atualizarStatus.mutate({ id: obr.id, status: 'PAGA' })}
                            disabled={atualizarStatus.isPending}
                            className="text-xs px-2 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
                          >
                            Paga
                          </button>
                          <button
                            onClick={() =>
                              atualizarStatus.mutate({ id: obr.id, status: 'DISPENSADA' })
                            }
                            disabled={atualizarStatus.isPending}
                            className="text-xs px-2 py-1 border border-slate-300 text-slate-600 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors"
                          >
                            Dispensar
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>

        {obrigacoesOrdenadas.length > 0 && (
          <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
            {obrigacoesOrdenadas.length} obrigação{obrigacoesOrdenadas.length !== 1 ? 'ões' : ''}{' '}
            encontrada{obrigacoesOrdenadas.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
