'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  RefreshCw,
  CheckCircle,
  XCircle,
  Download,
  TrendingUp,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Empresa {
  id: string
  cnpj: string
  razaoSocial: string
  regime: string
}

interface ResultadoSpedContribuicoes {
  cnpj: string
  competencia: string
  regime: string
  totalDocumentos: number
  receitaBruta: string
  totalPIS: string
  totalCOFINS: string
  totalContribuicoes: string
  prazoEntrega: string
  conteudoSPED: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMoeda(valor: string | number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    typeof valor === 'string' ? parseFloat(valor) : valor
  )
}

function formatData(data: string) {
  const [ano, mes, dia] = data.split('-')
  return `${dia}/${mes}/${ano}`
}

function competenciaLabel(comp: string) {
  const [ano, mes] = comp.split('-')
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${nomes[parseInt(mes!) - 1]} / ${ano}`
}

function navComp(comp: string, delta: number): string {
  const [ano, mes] = comp.split('-').map(Number)
  const d = new Date(ano!, mes! - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function baixarSPED(conteudo: string, cnpj: string, competencia: string) {
  const blob = new Blob([conteudo], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `EFD-CONTRIBUICOES-${cnpj}-${competencia.replace('-', '')}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

function aliquotasPIS(regime: string) {
  return regime === 'LUCRO_PRESUMIDO' ? '0,65%' : '1,65%'
}

function aliquotasCOFINS(regime: string) {
  return regime === 'LUCRO_PRESUMIDO' ? '3,00%' : '7,60%'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SpedContribuicoesPage() {
  const hoje = new Date()
  const [competencia, setCompetencia] = useState(
    hoje.getMonth() === 0
      ? `${hoje.getFullYear() - 1}-12`
      : `${hoje.getFullYear()}-${String(hoje.getMonth()).padStart(2, '0')}`
  )
  const [empresaId, setEmpresaId] = useState('')
  const [resultado, setResultado] = useState<ResultadoSpedContribuicoes | null>(null)

  const { data: empresas = [] } = useQuery<Empresa[]>({
    queryKey: ['empresas-sped-contrib'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
    select: (data: Empresa[]) =>
      data.filter((e) => e.regime === 'LUCRO_PRESUMIDO' || e.regime === 'LUCRO_REAL'),
  })

  const gerar = useMutation({
    mutationFn: () =>
      api.post(`/fiscal/sped-contribuicoes/${empresaId}/${competencia}`).then((r) => r.data),
    onSuccess: (data: ResultadoSpedContribuicoes) => setResultado(data),
  })

  const empresa = empresas.find((e) => e.id === empresaId)

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">EFD Contribuições</h1>
          <p className="text-sm text-gray-500 mt-1">
            SPED PIS/COFINS — Lucro Presumido e Lucro Real
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 px-3 py-1.5 rounded-full">
          <FileText className="w-4 h-4" />
          Prazo: dia 10 do 2º mês seguinte
        </div>
      </div>

      {/* Alíquotas informativas */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">
            Lucro Presumido (Cumulativo)
          </p>
          <div className="flex gap-6">
            <div>
              <p className="text-xs text-blue-600">PIS</p>
              <p className="text-xl font-bold text-blue-800">0,65%</p>
            </div>
            <div>
              <p className="text-xs text-blue-600">COFINS</p>
              <p className="text-xl font-bold text-blue-800">3,00%</p>
            </div>
          </div>
          <p className="text-xs text-blue-500 mt-2">Sem aproveitamento de créditos</p>
        </div>
        <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
          <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-2">
            Lucro Real (Não-Cumulativo)
          </p>
          <div className="flex gap-6">
            <div>
              <p className="text-xs text-purple-600">PIS</p>
              <p className="text-xl font-bold text-purple-800">1,65%</p>
            </div>
            <div>
              <p className="text-xs text-purple-600">COFINS</p>
              <p className="text-xl font-bold text-purple-800">7,60%</p>
            </div>
          </div>
          <p className="text-xs text-purple-500 mt-2">Com aproveitamento de créditos</p>
        </div>
      </div>

      {/* Controles */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-wrap gap-4 items-end">
          {/* Navegação de competência */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Competência</label>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCompetencia(navComp(competencia, -1))}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="w-28 text-center font-semibold text-gray-800 text-sm">
                {competenciaLabel(competencia)}
              </span>
              <button
                onClick={() => setCompetencia(navComp(competencia, 1))}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Seletor de empresa */}
          <div className="flex flex-col gap-1 flex-1 min-w-48">
            <label className="text-xs font-medium text-gray-600">Empresa</label>
            <select
              value={empresaId}
              onChange={(e) => {
                setEmpresaId(e.target.value)
                setResultado(null)
              }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">Selecione uma empresa...</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.razaoSocial} —{' '}
                  {e.regime === 'LUCRO_PRESUMIDO' ? 'LP (0,65%/3%)' : 'LR (1,65%/7,6%)'}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => gerar.mutate()}
            disabled={!empresaId || gerar.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {gerar.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <TrendingUp className="w-4 h-4" />
            )}
            Gerar EFD Contribuições
          </button>
        </div>

        {gerar.isError && (
          <div className="mt-4 flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">
            <XCircle className="w-4 h-4 shrink-0" />
            {(gerar.error as Error)?.message ?? 'Erro ao gerar EFD Contribuições'}
          </div>
        )}
      </div>

      {/* Resultado */}
      {resultado && (
        <>
          {/* Cards de resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs text-gray-500 mb-1">Receita Bruta</p>
              <p className="text-lg font-bold text-gray-900">
                {formatMoeda(resultado.receitaBruta)}
              </p>
              <p className="text-xs text-gray-400">{resultado.totalDocumentos} doc(s)</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs text-gray-500 mb-1">PIS ({aliquotasPIS(resultado.regime)})</p>
              <p className="text-2xl font-bold text-blue-600">{formatMoeda(resultado.totalPIS)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs text-gray-500 mb-1">
                COFINS ({aliquotasCOFINS(resultado.regime)})
              </p>
              <p className="text-2xl font-bold text-purple-600">
                {formatMoeda(resultado.totalCOFINS)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs text-gray-500 mb-1">Total Contribuições</p>
              <p className="text-2xl font-bold text-red-600">
                {formatMoeda(resultado.totalContribuicoes)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Prazo: {formatData(resultado.prazoEntrega)}
              </p>
            </div>
          </div>

          {/* Arquivo SPED */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <h2 className="font-semibold text-gray-900">Arquivo EFD Gerado</h2>
              </div>
              <button
                onClick={() =>
                  baixarSPED(resultado.conteudoSPED, resultado.cnpj, resultado.competencia)
                }
                className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
              >
                <Download className="w-4 h-4" />
                Baixar .txt
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
              <div>
                <p className="text-gray-500">CNPJ</p>
                <p className="font-medium font-mono">{resultado.cnpj}</p>
              </div>
              <div>
                <p className="text-gray-500">Competência</p>
                <p className="font-medium">{competenciaLabel(resultado.competencia)}</p>
              </div>
              <div>
                <p className="text-gray-500">Regime</p>
                <p className="font-medium">
                  {resultado.regime === 'LUCRO_PRESUMIDO' ? 'Lucro Presumido' : 'Lucro Real'}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Linhas</p>
                <p className="font-medium">
                  {resultado.conteudoSPED.split('\r\n').filter(Boolean).length}
                </p>
              </div>
            </div>

            {/* Preview */}
            <div>
              <p className="text-xs text-gray-500 mb-2">Preview (primeiras 10 linhas)</p>
              <pre className="bg-gray-50 rounded-lg p-3 text-xs font-mono text-gray-700 overflow-x-auto max-h-40 overflow-y-auto">
                {resultado.conteudoSPED.split('\r\n').slice(0, 10).join('\n')}
              </pre>
            </div>
          </div>

          {/* Blocos do arquivo */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Estrutura do Arquivo</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {[
                { bloco: '0000', desc: 'Abertura e identificação', cor: 'blue' },
                { bloco: 'A100', desc: 'NFS-e emitidas', cor: 'green' },
                { bloco: 'C100', desc: 'NF-e e NFC-e emitidas', cor: 'indigo' },
                { bloco: 'M200/M600', desc: 'Apuração PIS e COFINS', cor: 'orange' },
              ].map(({ bloco, desc, cor }) => (
                <div key={bloco} className={`bg-${cor}-50 border border-${cor}-100 rounded-lg p-3`}>
                  <p className={`font-mono font-bold text-${cor}-700`}>{bloco}</p>
                  <p className={`text-xs text-${cor}-600 mt-0.5`}>{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Informativo */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <strong>Atenção:</strong> A EFD Contribuições deve ser transmitida ao SPED RFB até o dia
            10 do 2º mês seguinte à competência. Para Lucro Real, verifique créditos de PIS/COFINS
            que podem reduzir o valor a recolher.
          </div>
        </>
      )}

      {/* Estado vazio */}
      {!resultado && !gerar.isPending && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <TrendingUp className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">
            Selecione uma empresa LP/LR e clique em <strong>Gerar EFD Contribuições</strong> para
            apurar PIS e COFINS do período e gerar o arquivo SPED.
          </p>
        </div>
      )}
    </div>
  )
}
