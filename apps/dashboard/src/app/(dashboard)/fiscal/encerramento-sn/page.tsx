'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

function competenciaAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const fmt = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type PassosEncerramento = {
  pgdas: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
  difal: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
  icmsSt: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
  gnre: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
  destda: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
  dms: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
  efdReinf: 'OK' | 'ERRO' | 'NAO_APLICAVEL'
}

type ResultadoEncerramento = {
  empresaId: string
  cnpj: string
  competencia: string
  tipo: string
  passos: PassosEncerramento
  erros: string[]
  valorDAS: string
  valorGNRE: string
  valorISS: string
  totalObrigacoes: number
}

type ResultadoBatch = {
  total: number
  sucesso: number
  erros: number
  resultados: ResultadoEncerramento[]
}

const PASSOS_LABELS: Record<keyof PassosEncerramento, string> = {
  pgdas: 'PGDAS-D',
  difal: 'DIFAL',
  icmsSt: 'ICMS-ST',
  gnre: 'GNRE',
  destda: 'DeSTDA',
  dms: 'DMS / ISS',
  efdReinf: 'EFD-Reinf',
}

function passoBadge(status: 'OK' | 'ERRO' | 'NAO_APLICAVEL') {
  switch (status) {
    case 'OK':
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
          OK
        </span>
      )
    case 'ERRO':
      return (
        <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
          Erro
        </span>
      )
    case 'NAO_APLICAVEL':
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
          N/A
        </span>
      )
  }
}

