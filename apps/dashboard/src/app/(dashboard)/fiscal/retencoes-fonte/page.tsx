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

function formatCNPJ(cnpj: string): string {
  if (!cnpj || cnpj === 'SEM_CNPJ') return cnpj ?? '—'
  const c = cnpj.replace(/\D/g, '')
  if (c.length !== 14) return cnpj
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
}

export default function RetencoesNaFontePage() {
  const [competencia, setCompetencia] = useState(compAtual)
  const [empresaId, setEmpresaId] = useState('')

  const { data: empresas } = useQuery({
    queryKey: ['empresas-lp-lr'],
    queryFn: () =>
      api
        .get('/empresas', { params: { regime: 'LUCRO_PRESUMIDO,LUCRO_REAL' } })
        .then((r) => r.data),
  })

  const { data: resultado, refetch } = useQuery({
    queryKey: ['retencoes-fonte', empresaId, competencia],
    queryFn: () =>
      api.get(`/fiscal/retencoes-fonte/${empresaId}/${competencia}`).then((r) => r.data),
    enabled: !!empresaId,
  })

  const apurar = useMutation({
    mutationFn: () =>
      api.post(`/fiscal/retencoes-fonte/${empresaId}/${competencia}`).then((r) => r.data),
    onSuccess: () => refetch(),
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Retenções na Fonte</h1>
        <p className="text-sm text-gray-500 mt-1">
          IRRF + CSRF (PIS/COFINS/CSLL) — Lei 10.833/2003, IN SRF 459/2004, Lei 9.430/96
        </p>
      </div>

      {/* Informativo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <h3 className="font-semibold text-orange-900 mb-2">IRRF sobre Serviços</h3>
          <div className="space-y-1 text-sm text-orange-800">
            <div className="flex justify-between">
              <span>Serviços profissionais</span>
              <span className="font-bold">1,5%</span>
            </div>
            <div className="flex justify-between">
              <span>Limpeza e conservação</span>
              <span className="font-bold">1,0%</span>
            </div>
            <div className="flex justify-between">
              <span>Transporte de cargas</span>
              <span className="font-bold">0,5%</span>
            </div>
          </div>
          <p className="text-xs text-orange-600 mt-2">Aplica-se a qualquer pagamento</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-semibold text-red-900 mb-2">CSRF — Limite R$ 5.000</h3>
          <div className="space-y-1 text-sm text-red-800">
            <div className="flex justify-between">
              <span>PIS</span>
              <span className="font-bold">0,65%</span>
            </div>
            <div className="flex justify-between">
              <span>COFINS</span>
              <span className="font-bold">3,00%</span>
            </div>
            <div className="flex justify-between">
              <span>CSLL</span>
              <span className="font-bold">1,00%</span>
            </div>
            <div className="flex justify-between border-t border-red-300 pt-1 mt-1">
              <span>Total CSRF</span>
              <span className="font-bold">4,65%</span>
            </div>
          </div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-900 mb-2">Prazo e Recolhimento</h3>
          <p className="text-sm text-yellow-800">
            DARF até o dia <span className="font-bold text-xl">20</span> do mês seguinte ao
            pagamento.
          </p>
          <p className="text-xs text-yellow-600 mt-2">Código DARF: 6147 (CSRF) / 1708 (IRRF)</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Empresa (LP ou LR)</label>
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm w-72"
          >
            <option value="">Selecione uma empresa</option>
            {Array.isArray(empresas) &&
              empresas.map((emp: any) => (
                <option key={emp.id} value={emp.id}>
                  {emp.cnpj} — {emp.razaoSocial} ({emp.regime === 'LUCRO_PRESUMIDO' ? 'LP' : 'LR'})
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
          className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50 text-sm font-medium"
        >
          {apurar.isPending ? 'Apurando...' : 'Apurar Retenções'}
        </button>
      </div>

      {/* Resultado da apuração direta */}
      {apurar.isSuccess && apurar.data ? (
        <RetencoesResultado data={apurar.data as any} />
      ) : resultado && (resultado as any).dados ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-sm text-gray-500">Total Pago</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {formatBRL((resultado as any).dados.totalIRRF)}
              </p>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <p className="text-sm text-orange-600">Total IRRF</p>
              <p className="text-xl font-bold text-orange-900 mt-1">
                {formatBRL((resultado as any).dados.totalIRRF)}
              </p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-600">Total CSRF</p>
              <p className="text-xl font-bold text-red-900 mt-1">
                {formatBRL(
                  (
                    parseFloat((resultado as any).dados.totalPIS ?? '0') +
                    parseFloat((resultado as any).dados.totalCOFINS ?? '0') +
                    parseFloat((resultado as any).dados.totalCSLL ?? '0')
                  ).toString()
                )}
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-sm text-gray-600">Total Retenções</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {formatBRL((resultado as any).dados.totalRetencoes)}
              </p>
            </div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-sm text-yellow-800">
              Prazo de recolhimento:{' '}
              <span className="font-bold">{(resultado as any).dados.prazoRecolhimento}</span>
            </p>
          </div>
        </div>
      ) : (
        empresaId && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500">
            Nenhuma apuração encontrada para {competencia}. Clique em &quot;Apurar Retenções&quot;
            para calcular.
          </div>
        )
      )}
    </div>
  )
}

