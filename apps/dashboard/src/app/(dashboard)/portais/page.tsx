'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type PortalStatus = {
  portal: string
  label: string
  status: 'OK' | 'ERRO' | 'PENDENTE' | 'PROCESSANDO'
  ultimaVerificacao?: string
  mensagem?: string
}

type EmpresaOption = { id: string; razaoSocial: string; cnpj: string }

const PORTAL_ICONS: Record<string, string> = {
  SEFAZ_FEDERAL: '🏛️',
  SIMPLES_NACIONAL: '💰',
  ECAC: '📋',
  SEFAZ_ESTADUAL: '🗺️',
  PREFEITURA: '🏙️',
}

const STATUS_COR: Record<string, string> = {
  OK: 'bg-green-100 text-green-700',
  ERRO: 'bg-red-100 text-red-700',
  PENDENTE: 'bg-slate-100 text-slate-600',
  PROCESSANDO: 'bg-yellow-100 text-yellow-700',
}

export default function PortaisPage() {
  const qc = useQueryClient()
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const { data: empresas = [] } = useQuery<EmpresaOption[]>({
    queryKey: ['empresas-lista'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
  })

  const { data: portaisStatus = [], isLoading } = useQuery<PortalStatus[]>({
    queryKey: ['portais-status', empresaId],
    queryFn: () => api.get(`/portais/status/${empresaId}`).then((r) => r.data),
    enabled: !!empresaId,
    refetchInterval: 15000,
  })

  const sincronizarNFe = useMutation({
    mutationFn: () => api.post(`/documentos/capturar/${empresaId}/${competencia}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portais-status', empresaId] }),
  })

  const transmitirPGDAS = useMutation({
    mutationFn: () => api.post(`/fiscal/pgdas/transmitir/${empresaId}/${competencia}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portais-status', empresaId] }),
  })

  const sincronizarECAC = useMutation({
    mutationFn: () => api.post(`/portais/ecac/sincronizar/${empresaId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portais-status', empresaId] }),
  })

  const empresa = empresas.find((e) => e.id === empresaId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Portais Governamentais</h1>
          <p className="text-slate-500 text-sm mt-1">SEFAZ, Simples Nacional, e-CAC, Prefeitura</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-w-48"
          >
            <option value="">Selecionar empresa...</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.razaoSocial}</option>
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

      {!empresaId ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          Selecione uma empresa para ver o status dos portais.
        </div>
      ) : (
        <>
          {empresa && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">{empresa.razaoSocial}</h2>
                  <p className="font-mono text-sm text-slate-500 mt-0.5">{empresa.cnpj}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => sincronizarNFe.mutate()}
                    disabled={sincronizarNFe.isPending}
                    className="text-sm border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                  >
                    {sincronizarNFe.isPending ? 'Capturando...' : '📥 Capturar NF-e/NFC-e'}
                  </button>
                  <button
                    onClick={() => sincronizarECAC.mutate()}
                    disabled={sincronizarECAC.isPending}
                    className="text-sm border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                  >
                    {sincronizarECAC.isPending ? 'Sincronizando...' : '📋 Sincronizar e-CAC'}
                  </button>
                  <button
                    onClick={() => transmitirPGDAS.mutate()}
                    disabled={transmitirPGDAS.isPending}
                    className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {transmitirPGDAS.isPending ? 'Transmitindo...' : '💰 Transmitir PGDAS'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">
            {isLoading ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
                Verificando portais...
              </div>
            ) : portaisStatus.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
                Nenhum portal configurado para esta empresa.
              </div>
            ) : (
              portaisStatus.map((portal) => (
                <div key={portal.portal} className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{PORTAL_ICONS[portal.portal] ?? '🌐'}</span>
                      <div>
                        <h3 className="font-semibold text-slate-900">{portal.label}</h3>
                        {portal.mensagem && (
                          <p className="text-xs text-slate-500 mt-0.5">{portal.mensagem}</p>
                        )}
                        {portal.ultimaVerificacao && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            Última verificação: {new Date(portal.ultimaVerificacao).toLocaleString('pt-BR')}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_COR[portal.status] ?? 'bg-slate-100 text-slate-500'}`}>
                      {portal.status === 'OK' ? 'Operacional' :
                       portal.status === 'ERRO' ? 'Com erro' :
                       portal.status === 'PROCESSANDO' ? 'Processando...' :
                       'Pendente'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
