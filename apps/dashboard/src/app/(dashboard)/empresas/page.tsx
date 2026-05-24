'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'

type Empresa = {
  id: string
  cnpj: string
  razaoSocial: string
  nomeFantasia?: string
  regime: string
  uf: string
  municipio: string
  ativa: boolean
}

const REGIME_COR: Record<string, string> = {
  SIMPLES_NACIONAL: 'bg-green-100 text-green-800',
  MEI: 'bg-blue-100 text-blue-800',
  LUCRO_PRESUMIDO: 'bg-purple-100 text-purple-800',
  LUCRO_REAL: 'bg-orange-100 text-orange-800',
}

const REGIME_LABEL: Record<string, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  MEI: 'MEI',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
}

const REGIMES = ['TODOS', 'SIMPLES_NACIONAL', 'MEI', 'LUCRO_PRESUMIDO', 'LUCRO_REAL']

export default function EmpresasPage() {
  const [busca, setBusca] = useState('')
  const [regimeFiltro, setRegimeFiltro] = useState('TODOS')
  const [apenasAtivas, setApenasAtivas] = useState(true)

  const { data: empresas = [], isLoading } = useQuery<Empresa[]>({
    queryKey: ['empresas'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
  })

  const filtradas = useMemo(() => {
    return empresas.filter((e) => {
      if (apenasAtivas && !e.ativa) return false
      if (regimeFiltro !== 'TODOS' && e.regime !== regimeFiltro) return false
      if (busca) {
        const q = busca.toLowerCase()
        return (
          e.cnpj.includes(busca) ||
          e.razaoSocial.toLowerCase().includes(q) ||
          (e.nomeFantasia ?? '').toLowerCase().includes(q) ||
          e.municipio.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [empresas, busca, regimeFiltro, apenasAtivas])

  const stats = useMemo(() => {
    const total = empresas.length
    const ativas = empresas.filter((e) => e.ativa).length
    const por_regime = REGIMES.slice(1).map((r) => ({
      regime: r,
      count: empresas.filter((e) => e.regime === r).length,
    }))
    return { total, ativas, inativas: total - ativas, por_regime }
  }, [empresas])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Empresas</h1>
          <p className="text-slate-500 text-sm mt-1">Carteira de clientes do escritório</p>
        </div>
        <Link
          href="/empresas/nova"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm"
        >
          + Nova Empresa
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Total</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{stats.total}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Ativas</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{stats.ativas}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Simples Nacional</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">
            {stats.por_regime.find((r) => r.regime === 'SIMPLES_NACIONAL')?.count ?? 0}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">MEI</p>
          <p className="text-3xl font-bold text-purple-600 mt-1">
            {stats.por_regime.find((r) => r.regime === 'MEI')?.count ?? 0}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="p-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Buscar por CNPJ, razão social, município..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="flex-1 min-w-48 border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={regimeFiltro}
            onChange={(e) => setRegimeFiltro(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            {REGIMES.map((r) => (
              <option key={r} value={r}>{r === 'TODOS' ? 'Todos os regimes' : REGIME_LABEL[r]}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={apenasAtivas}
              onChange={(e) => setApenasAtivas(e.target.checked)}
              className="rounded"
            />
            Apenas ativas
          </label>
          {filtradas.length !== empresas.length && (
            <span className="text-xs text-slate-400">{filtradas.length} de {empresas.length}</span>
          )}
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando empresas...</div>
        ) : filtradas.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            {empresas.length === 0
              ? 'Nenhuma empresa cadastrada. Clique em "+ Nova Empresa" para começar.'
              : 'Nenhuma empresa encontrada com os filtros aplicados.'}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">CNPJ</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Razão Social</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Regime</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">UF / Município</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtradas.map((empresa) => (
                <tr key={empresa.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-mono text-sm text-slate-700">{empresa.cnpj}</td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-slate-900">{empresa.razaoSocial}</div>
                    {empresa.nomeFantasia && (
                      <div className="text-xs text-slate-400 mt-0.5">{empresa.nomeFantasia}</div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${REGIME_COR[empresa.regime] ?? 'bg-slate-100 text-slate-600'}`}>
                      {REGIME_LABEL[empresa.regime] ?? empresa.regime}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    <span className="font-semibold">{empresa.uf}</span>
                    <span className="text-slate-400"> · </span>
                    {empresa.municipio}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${empresa.ativa ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {empresa.ativa ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <Link
                      href={`/empresas/${empresa.id}`}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      Detalhes →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