function RetencoesResultado({ data }: { data: any }) {
  function fmt(val: any): string {
    const n = parseFloat(val?.toString() ?? '0')
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">Total Pago</p>
          <p className="text-base font-bold text-gray-900 mt-1">{fmt(data.totalPago)}</p>
          <p className="text-xs text-gray-400">{data.totalPrestadores} prestadores</p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
          <p className="text-xs text-orange-600">IRRF</p>
          <p className="text-base font-bold text-orange-900 mt-1">{fmt(data.totalIRRF)}</p>
          <p className="text-xs text-orange-400">1,5% padrão</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs text-blue-600">PIS Retido</p>
          <p className="text-base font-bold text-blue-900 mt-1">{fmt(data.totalPIS)}</p>
          <p className="text-xs text-blue-400">0,65% se &gt; R$5k</p>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <p className="text-xs text-purple-600">COFINS Retido</p>
          <p className="text-base font-bold text-purple-900 mt-1">{fmt(data.totalCOFINS)}</p>
          <p className="text-xs text-purple-400">3% se &gt; R$5k</p>
        </div>
        <div className="bg-pink-50 border border-pink-200 rounded-lg p-3">
          <p className="text-xs text-pink-600">CSLL Retido</p>
          <p className="text-base font-bold text-pink-900 mt-1">{fmt(data.totalCSLL)}</p>
          <p className="text-xs text-pink-400">1% se &gt; R$5k</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs text-red-600">Total a Recolher</p>
          <p className="text-base font-bold text-red-900 mt-1">{fmt(data.totalRetencoes)}</p>
          <p className="text-xs text-red-400">IRRF + CSRF</p>
        </div>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-yellow-900">Prazo de Recolhimento:</span>
          <span className="text-sm text-yellow-800 ml-2">{data.prazoRecolhimento}</span>
        </div>
        <div className="text-xs text-yellow-700">DARF: 6147 (CSRF) + 1708 (IRRF)</div>
      </div>

      {data.retencoesPorPrestador && data.retencoesPorPrestador.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">
              Retenções por Prestador ({data.retencoesPorPrestador.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">CNPJ Prestador</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Total Pago</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">IRRF</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">PIS</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">COFINS</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">CSLL</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Total</th>
                  <th className="px-3 py-2 text-center font-medium text-gray-600">Docs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.retencoesPorPrestador.map((p: any) => (
                  <tr key={p.cnpjPrestador} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs">{formatCNPJ(p.cnpjPrestador)}</td>
                    <td className="px-3 py-2 text-right">{fmt(p.totalPago)}</td>
                    <td className="px-3 py-2 text-right text-orange-700">{fmt(p.irrfRetido)}</td>
                    <td className="px-3 py-2 text-right text-blue-700">{fmt(p.pisRetido)}</td>
                    <td className="px-3 py-2 text-right text-purple-700">{fmt(p.cofinsRetido)}</td>
                    <td className="px-3 py-2 text-right text-pink-700">{fmt(p.csllRetido)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-red-700">
                      {fmt(p.totalRetencoes)}
                    </td>
                    <td className="px-3 py-2 text-center text-gray-500 text-xs">
                      {p.documentos?.length ?? 0}
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
