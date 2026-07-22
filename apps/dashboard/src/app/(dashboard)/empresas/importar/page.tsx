'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import Link from 'next/link'

type LinhaCSV = {
  cnpj: string
  razaoSocial: string
  nomeFantasia?: string
  regime: string
  cnae: string
  uf: string
  municipio: string
  ibge: string
  dataAbertura: string
}

type ResultadoImportacao = {
  total: number
  importadas: number
  rejeitadas: number
  criadas: { id: string; cnpj: string }[]
  erros: { linha: number; cnpj: string; motivo: string }[]
}

const COLUNAS = [
  'cnpj',
  'razaoSocial',
  'nomeFantasia',
  'regime',
  'cnae',
  'uf',
  'municipio',
  'ibge',
  'dataAbertura',
] as const

const MODELO_CSV = [
  'cnpj;razaoSocial;nomeFantasia;regime;cnae;uf;municipio;ibge;dataAbertura',
  '11222333000181;Empresa Exemplo Ltda;Exemplo;SIMPLES_NACIONAL;6201500;SP;São Paulo;3550308;2020-01-15',
].join('\n')

function parseCSV(texto: string): { linhas: LinhaCSV[]; erros: string[] } {
  const erros: string[] = []
  const linhasBrutas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (linhasBrutas.length < 2) {
    return {
      linhas: [],
      erros: ['Arquivo vazio ou sem linhas de dados (esperado: cabeçalho + dados)'],
    }
  }

  const cabecalho = linhasBrutas[0]
  const separador = cabecalho.includes(';') ? ';' : ','
  const nomes = cabecalho.split(separador).map((c) => c.trim())

  const faltantes = COLUNAS.filter((c) => c !== 'nomeFantasia' && !nomes.includes(c))
  if (faltantes.length > 0) {
    return {
      linhas: [],
      erros: [`Colunas obrigatórias ausentes no cabeçalho: ${faltantes.join(', ')}`],
    }
  }

  const linhas: LinhaCSV[] = []
  for (let i = 1; i < linhasBrutas.length; i++) {
    const valores = linhasBrutas[i].split(separador).map((v) => v.trim())
    if (valores.length !== nomes.length) {
      erros.push(
        `Linha ${i + 1}: número de colunas (${valores.length}) difere do cabeçalho (${nomes.length})`
      )
      continue
    }
    const registro: Record<string, string> = {}
    nomes.forEach((nome, idx) => {
      registro[nome] = valores[idx]
    })
    const linha: LinhaCSV = {
      cnpj: (registro.cnpj ?? '').replace(/\D/g, ''),
      razaoSocial: registro.razaoSocial ?? '',
      regime: registro.regime ?? '',
      cnae: (registro.cnae ?? '').replace(/\D/g, ''),
      uf: (registro.uf ?? '').toUpperCase(),
      municipio: registro.municipio ?? '',
      ibge: registro.ibge ?? '',
      dataAbertura: registro.dataAbertura ?? '',
    }
    if (registro.nomeFantasia) linha.nomeFantasia = registro.nomeFantasia
    linhas.push(linha)
  }

  return { linhas, erros }
}

