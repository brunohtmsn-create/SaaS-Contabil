'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import {
  CheckCircle,
  AlertCircle,
  Clock,
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusGeral = 'ATRASADA' | 'PROXIMA' | 'PENDENTE' | 'EM_DIA' | 'SEM_OBRIGACOES'

interface ObrigacaoResumo {
  id: string
  tipo: string
  vencimento: string
  status: string
}

interface EmpresaCompliance {
  empresa: {
    id: string
    cnpj: string
    razaoSocial: string
    regime: string
  }
  totalObrigacoes: number
  pendentes: number
  atrasadas: number
  proximasSemana: number
  cumpridas: number
  statusGeral: StatusGeral
  proximaObrigacao: ObrigacaoResumo | null
}

interface ComplianceResumo {
  competencia: string
  totais: {
    totalEmpresas: number
    totalAtrasadas: number
    totalProximas: number
    totalEmDia: number
  }
  empresas: EmpresaCompliance[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
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

function StatusBadge({ status }: { status: StatusGeral }) {
  switch (status) {
    case 'ATRASADA':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
          <AlertCircle className="w-3.5 h-3.5" />
          Atrasada
        </span>
      )
    case 'PROXIMA':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
          <AlertTriangle className="w-3.5 h-3.5" />
          Vence em breve
        </span>
      )
    case 'PENDENTE':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">
          <Clock className="w-3.5 h-3.5" />
          Pendente
        </span>
      )
    case 'EM_DIA':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
          <CheckCircle className="w-3.5 h-3.5" />
          Em dia
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
          Sem obrigações
        </span>
      )
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CompliancePage() {
  const [competencia, setCompetencia] = useState<string>(() => new Date().toISOString().slice(0, 7))
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<StatusGeral | 'TODAS'>('TODAS')

  const { data, isLoading } = useQuery<ComplianceResumo>({
    queryKey: ['compliance-resumo', competencia],
    queryFn: () =>
      api.get(`/fiscal/compliance/resumo?competencia=${competencia}`).then((r) => r.data),
    refetchInterval: 60_000,
  })

  const empresasFiltradas = (data?.empresas ?? []).filter((e) => {
    const matchBusca =
      busca === '' ||
      e.empresa.razaoSocial.toLowerCase().includes(busca.toLowerCase()) ||
      e.empresa.cnpj.includes(busca)
    const matchStatus = filtroStatus === 'TODAS' || e.statusGeral === filtroStatus
    return matchBusca && matchStatus
  })

  const sortOrder: Record<StatusGeral, number> = {
    ATRASADA: 0,
    PROXIMA: 1,
    PENDENTE: 2,
    EM_DIA: 3,
    SEM_OBRIGACOES: 4,
  }

  const empresasOrdenadas = [...empresasFiltradas].sort(
    (a, b) => sortOrder[a.statusGeral] - sortOrder[b.statusGeral]
  )

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Painel de Compliance</h1>
          <p className="text-sm text-slate-500 mt-1">
            Visão geral de obrigações fiscais — {formatCompetencia(competencia)}
          </p>
        </div>
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
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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

      {/* Cards de resumo */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Total Empresas</p>
                <p className="text-2xl font-bold text-slate-900">{data.totais.totalEmpresas}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-50 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Com Atraso</p>
                <p className="text-2xl font-bold text-red-600">{data.totais.totalAtrasadas}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-50 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Vencem em 7 dias</p>
                <p className="text-2xl font-bold text-orange-600">{data.totais.totalProximas}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500 font-medium">Em Dia</p>
                <p className="text-2xl font-bold text-green-600">{data.totais.totalEmDia}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Buscar empresa…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
        />
        <div className="flex items-center gap-2">
          {(['TODAS', 'ATRASADA', 'PROXIMA', 'PENDENTE', 'EM_DIA'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFiltroStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                filtroStatus === s
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s === 'TODAS'
                ? 'Todas'
                : s === 'ATRASADA'
                  ? 'Atrasadas'
                  : s === 'PROXIMA'
                    ? 'Vence em breve'
                    : s === 'PENDENTE'
                      ? 'Pendentes'
                      : 'Em dia'}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela de empresas */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                Empresa
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                Regime
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">
                Status
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">
                Obrigações
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                Próximo vencimento
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                  Carregando compliance…
                </td>
              </tr>
            ) : empresasOrdenadas.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                  Nenhuma empresa encontrada.
                </td>
              </tr>
            ) : (
              empresasOrdenadas.map((item) => (
                <tr
                  key={item.empresa.id}
                  className={`hover:bg-slate-50 transition-colors ${
                    item.atrasadas > 0 ? 'bg-red-50/30' : ''
                  }`}
                >
                  <td className="px-6 py-4">
                    <div className="font-medium text-slate-800">{item.empresa.razaoSocial}</div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      {item.empresa.cnpj}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                      {item.empresa.regime.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <StatusBadge status={item.statusGeral} />
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex items-center justify-center gap-3 text-xs">
                      <span className="text-red-600 font-semibold">
                        {item.atrasadas > 0 ? `${item.atrasadas} atras.` : ''}
                      </span>
                      <span className="text-yellow-600">
                        {item.pendentes > 0 ? `${item.pendentes} pend.` : ''}
                      </span>
                      <span className="text-green-600">
                        {item.cumpridas > 0 ? `${item.cumpridas} ok` : ''}
                      </span>
                      {item.totalObrigacoes === 0 && <span className="text-slate-400">—</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {item.proximaObrigacao ? (
                      <div>
                        <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                          {item.proximaObrigacao.tipo.replace(/_/g, ' ')}
                        </span>
                        <span className="ml-2 text-slate-500">
                          {formatDate(item.proximaObrigacao.vencimento)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {empresasOrdenadas.length > 0 && (
          <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
            {empresasOrdenadas.length} empresa{empresasOrdenadas.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
