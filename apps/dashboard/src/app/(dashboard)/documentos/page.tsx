'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Documento = {
  id: string
  tipo: string
  numero: string
  chaveAcesso?: string
  cnpjEmitente: string
  cnpjDestinatario?: string
  dataEmissao: string
  dataCompetencia: string
  valorTotal: string
  status: string
  empresaId: string
}

const STATUS_COR: Record<string, string> = {
  CONCILIADO: 'bg-green-100 text-green-700',
  PENDENTE_REVISAO: 'bg-yellow-100 text-yellow-700',
  PENDENTE: 'bg-slate-100 text-slate-600',
  REJEITADO: 'bg-red-100 text-red-700',
  CANCELADO: 'bg-gray-100 text-gray-500',
}

const TIPOS = ['TODOS', 'NFE', 'NFCE', 'NFSE_EMITIDA', 'NFSE_TOMADA']

export default function DocumentosPage() {
  const [competencia, setCompetencia] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [tipoFiltro, setTipoFiltro] = useState('TODOS')
  const [statusFiltro, setStatusFiltro] = useState('')
  const [busca, setBusca] = useState('')

  const { data: documentos = [], isLoading } = useQuery<Documento[]>({
    queryKey: ['documentos', competencia, tipoFiltro, statusFiltro],
    queryFn: () => {
      const params = new URLSearchParams({ competencia, limit: '200' })
      if (tipoFiltro !== 'TODOS') params.set('tipo', tipoFiltro)
      if (statusFiltro) params.set('status', statusFiltro)
      return api.get(`/documentos?${params}`).then((r) => r.data?.data ?? r.data)
    },
  })

  const filtrados = documentos.filter((d) => {
    if (!busca) return true
    const q = busca.toLowerCase()
    return (
      d.cnpjEmitente.includes(q) ||
      d.numero.toLowerCase().includes(q) ||
      (d.chaveAcesso ?? '').includes(q)
    )
  })

  const totais = {
    total: filtrados.length,
    conciliados: filtrados.filter((d) => d.status === 'CONCILIADO').length,
    pendentes: filtrados.filter((d) => d.status === 'PENDENTE' || d.status === 'PENDENTE_REVISAO').length,
    valorTotal: filtrados.reduce((s, d) => s + Number(d.valorTotal ?? 0), 0),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Documentos Fiscais</h1>
          <p className="text-slate-500 text-sm mt-1">NF-e, NFC-e, NFS-e emitidas e tomadas</p>
        </div>
        <input
          type="month"
          value={competencia}
          onChange={(e) => setCompetencia(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Total de documentos</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{totais.total}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Conciliados</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{totais.conciliados}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Pendentes / Revisão</p>
          <p className="text-3xl font-bold text-yellow-600 mt-1">{totais.pendentes}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Valor total</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totais.valorTotal)}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Buscar por CNPJ, número ou chave..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="flex-1 min-w-48 border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={tipoFiltro}
            onChange={(e) => setTipoFiltro(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>{t === 'TODOS' ? 'Todos os tipos' : t}</option>
            ))}
          </select>
          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos os status</option>
            <option value="CONCILIADO">Conciliado</option>
            <option value="PENDENTE">Pendente</option>
            <option value="PENDENTE_REVISAO">Pendente revisão</option>
            <option value="REJEITADO">Rejeitado</option>
          </select>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando documentos...</div>
        ) : filtrados.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            Nenhum documento encontrado para {competencia}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Tipo</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Número</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Emitente (CNPJ)</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Emissão</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Valor</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtrados.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                      {doc.tipo}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{doc.numero}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{doc.cnpjEmitente}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(doc.dataEmissao).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-800">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(doc.valorTotal))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COR[doc.status] ?? 'bg-slate-100 text-slate-500'}`}>
                      {doc.status.replace(/_/g, ' ')}
                    </span>
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
