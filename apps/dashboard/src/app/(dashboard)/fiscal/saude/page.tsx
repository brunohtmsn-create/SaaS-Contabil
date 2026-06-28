'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'

function competenciaAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type NivelSaude = 'SAUDAVEL' | 'ATENCAO' | 'CRITICO' | 'GRAVE'

type EmpresaSaude = {
  empresaId: string
  cnpj: string
  razaoSocial: string
  regime: string
  score: number
  nivel: NivelSaude
  alertas: number
  obrigacoesAtrasadas: number
  docsPendentes: number
  apuracoesCalculadas: number
}

type PainelSaude = {
  competencia: string
  total: number
  grave: number
  critico: number
  atencao: number
  saudavel: number
  empresas: EmpresaSaude[]
}

const NIVEL_CONFIG: Record<NivelSaude, { label: string; bg: string; text: string; badge: string }> =
  {
    SAUDAVEL: {
      label: 'Saudável',
      bg: 'bg-green-50',
      text: 'text-green-700',
      badge: 'bg-green-100 text-green-800',
    },
    ATENCAO: {
      label: 'Atenção',
      bg: 'bg-yellow-50',
      text: 'text-yellow-700',
      badge: 'bg-yellow-100 text-yellow-800',
    },
    CRITICO: {
      label: 'Crítico',
      bg: 'bg-orange-50',
      text: 'text-orange-700',
      badge: 'bg-orange-100 text-orange-800',
    },
    GRAVE: {
      label: 'Grave',
      bg: 'bg-red-50',
      text: 'text-red-700',
      badge: 'bg-red-100 text-red-800',
    },
  }

function ScoreBar({ score }: { score: number }) {
  const cor =
    score >= 80
      ? 'bg-green-500'
      : score >= 60
        ? 'bg-yellow-500'
        : score >= 40
          ? 'bg-orange-500'
          : 'bg-red-500'
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-200">
      <div className={`h-1.5 rounded-full transition-all ${cor}`} style={{ width: `${score}%` }} />
    </div>
  )
}

export default function SaudeFiscalPage() {
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [filtroNivel, setFiltroNivel] = useState<NivelSaude | ''>('')
  const [busca, setBusca] = useState('')

  const { data, isLoading, refetch } = useQuery<PainelSaude>({
    queryKey: ['saude-fiscal', competencia],
    queryFn: () => api.get(`/fiscal/saude/${competencia}`).then((r) => r.data),
    staleTime: 60000,
  })

  const empresasFiltradas = (data?.empresas ?? []).filter((e) => {
    if (filtroNivel && e.nivel !== filtroNivel) return false
    if (busca) {
      const q = busca.toLowerCase()
      return e.razaoSocial.toLowerCase().includes(q) || e.cnpj.includes(q)
    }
    return true
  })

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Painel de Saúde Fiscal</h1>
          <p className="mt-1 text-sm text-gray-500">
            Score de compliance por empresa baseado em alertas, obrigações e conciliação.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => refetch()}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            Atualizar
          </button>
        </div>
      </div>

      {/* KPI cards */}
      {data && (
        <div className="grid gap-4 sm:grid-cols-4">
          {(
            [
              { nivel: 'GRAVE' as NivelSaude, count: data.grave, cor: 'border-red-300 bg-red-50' },
              {
                nivel: 'CRITICO' as NivelSaude,
                count: data.critico,
                cor: 'border-orange-300 bg-orange-50',
              },
              {
                nivel: 'ATENCAO' as NivelSaude,
                count: data.atencao,
                cor: 'border-yellow-300 bg-yellow-50',
              },
              {
                nivel: 'SAUDAVEL' as NivelSaude,
                count: data.saudavel,
                cor: 'border-green-300 bg-green-50',
              },
            ] as const
          ).map(({ nivel, count, cor }) => (
            <button
              key={nivel}
              onClick={() => setFiltroNivel(filtroNivel === nivel ? '' : nivel)}
              className={`rounded-lg border p-4 text-left transition-all ${cor} ${
                filtroNivel === nivel ? 'ring-2 ring-blue-500' : 'hover:opacity-80'
              }`}
            >
              <p className={`text-xs font-semibold ${NIVEL_CONFIG[nivel].text}`}>
                {NIVEL_CONFIG[nivel].label}
              </p>
              <p className={`text-3xl font-bold ${NIVEL_CONFIG[nivel].text}`}>{count}</p>
              <p className="mt-0.5 text-xs text-gray-500">de {data.total} empresas</p>
            </button>
          ))}
        </div>
      )}

      {/* Busca e filtros */}
      <div className="flex gap-3">
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou CNPJ…"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {filtroNivel && (
          <button
            onClick={() => setFiltroNivel('')}
            className="rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
          >
            Limpar filtro
          </button>
        )}
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-400">Calculando scores…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Empresa</th>
                <th className="px-4 py-3 text-left">Regime</th>
                <th className="px-4 py-3 text-center">Score</th>
                <th className="px-4 py-3 text-center">Alertas</th>
                <th className="px-4 py-3 text-center">Obrig. Atr.</th>
                <th className="px-4 py-3 text-center">Docs Pend.</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {empresasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-400">
                    Nenhuma empresa encontrada.
                  </td>
                </tr>
              ) : (
                empresasFiltradas.map((emp) => (
                  <tr
                    key={emp.empresaId}
                    className={`hover:bg-gray-50 ${NIVEL_CONFIG[emp.nivel].bg}`}
                  >
                    <td className="px-4 py-3">
                      <p className="max-w-[200px] truncate font-medium text-gray-800">
                        {emp.razaoSocial}
                      </p>
                      <p className="font-mono text-xs text-gray-400">{emp.cnpj}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">
                        {emp.regime.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-lg font-bold ${NIVEL_CONFIG[emp.nivel].text}`}>
                            {emp.score}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${NIVEL_CONFIG[emp.nivel].badge}`}
                          >
                            {NIVEL_CONFIG[emp.nivel].label}
                          </span>
                        </div>
                        <div className="w-24">
                          <ScoreBar score={emp.score} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={emp.alertas > 0 ? 'font-bold text-red-600' : 'text-gray-400'}
                      >
                        {emp.alertas}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={
                          emp.obrigacoesAtrasadas > 0
                            ? 'font-bold text-orange-600'
                            : 'text-gray-400'
                        }
                      >
                        {emp.obrigacoesAtrasadas}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={
                          emp.docsPendentes > 0 ? 'font-bold text-amber-600' : 'text-gray-400'
                        }
                      >
                        {emp.docsPendentes}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/empresas/${emp.empresaId}`}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        Ver detalhes →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {empresasFiltradas.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
              {empresasFiltradas.length} empresa(s) · Score médio:{' '}
              {Math.round(
                empresasFiltradas.reduce((s, e) => s + e.score, 0) / empresasFiltradas.length
              )}
            </div>
          )}
        </div>
      )}

      {/* Legenda */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-xs text-gray-500">
        <p className="font-semibold text-gray-700">Como o score é calculado</p>
        <p className="mt-1">
          Score = 100 − (alertas não lidos × 5, máx 30) − (obrigações atrasadas × 10, máx 40) −
          (documentos pendentes × 5, máx 20). Escala: Saudável (80–100) · Atenção (60–79) · Crítico
          (40–59) · Grave (0–39).
        </p>
      </div>
    </div>
  )
}
