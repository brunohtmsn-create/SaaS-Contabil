'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

function competenciaAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const fmt = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type EventoReinf = {
  tipo: string
  status: string
  protocoloEnvio?: string
  recibo?: string
  dataEnvio?: string
  totalRetencoes?: string
  totalContribuicoes?: string
}

type ResultadoReinf = {
  cnpj: string
  razaoSocial: string
  competencia: string
  eventos: EventoReinf[]
  totalRetencoes: string
  totalContribuicoes: string
  fechado: boolean
  recibo2099?: string
}

const STATUS_BADGE: Record<string, string> = {
  ENVIADO: 'bg-green-100 text-green-800 border border-green-200',
  PENDENTE: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
  ERRO: 'bg-red-100 text-red-800 border border-red-200',
  AGUARDANDO: 'bg-blue-100 text-blue-800 border border-blue-200',
}

const EVENTOS_REINF = [
  { tipo: 'R-2010', desc: 'Serviços Tomados com Retenção' },
  { tipo: 'R-2020', desc: 'Serviços Prestados com Retenção' },
  { tipo: 'R-4010', desc: 'Pagamentos a Beneficiários PF' },
  { tipo: 'R-4020', desc: 'Pagamentos a Beneficiários PJ' },
  { tipo: 'R-4080', desc: 'Retenções na Fonte' },
  { tipo: 'R-2099', desc: 'Fechamento dos Eventos Periódicos' },
  { tipo: 'R-4099', desc: 'Fechamento dos Eventos de Retenção' },
]

export default function EFDReinfPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [resultado, setResultado] = useState<ResultadoReinf | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const processar = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/efdreinf/${empresaId}/${competencia}`)
        .then((r) => r.data as ResultadoReinf),
    onSuccess: (data) => setResultado(data),
  })

  const consultar = useMutation({
    mutationFn: () =>
      api.get(`/fiscal/efdreinf/${empresaId}/${competencia}`).then((r) => r.data as ResultadoReinf),
    onSuccess: (data) => setResultado(data),
  })

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">EFD-Reinf</h1>
        <p className="mt-1 text-sm text-gray-500">
          Escrituração Fiscal Digital de Retenções e Outras Informações Fiscais — eventos R-2010,
          R-2020, R-4010, R-4020, R-4080, R-2099/R-4099.
        </p>
      </div>

      {/* Seleção */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Empresa</label>
            <select
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="">Selecione…</option>
              {(empresas ?? []).map((emp: any) => (
                <option key={emp.id} value={emp.id}>
                  {emp.razaoSocial}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Competência</label>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={() => consultar.mutate()}
              disabled={consultar.isPending || !empresaId}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {consultar.isPending ? 'Consultando…' : 'Consultar'}
            </button>
            <button
              onClick={() => processar.mutate()}
              disabled={processar.isPending || !empresaId}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {processar.isPending ? 'Processando…' : 'Processar EFD-Reinf'}
            </button>
          </div>
        </div>
      </div>

      {/* Checklist de eventos */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-800">Eventos EFD-Reinf</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Evento</th>
              <th className="px-4 py-2 text-left">Descrição</th>
              <th className="px-4 py-2 text-center">Status</th>
              <th className="px-4 py-2 text-right">Retenções</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {EVENTOS_REINF.map((ev) => {
              const evento = resultado?.eventos?.find((e) => e.tipo === ev.tipo)
              const badgeCls = evento
                ? (STATUS_BADGE[evento.status] ?? STATUS_BADGE['PENDENTE'])
                : 'bg-gray-100 text-gray-400 border border-gray-200'
              return (
                <tr key={ev.tipo} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono font-semibold text-gray-800">{ev.tipo}</td>
                  <td className="px-4 py-2 text-gray-600">{ev.desc}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeCls}`}>
                      {evento?.status ?? 'Não enviado'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-gray-700">
                    {evento?.totalRetencoes ? fmt(evento.totalRetencoes) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {resultado && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Total Retenções</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {fmt(resultado.totalRetencoes)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Total Contribuições</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {fmt(resultado.totalContribuicoes)}
              </p>
            </div>
            <div
              className={`rounded-lg border p-4 shadow-sm ${resultado.fechado ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'}`}
            >
              <p className={`text-xs ${resultado.fechado ? 'text-green-600' : 'text-yellow-600'}`}>
                Status Fechamento
              </p>
              <p
                className={`mt-1 text-xl font-bold ${resultado.fechado ? 'text-green-700' : 'text-yellow-700'}`}
              >
                {resultado.fechado ? 'Fechado' : 'Pendente'}
              </p>
              {resultado.recibo2099 && (
                <p className="mt-1 text-xs text-green-600">Recibo: {resultado.recibo2099}</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
