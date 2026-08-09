'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

function formatBRL(val: string | number | undefined): string {
  if (val === undefined || val === null) return 'R$ 0,00'
  const n = typeof val === 'string' ? parseFloat(val) : val
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatPct(val: string | number | undefined): string {
  if (val === undefined || val === null) return '0,00%'
  const n = typeof val === 'string' ? parseFloat(val) : val
  return (n * 100).toFixed(2).replace('.', ',') + '%'
}

const REGIME_LABELS: Record<string, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
}

const REGIME_COLORS: Record<string, string> = {
  SIMPLES_NACIONAL: 'bg-blue-50 border-blue-200',
  LUCRO_PRESUMIDO: 'bg-purple-50 border-purple-200',
  LUCRO_REAL: 'bg-orange-50 border-orange-200',
}

type ResultadoRegime = {
  regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL'
  tributos: {
    irpj: string
    csll: string
    pis: string
    cofins: string
    das?: string
  }
  totalTributos: string
  cargaEfetiva: string
}

type ResultadoSimulacao = {
  receitaBrutaAnual: string
  atividade: string
  resultados: ResultadoRegime[]
  melhorRegime: string
  economiaAnual: string
}

export default function SimuladorTributarioPage() {
  const [receitaBruta, setReceitaBruta] = useState('500000')
  const [atividade, setAtividade] = useState('comercio')
  const [folha, setFolha] = useState('0')
  const [lucroEstimado, setLucroEstimado] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api
        .post('/fiscal/simulador-tributario', {
          receitaBrutaAnual: receitaBruta,
          atividade,
          folhaPagamentoAnual: folha || '0',
          ...(lucroEstimado ? { lucroEstimadoAnual: lucroEstimado } : {}),
        })
        .then((r) => r.data as ResultadoSimulacao),
  })

  const resultado = mutation.data

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Simulador Tributário</h1>
        <p className="mt-1 text-sm text-gray-500">
          Compare a carga fiscal estimada nos três regimes: Simples Nacional, Lucro Presumido e
          Lucro Real.
        </p>
      </div>

      {/* Formulário */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-800">Parâmetros</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Receita Bruta Anual (R$)
            </label>
            <input
              type="number"
              value={receitaBruta}
              onChange={(e) => setReceitaBruta(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0"
              step="1000"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Atividade</label>
            <select
              value={atividade}
              onChange={(e) => setAtividade(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="comercio">Comércio</option>
              <option value="industria">Indústria</option>
              <option value="servicos">Serviços</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Folha de Pagamento Anual (R$)
            </label>
            <input
              type="number"
              value={folha}
              onChange={(e) => setFolha(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0"
              step="1000"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Lucro Estimado Anual (R$) — opcional (LR)
            </label>
            <input
              type="number"
              value={lucroEstimado}
              onChange={(e) => setLucroEstimado(e.target.value)}
              placeholder="Padrão: 10% da receita"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0"
              step="1000"
            />
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !receitaBruta}
            className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Calculando…' : 'Simular'}
          </button>
        </div>
        {mutation.isError && (
          <p className="mt-2 text-sm text-red-600">Erro ao calcular. Verifique os dados.</p>
        )}
      </div>

      {/* Resultados */}
      {resultado && (
        <>
          {/* Destaque melhor regime */}
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="text-sm text-green-700">
              <span className="font-semibold">Melhor regime: </span>
              {REGIME_LABELS[resultado.melhorRegime] ?? resultado.melhorRegime}
              {' — '}
              <span className="font-semibold">Economia anual estimada: </span>
              {formatBRL(resultado.economiaAnual)}
            </p>
          </div>

          {/* Cards por regime */}
          <div className="grid gap-4 sm:grid-cols-3">
            {resultado.resultados.map((reg) => (
              <div
                key={reg.regime}
                className={`rounded-lg border p-4 ${REGIME_COLORS[reg.regime] ?? 'bg-gray-50 border-gray-200'} ${resultado.melhorRegime === reg.regime ? 'ring-2 ring-green-400' : ''}`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800">
                    {REGIME_LABELS[reg.regime] ?? reg.regime}
                  </h3>
                  {resultado.melhorRegime === reg.regime && (
                    <span className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white">
                      Melhor
                    </span>
                  )}
                </div>
                <div className="space-y-1 text-sm text-gray-700">
                  {reg.tributos.das && (
                    <div className="flex justify-between">
                      <span>DAS</span>
                      <span className="font-medium">{formatBRL(reg.tributos.das)}</span>
                    </div>
                  )}
                  {!reg.tributos.das && (
                    <>
                      <div className="flex justify-between">
                        <span>IRPJ</span>
                        <span className="font-medium">{formatBRL(reg.tributos.irpj)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>CSLL</span>
                        <span className="font-medium">{formatBRL(reg.tributos.csll)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>PIS</span>
                        <span className="font-medium">{formatBRL(reg.tributos.pis)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>COFINS</span>
                        <span className="font-medium">{formatBRL(reg.tributos.cofins)}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="mt-3 border-t border-current pt-2 opacity-60" />
                <div className="flex justify-between text-sm font-semibold text-gray-900">
                  <span>Total</span>
                  <span>{formatBRL(reg.totalTributos)}</span>
                </div>
                <div className="mt-1 text-center text-xs text-gray-500">
                  Carga efetiva: {formatPct(reg.cargaEfetiva)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
