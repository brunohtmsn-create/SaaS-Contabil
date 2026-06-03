'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

function anoAtual(): string {
  return String(new Date().getFullYear())
}

function formatBRL(val: string | number | undefined): string {
  if (val === undefined || val === null) return 'R$ 0,00'
  const n = typeof val === 'string' ? parseFloat(val) : val
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const BADGE_SITUACAO: Record<string, { label: string; cls: string }> = {
  COMPLEMENTAR: {
    label: 'Complementar',
    cls: 'bg-red-100 text-red-800 border border-red-200',
  },
  CREDITO: {
    label: 'Crédito a favor',
    cls: 'bg-green-100 text-green-800 border border-green-200',
  },
  QUITADO: { label: 'Quitado', cls: 'bg-gray-100 text-gray-700 border border-gray-200' },
}

export default function AjusteAnualLRPage() {
  const [ano, setAno] = useState(anoAtual)
  const [empresaId, setEmpresaId] = useState('')
  const [form, setForm] = useState({
    lucroRealAnual: '',
    adicoesLALUR: '',
    exclusoesLALUR: '',
  })

  const { data: empresas } = useQuery({
    queryKey: ['empresas-lr'],
    queryFn: () => api.get('/empresas?regime=LUCRO_REAL').then((r) => r.data),
  })

  const { data: resultado, refetch } = useQuery({
    queryKey: ['ajuste-anual-lr', empresaId, ano],
    queryFn: () => api.get(`/fiscal/ajuste-anual-lr/${empresaId}/${ano}`).then((r) => r.data),
    enabled: !!empresaId,
  })

  const apurar = useMutation({
    mutationFn: () =>
      api
        .post(`/fiscal/ajuste-anual-lr/${empresaId}/${ano}`, {
          lucroRealAnual: form.lucroRealAnual || '0',
          adicoesLALUR: form.adicoesLALUR || '0',
          exclusoesLALUR: form.exclusoesLALUR || '0',
        })
        .then((r) => r.data),
    onSuccess: () => refetch(),
  })

  const res = (apurar.isSuccess && apurar.data ? apurar.data : resultado) as any

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ajuste Anual IRPJ/CSLL — Lucro Real</h1>
        <p className="text-sm text-gray-500 mt-1">
          Lei 9.430/96 — Reconciliação anual: estimativas mensais pagas × imposto definitivo do
          balanço de 31/12
        </p>
      </div>

      {/* Informativo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">IRPJ Anual</h3>
          <div className="space-y-1 text-sm text-blue-800">
            <div className="flex justify-between">
              <span>Alíquota base</span>
              <span className="font-bold">15%</span>
            </div>
            <div className="flex justify-between">
              <span>Adicional (base &gt; R$240k)</span>
              <span className="font-bold">10%</span>
            </div>
          </div>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h3 className="font-semibold text-purple-900 mb-2">CSLL Anual</h3>
          <div className="space-y-1 text-sm text-purple-800">
            <div className="flex justify-between">
              <span>Alíquota única</span>
              <span className="font-bold">9%</span>
            </div>
          </div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-900 mb-2">Prazo Complementar</h3>
          <p className="text-sm text-yellow-800">
            DARF até <span className="font-bold">31/03</span> do ano seguinte
          </p>
          <p className="text-xs text-yellow-600 mt-1">Saldo negativo = crédito aproveitável</p>
        </div>
      </div>

      {/* Filtros + Formulário LALUR */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Ano-calendário</label>
            <input
              type="number"
              value={ano}
              onChange={(e) => setAno(e.target.value)}
              min="2000"
              max="2099"
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-28"
            />
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm font-medium text-gray-700 mb-3">
            Dados do LALUR (Lucro Real Anual)
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Lucro Contábil Ajustado (R$)
              </label>
              <input
                type="number"
                step="0.01"
                value={form.lucroRealAnual}
                onChange={(e) => setForm((f) => ({ ...f, lucroRealAnual: e.target.value }))}
                placeholder="0.00"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Adições ao LALUR (R$)</label>
              <input
                type="number"
                step="0.01"
                value={form.adicoesLALUR}
                onChange={(e) => setForm((f) => ({ ...f, adicoesLALUR: e.target.value }))}
                placeholder="0.00"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Exclusões do LALUR (R$)</label>
              <input
                type="number"
                step="0.01"
                value={form.exclusoesLALUR}
                onChange={(e) => setForm((f) => ({ ...f, exclusoesLALUR: e.target.value }))}
                placeholder="0.00"
                className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full"
              />
            </div>
          </div>
        </div>

        <div>
          <button
            onClick={() => apurar.mutate()}
            disabled={!empresaId || apurar.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {apurar.isPending ? 'Calculando...' : 'Calcular Ajuste Anual'}
          </button>
        </div>
      </div>

      {/* Resultado */}
      {res && !res.error && (
        <div className="space-y-4">
          {/* Cards principais */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-sm text-gray-500">Lucro Real Anual</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {formatBRL(res.lucroRealAnual ?? res.dados?.lucroRealAnual)}
              </p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-600">IRPJ Total Devido</p>
              <p className="text-xl font-bold text-blue-900 mt-1">
                {formatBRL(res.irpjTotal ?? res.dados?.irpjTotal)}
              </p>
              {(res.irpjAdicional || res.dados?.irpjAdicional) && (
                <p className="text-xs text-blue-500 mt-1">
                  Incl. adicional {formatBRL(res.irpjAdicional ?? res.dados?.irpjAdicional)}
                </p>
              )}
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <p className="text-sm text-purple-600">CSLL Devida</p>
              <p className="text-xl font-bold text-purple-900 mt-1">
                {formatBRL(res.csllDevida ?? res.dados?.csllDevida)}
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-sm text-gray-600">Estimativas Pagas</p>
              <p className="text-xl font-bold text-gray-900 mt-1">
                {formatBRL(
                  String(
                    parseFloat(res.totalEstimativasIRPJ ?? '0') +
                      parseFloat(res.totalEstimativasCSLL ?? '0')
                  )
                )}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {res.estimativasPorMes?.length ?? 0} estimativas
              </p>
            </div>
          </div>

          {/* Saldo */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Saldo IRPJ</p>
                {(res.situacaoIRPJ ?? res.dados?.situacaoIRPJ) && (
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${
                      BADGE_SITUACAO[res.situacaoIRPJ ?? res.dados?.situacaoIRPJ]?.cls ?? ''
                    }`}
                  >
                    {BADGE_SITUACAO[res.situacaoIRPJ ?? res.dados?.situacaoIRPJ]?.label}
                  </span>
                )}
              </div>
              <p
                className={`text-2xl font-bold ${
                  parseFloat(res.saldoIRPJ ?? res.dados?.saldoIRPJ ?? '0') > 0
                    ? 'text-red-700'
                    : parseFloat(res.saldoIRPJ ?? res.dados?.saldoIRPJ ?? '0') < 0
                      ? 'text-green-700'
                      : 'text-gray-700'
                }`}
              >
                {formatBRL(res.saldoIRPJ ?? res.dados?.saldoIRPJ)}
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">Saldo CSLL</p>
                {(res.situacaoCSLL ?? res.dados?.situacaoCSLL) && (
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${
                      BADGE_SITUACAO[res.situacaoCSLL ?? res.dados?.situacaoCSLL]?.cls ?? ''
                    }`}
                  >
                    {BADGE_SITUACAO[res.situacaoCSLL ?? res.dados?.situacaoCSLL]?.label}
                  </span>
                )}
              </div>
              <p
                className={`text-2xl font-bold ${
                  parseFloat(res.saldoCSLL ?? res.dados?.saldoCSLL ?? '0') > 0
                    ? 'text-red-700'
                    : parseFloat(res.saldoCSLL ?? res.dados?.saldoCSLL ?? '0') < 0
                      ? 'text-green-700'
                      : 'text-gray-700'
                }`}
              >
                {formatBRL(res.saldoCSLL ?? res.dados?.saldoCSLL)}
              </p>
            </div>
          </div>

          {/* Prazo */}
          {(res.prazoComplementar ?? res.dados?.prazoComplementar) && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-sm text-yellow-800">
                Prazo para DARF complementar:{' '}
                <span className="font-bold">
                  {res.prazoComplementar ?? res.dados?.prazoComplementar}
                </span>
              </p>
            </div>
          )}

          {/* Tabela de estimativas mensais */}
          {res.estimativasPorMes && res.estimativasPorMes.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900">
                  Estimativas Mensais Pagas ({res.estimativasPorMes.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Competência</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">IRPJ Pago</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">CSLL Paga</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {res.estimativasPorMes.map((m: any) => (
                      <tr key={m.competencia} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono">{m.competencia}</td>
                        <td className="px-4 py-2 text-right text-blue-700">
                          {formatBRL(m.irpjPago)}
                        </td>
                        <td className="px-4 py-2 text-right text-purple-700">
                          {formatBRL(m.csllPago)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!res && empresaId && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500">
          Nenhum ajuste encontrado para {ano}. Informe o lucro real e clique em &quot;Calcular
          Ajuste Anual&quot;.
        </div>
      )}
    </div>
  )
}