export default function ImportarEmpresasPage() {
  const [linhas, setLinhas] = useState<LinhaCSV[]>([])
  const [errosParse, setErrosParse] = useState<string[]>([])
  const [nomeArquivo, setNomeArquivo] = useState('')
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null)
  const queryClient = useQueryClient()

  const importar = useMutation({
    mutationFn: (empresas: LinhaCSV[]) =>
      api.post('/empresas/importar', { empresas }).then((r) => r.data as ResultadoImportacao),
    onSuccess: (data) => {
      setResultado(data)
      queryClient.invalidateQueries({ queryKey: ['empresas'] })
    },
  })

  function handleArquivo(file: File | undefined) {
    if (!file) return
    setResultado(null)
    setNomeArquivo(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const { linhas: parsed, erros } = parseCSV(String(reader.result ?? ''))
      setLinhas(parsed)
      setErrosParse(erros)
    }
    reader.readAsText(file, 'utf-8')
  }

  function baixarModelo() {
    const blob = new Blob([MODELO_CSV], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'modelo-importacao-empresas.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Importar Empresas</h1>
          <p className="text-slate-500 text-sm mt-1">
            Importação em lote via CSV — até 1000 empresas por arquivo
          </p>
        </div>
        <Link href="/empresas" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
          ← Voltar para Empresas
        </Link>
      </div>

      {/* Instruções */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
        <p className="font-medium mb-1">Formato esperado</p>
        <p>
          CSV separado por <code className="bg-blue-100 px-1 rounded">;</code> ou{' '}
          <code className="bg-blue-100 px-1 rounded">,</code> com cabeçalho:{' '}
          <code className="bg-blue-100 px-1 rounded text-xs">
            cnpj;razaoSocial;nomeFantasia;regime;cnae;uf;municipio;ibge;dataAbertura
          </code>
        </p>
        <p className="mt-1">
          Regimes aceitos: SIMPLES_NACIONAL, MEI, LUCRO_PRESUMIDO, LUCRO_REAL · Data no formato
          AAAA-MM-DD
        </p>
        <button
          onClick={baixarModelo}
          className="mt-2 text-blue-700 underline hover:text-blue-900 font-medium"
        >
          Baixar modelo CSV
        </button>
      </div>

      {/* Upload */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Arquivo CSV</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => handleArquivo(e.target.files?.[0])}
            className="mt-2 block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-medium hover:file:bg-blue-700 file:cursor-pointer cursor-pointer"
          />
        </label>
        {nomeArquivo && (
          <p className="text-xs text-slate-400 mt-2">
            {nomeArquivo} — {linhas.length} linha(s) de dados
          </p>
        )}
      </div>

      {/* Erros de parse */}
      {errosParse.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          <p className="font-medium mb-1">Problemas no arquivo</p>
          <ul className="list-disc list-inside space-y-0.5">
            {errosParse.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Preview */}
      {linhas.length > 0 && !resultado && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">
              Pré-visualização ({Math.min(linhas.length, 10)} de {linhas.length})
            </p>
            <button
              onClick={() => importar.mutate(linhas)}
              disabled={importar.isPending || linhas.length > 1000}
              className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importar.isPending ? 'Importando...' : `Importar ${linhas.length} empresa(s)`}
            </button>
          </div>
          {linhas.length > 1000 && (
            <p className="px-4 py-2 text-xs text-red-600">
              Limite de 1000 empresas por importação — divida o arquivo.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">CNPJ</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                    Razão Social
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Regime</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">UF</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                    Município
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                    Abertura
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {linhas.slice(0, 10).map((l, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 font-mono text-xs">{l.cnpj}</td>
                    <td className="px-4 py-2">{l.razaoSocial}</td>
                    <td className="px-4 py-2 text-xs">{l.regime}</td>
                    <td className="px-4 py-2">{l.uf}</td>
                    <td className="px-4 py-2">{l.municipio}</td>
                    <td className="px-4 py-2 text-xs">{l.dataAbertura}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Erro da mutação */}
      {importar.isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Falha na importação:{' '}
          {(importar.error as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ?? 'erro inesperado — tente novamente'}
        </div>
      )}

      {/* Resultado */}
      {resultado && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Total no arquivo</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">{resultado.total}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Importadas</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{resultado.importadas}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Rejeitadas</p>
              <p className="text-3xl font-bold text-red-600 mt-1">{resultado.rejeitadas}</p>
            </div>
          </div>

          {resultado.erros.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200">
              <p className="p-4 border-b border-slate-100 text-sm font-medium text-slate-700">
                Linhas rejeitadas
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                        Linha
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                        CNPJ
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                        Motivo
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {resultado.erros.map((e, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2">{e.linha}</td>
                        <td className="px-4 py-2 font-mono text-xs">{e.cnpj}</td>
                        <td className="px-4 py-2 text-red-700">{e.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <Link
              href="/empresas"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm"
            >
              Ver empresas importadas
            </Link>
            <button
              onClick={() => {
                setResultado(null)
                setLinhas([])
                setNomeArquivo('')
                setErrosParse([])
              }}
              className="border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-medium hover:bg-slate-50 transition-colors text-sm"
            >
              Importar outro arquivo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
