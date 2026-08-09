'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

function mesAnterior(comp: string): string {
  const [anoStr, mesStr] = comp.split('-')
  let ano = parseInt(anoStr!, 10)
  let mes = parseInt(mesStr!, 10) - 1
  if (mes < 1) {
    mes = 12
    ano -= 1
  }
  return `${ano}-${String(mes).padStart(2, '0')}`
}

function mesProximo(comp: string): string {
  const [anoStr, mesStr] = comp.split('-')
  let ano = parseInt(anoStr!, 10)
  let mes = parseInt(mesStr!, 10) + 1
  if (mes > 12) {
    mes = 1
    ano += 1
  }
  return `${ano}-${String(mes).padStart(2, '0')}`
}

function compAtual(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
}

function formatBRL(val: string | number | undefined): string {
  if (val === undefined || val === null) return 'R$ 0,00'
  const n = typeof val === 'string' ? parseFloat(val) : val
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function CreditosPisCofinslrPage() {
  const [competencia, setCompetencia] = useState(compAtual)
  const [empresaId, setEmpresaId] = useState('')

  const { data: empresas } = useQuery({
    queryKey: ['empresas-lr'],
    queryFn: () => api.get('/empresas?regime=LUCRO_REAL').then((r) => r.data),
  })

  const { data: resultado, refetch } = useQuery({
    queryKey: ['creditos-pis-cofins-lr', empresaId, competencia],
    queryFn: () =>
      api.get(`/fiscal/creditos-pis-cofins-lr/${empresaId}/${competencia}`).then((r) => r.data),
    enabled: !!empresaId,
  })

  const apurar = useMutation({
    mutationFn: () =>
      api.post(`/fiscal/creditos-pis-cofins-lr/${empresaId}/${competencia}`).then((r) => r.data),
    onSuccess: () => refetch(),
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Créditos PIS/COFINS — Lucro Real</h1>
        <p className="text-sm text-gray-500 mt-1">
          Regime não-cumulativo (Lei 10.637/2002 e Lei 10.833/2003) — PIS 1,65% / COFINS 7,6%
        </p>
      </div>

      {/* Informativo */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">Entradas com Crédito</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• Compras de mercadorias para revenda (CFOP 1101, 1102…)</li>
            <li>• Insumos da produção (CFOP 1111, 1113…)</li>
            <li>• Serviços tomados (CFOP 1933, 2933)</li>
            <li>• Energia elétrica (CFOP 1252, 2252)</li>
            <li>• Aluguéis e leasing (CFOP 1400, 2400)</li>
            <li>• Fretes (CFOP 1351, 2351)</li>
          </ul>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="font-semibold text-green-900 mb-2">Alíquotas de Crédito</h3>
          <div className="space-y-2 text-sm text-green-800">
            <div className="flex justify-between">
              <span>PIS (não-cumulativo)</span>
              <span className="font-bold">1,65%</span>
            </div>
            <div className="flex justify-between">
              <span>COFINS (não-cumulativo)</span>
              <span className="font-bold">7,60%</span>
            </div>
            <div className="flex justify-between border-t border-green-300 pt-2 mt-2">
              <span>Total combinado</span>
              <span className="font-bold">9,25%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Empresa (LR)</label>
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm w-72"
          >
            <option value="">Selecione uma empresa</option>
            {Array.isArray(empresas) &&
              empresas.map((emp: any) => (
                <option key={emp.id} value={emp.id}>
                  {emp.cnpj} — {emp.razaoSocial}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Competência</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCompetencia(mesAnterior(competencia))}
              className="px-2 py-2 border border-gray-300 rounded-md hover:bg-gray-50 text-sm"
            >
              ‹
            </button>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
            <button
              onClick={() => setCompetencia(mesProximo(competencia))}
              className="px-2 py-2 border border-gray-300 rounded-md hover:bg-gray-50 text-sm"
            >
              ›
            </button>
          </div>
        </div>
        <button
          onClick={() => apurar.mutate()}
          disabled={!empresaId || apurar.isPending}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
        >
          {apurar.isPending ? 'Apurando...' : 'Apurar Créditos'}
        </button>
      </div>

      {/* Resultado */}
      {resultado && (resultado as any).dados ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-sm text-gray-500">Base de Crédito</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {formatBRL((resultado as any).dados.totalBaseCredito)}
              </p>
              <p className="text-xs text-gray-400 mt-1">Valor total das entradas</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-600">Crédito PIS</p>
              <p className="text-xl font-bold text-blue-900 mt-1">
                {formatBRL((resultado as any).dados.creditoPIS)}
              </p>
              <p className="text-xs text-blue-400 mt-1">1,65% das entradas</p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <p className="text-sm text-purple-600">Crédito COFINS</p>
              <p className="text-xl font-bold text-purple-900 mt-1">
                {formatBRL((resultado as any).dados.creditoCOFINS)}
              </p>
              <p className="text-xs text-purple-400 mt-1">7,6% das entradas</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-600">Total Créditos</p>
              <p className="text-xl font-bold text-green-900 mt-1">
                {formatBRL(
                  (
                    parseFloat((resultado as any).dados.creditoPIS ?? '0') +
                    parseFloat((resultado as any).dados.creditoCOFINS ?? '0')
                  ).toString()
                )}
              </p>
              <p className="text-xs text-green-400 mt-1">PIS + COFINS</p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">
              Documentos processados:{' '}
              <span className="font-bold text-gray-900">
                {(resultado as any).dados.totalDocumentosEntrada ?? 0}
              </span>
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Regime: {(resultado as any).dados.regime} — apenas entradas com CFOP creditável
            </p>
          </div>
        </div>
      ) : apurar.isSuccess && apurar.data ? (
        <CreditosResultado data={apurar.data as any} />
      ) : (
        empresaId && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500">
            Nenhuma apuração encontrada para {competencia}. Clique em &quot;Apurar Créditos&quot;
            para calcular.
          </div>
        )
      )}
    </div>
  )
}

function CreditosResultado({ data }: { data: any }) {
  function fmt(val: any): string {
    const n = parseFloat(val?.toString() ?? '0')
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-500">Base de Crédito</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmt(data.totalBaseCredito)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.totalDocumentosEntrada} documentos</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-600">Crédito PIS</p>
          <p className="text-xl font-bold text-blue-900 mt-1">{fmt(data.totalCreditoPIS)}</p>
          <p className="text-xs text-blue-400 mt-1">1,65% não-cumulativo</p>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <p className="text-sm text-purple-600">Crédito COFINS</p>
          <p className="text-xl font-bold text-purple-900 mt-1">{fmt(data.totalCreditoCOFINS)}</p>
          <p className="text-xs text-purple-400 mt-1">7,6% não-cumulativo</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-600">Total Créditos</p>
          <p className="text-xl font-bold text-green-900 mt-1">
            {fmt(data.totalCreditosCombinados)}
          </p>
          <p className="text-xs text-green-400 mt-1">PIS + COFINS</p>
        </div>
      </div>

      {data.itens && data.itens.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">
              Documentos de Entrada ({data.itens.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Tipo</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Número</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">CFOP</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Valor Total</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Crédito PIS</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Crédito COFINS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.itens.map((item: any) => (
                  <tr key={item.documentoId} className="hover:bg-gray-50">
                    <td className="px-4 py-2">{item.tipo}</td>
                    <td className="px-4 py-2 font-mono text-xs">{item.numero}</td>
                    <td className="px-4 py-2">{item.cfop ?? '—'}</td>
                    <td className="px-4 py-2 text-right">{fmt(item.valorTotal)}</td>
                    <td className="px-4 py-2 text-right text-blue-700">{fmt(item.creditoPIS)}</td>
                    <td className="px-4 py-2 text-right text-purple-700">
                      {fmt(item.creditoCOFINS)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
