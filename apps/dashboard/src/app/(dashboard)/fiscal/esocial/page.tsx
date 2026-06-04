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

type EventoESocial = {
  tipo: string
  status: string
  recibo?: string
  dataEnvio?: string
  nrInscricao?: string
  totalRemun?: string
}

type ResultadoESocial = {
  cnpj: string
  razaoSocial: string
  competencia: string
  eventos: EventoESocial[]
  totalRemuneracao: string
  totalINSS: string
  totalIRRF: string
  fechado: boolean
}

const STATUS_BADGE: Record<string, string> = {
  ENVIADO: 'bg-green-100 text-green-800 border border-green-200',
  PENDENTE: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
  ERRO: 'bg-red-100 text-red-800 border border-red-200',
  PROCESSANDO: 'bg-blue-100 text-blue-800 border border-blue-200',
}

const EVENTOS_ESOCIAL = [
  { tipo: 'S-1200', desc: 'Remuneração do trabalhador vinculado ao RGPS' },
  { tipo: 'S-1210', desc: 'Pagamentos de rendimentos do trabalho' },
  { tipo: 'S-1299', desc: 'Fechamento dos eventos periódicos' },
]

export default function ESocialPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [resultado, setResultado] = useState<ResultadoESocial | null>(null)

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const processar = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/esocial/${empresaId}/${competencia}`)
        .then((r) => r.data as ResultadoESocial),
    onSuccess: (data) => setResultado(data),
  })

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">eSocial</h1>
        <p className="mt-1 text-sm text-gray-500">
          Sistema de Escrituração Digital das Obrigações Fiscais, Previdenciárias e Trabalhistas —
          eventos S-1200, S-1210 e S-1299.
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
          <div className="flex items-end">
            <button
              onClick={() => processar.mutate()}
              disabled={processar.isPending || !empresaId}
              className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {processar.isPending ? 'Processando…' : 'Processar eSocial'}
            </button>
          </div>
        </div>
        {processar.isError && (
          <p className="mt-2 text-sm text-red-600">
            Erro ao processar eSocial. Verifique se a empresa possui empregados no período.
          </p>
        )}
      </div>

      {/* Info */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        <p className="font-semibold">Pré-requisitos</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>Empresa deve ter empregados registrados no período</li>
          <li>Folha de pagamento calculada (salários, horas extras, benefícios)</li>
          <li>Certificado digital A1/A3 configurado em Credenciais</li>
        </ul>
      </div>

      {/* Tabela de eventos */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-800">Eventos eSocial</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Evento</th>
              <th className="px-4 py-2 text-left">Descrição</th>
              <th className="px-4 py-2 text-center">Status</th>
              <th className="px-4 py-2 text-right">Remuneração</th>
              <th className="px-4 py-2 text-left">Recibo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {EVENTOS_ESOCIAL.map((ev) => {
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
                  <td className="px-4 py-2 text-right text-gray-700">
                    {evento?.totalRemun ? fmt(evento.totalRemun) : '—'}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-400">
                    {evento?.recibo ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {resultado && (
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">Total Remuneração</p>
            <p className="mt-1 text-xl font-bold text-gray-900">
              {fmt(resultado.totalRemuneracao)}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">INSS Patronal</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{fmt(resultado.totalINSS)}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500">IRRF</p>
            <p className="mt-1 text-xl font-bold text-gray-900">{fmt(resultado.totalIRRF)}</p>
          </div>
          <div
            className={`rounded-lg border p-4 shadow-sm ${resultado.fechado ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'}`}
          >
            <p className={`text-xs ${resultado.fechado ? 'text-green-600' : 'text-yellow-600'}`}>
              S-1299
            </p>
            <p
              className={`mt-1 text-xl font-bold ${resultado.fechado ? 'text-green-700' : 'text-yellow-700'}`}
            >
              {resultado.fechado ? 'Fechado' : 'Pendente'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