export default function EncerramentoSNPage() {
  const queryClient = useQueryClient()
  const [empresaId, setEmpresaId] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAtual)
  const [resultado, setResultado] = useState<ResultadoEncerramento | null>(null)
  const [batchResultado, setBatchResultado] = useState<ResultadoBatch | null>(null)
  const [modo, setModo] = useState<'individual' | 'batch'>('individual')

  const { data: empresas } = useQuery({
    queryKey: ['empresas-all'],
    queryFn: () => api.get('/empresas').then((r) => r.data as any[]),
  })

  const encerrar = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/encerramento-sn/${empresaId}/${competencia}`)
        .then((r) => r.data as ResultadoEncerramento),
    onSuccess: (data) => {
      setResultado(data)
      setBatchResultado(null)
      queryClient.invalidateQueries({ queryKey: ['apuracoes', competencia] })
    },
  })

  const encerrarBatch = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/encerramento-sn/batch/${competencia}`)
        .then((r) => r.data as ResultadoBatch),
    onSuccess: (data) => {
      setBatchResultado(data)
      setResultado(null)
      queryClient.invalidateQueries({ queryKey: ['apuracoes', competencia] })
    },
  })

  const snEmpresas = (empresas ?? []).filter((e: any) => e.regime === 'SIMPLES_NACIONAL')

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Encerramento Simples Nacional</h1>
        <p className="mt-1 text-sm text-gray-500">
          Processo completo de fechamento mensal: PGDAS → DIFAL → ICMS-ST → GNRE → DeSTDA → DMS →
          EFD-Reinf.
        </p>
      </div>

      {/* Modo */}
      <div className="flex gap-2">
        <button
          onClick={() => setModo('individual')}
          className={`rounded px-4 py-2 text-sm font-medium transition-colors ${
            modo === 'individual'
              ? 'bg-blue-600 text-white'
              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          Empresa Individual
        </button>
        <button
          onClick={() => setModo('batch')}
          className={`rounded px-4 py-2 text-sm font-medium transition-colors ${
            modo === 'batch'
              ? 'bg-blue-600 text-white'
              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          Lote ({snEmpresas.length} empresas SN)
        </button>
      </div>

      {/* Controles */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          {modo === 'individual' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Empresa</label>
              <select
                value={empresaId}
                onChange={(e) => {
                  setEmpresaId(e.target.value)
                  setResultado(null)
                }}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecione…</option>
                {snEmpresas.map((emp: any) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.razaoSocial}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={modo === 'batch' ? 'sm:col-span-2' : ''}>
            <label className="mb-1 block text-sm font-medium text-gray-700">Competência</label>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-end">
            {modo === 'individual' ? (
              <button
                onClick={() => encerrar.mutate()}
                disabled={encerrar.isPending || !empresaId}
                className="w-full rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {encerrar.isPending ? 'Encerrando…' : 'Encerrar Competência'}
              </button>
            ) : (
              <button
                onClick={() => encerrarBatch.mutate()}
                disabled={encerrarBatch.isPending}
                className="w-full rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {encerrarBatch.isPending ? 'Processando…' : `Encerrar Lote — ${competencia}`}
              </button>
            )}
          </div>
        </div>
        {(encerrar.isError || encerrarBatch.isError) && (
          <p className="mt-3 text-sm text-red-600">Erro ao encerrar. Verifique os logs.</p>
        )}
      </div>

      {/* Info */}
      <div className="rounded-lg border border-green-100 bg-green-50 p-4 text-sm text-green-700">
        <p className="font-semibold">Fluxo de Encerramento SN</p>
        <p className="mt-1">
          O encerramento executa todas as obrigações do Simples Nacional em sequência: apura o PGDAS
          com segregação de receitas por anexo, calcula DIFAL e ICMS-ST para operações
          interestaduais, gera GNREs por UF, apura DeSTDA estadual, processa DMS municipal e encerra
          o EFD-Reinf. Cada etapa é executada somente se aplicável ao tipo de empresa (Comércio,
          Indústria, Serviços ou Misto).
        </p>
      </div>

      {/* Resultado individual */}
      {resultado && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-800">
              Resultado — {resultado.competencia}
            </h2>
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-gray-500">CNPJ</p>
                <p className="font-mono text-sm font-medium text-gray-900">{resultado.cnpj}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Tipo Empresa</p>
                <p className="font-semibold text-gray-900">{resultado.tipo}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Obrigações Geradas</p>
                <p className="text-2xl font-bold text-gray-900">{resultado.totalObrigacoes}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Status</p>
                <p
                  className={`text-sm font-semibold ${resultado.erros.length > 0 ? 'text-red-600' : 'text-green-600'}`}
                >
                  {resultado.erros.length > 0 ? `${resultado.erros.length} erro(s)` : 'Concluído'}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded bg-blue-50 p-3">
                <p className="text-xs text-blue-600">Valor DAS</p>
                <p className="text-xl font-bold text-blue-700">{fmt(resultado.valorDAS)}</p>
              </div>
              <div className="rounded bg-amber-50 p-3">
                <p className="text-xs text-amber-600">Valor GNRE</p>
                <p className="text-xl font-bold text-amber-700">{fmt(resultado.valorGNRE)}</p>
              </div>
              <div className="rounded bg-purple-50 p-3">
                <p className="text-xs text-purple-600">Valor ISS</p>
                <p className="text-xl font-bold text-purple-700">{fmt(resultado.valorISS)}</p>
              </div>
            </div>
          </div>

          {/* Passos */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-gray-800">Etapas do Encerramento</h3>
            <div className="grid gap-2 sm:grid-cols-4">
              {(Object.keys(resultado.passos) as (keyof PassosEncerramento)[]).map((k) => (
                <div
                  key={k}
                  className="flex items-center justify-between rounded bg-gray-50 px-3 py-2"
                >
                  <span className="text-xs font-medium text-gray-600">{PASSOS_LABELS[k]}</span>
                  {passoBadge(resultado.passos[k])}
                </div>
              ))}
            </div>
          </div>

          {resultado.erros.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <h3 className="mb-2 text-sm font-semibold text-red-800">Erros</h3>
              <ul className="space-y-1">
                {resultado.erros.map((e, i) => (
                  <li key={i} className="text-sm text-red-700">
                    • {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Resultado batch */}
      {batchResultado && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-800">
              Resultado Lote — {competencia}
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-gray-500">Total Processado</p>
                <p className="text-3xl font-bold text-gray-900">{batchResultado.total}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Sucesso</p>
                <p className="text-3xl font-bold text-green-600">{batchResultado.sucesso}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Com Erros</p>
                <p className="text-3xl font-bold text-red-600">{batchResultado.erros}</p>
              </div>
            </div>
          </div>

          {batchResultado.resultados.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-gray-800">Detalhe por Empresa</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">CNPJ</th>
                    <th className="px-4 py-2 text-left">Tipo</th>
                    <th className="px-4 py-2 text-right">DAS</th>
                    <th className="px-4 py-2 text-right">GNRE</th>
                    <th className="px-4 py-2 text-right">ISS</th>
                    <th className="px-4 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {batchResultado.resultados.map((r) => (
                    <tr key={r.empresaId} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs text-gray-600">{r.cnpj}</td>
                      <td className="px-4 py-2 text-gray-600">{r.tipo}</td>
                      <td className="px-4 py-2 text-right">{fmt(r.valorDAS)}</td>
                      <td className="px-4 py-2 text-right">{fmt(r.valorGNRE)}</td>
                      <td className="px-4 py-2 text-right">{fmt(r.valorISS)}</td>
                      <td className="px-4 py-2 text-center">
                        {r.erros.length > 0 ? (
                          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                            {r.erros.length} erro(s)
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
