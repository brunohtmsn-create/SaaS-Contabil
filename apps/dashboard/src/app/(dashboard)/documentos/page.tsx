'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Documento = {
  id: string
  tipo: string
  numero: string
  chaveAcesso?: string
  cnpjEmitente: string
  cnpjDestinatario?: string
  dataEmissao: string
  dataCompetencia: string
  valorTotal: string
  status: string
  empresaId: string
}

type Empresa = { id: string; razaoSocial: string; cnpj: string }

const STATUS_COR: Record<string, string> = {
  CONCILIADO: 'bg-green-100 text-green-700',
  PENDENTE_REVISAO: 'bg-yellow-100 text-yellow-700',
  NORMALIZADO: 'bg-slate-100 text-slate-600',
  PENDENTE: 'bg-slate-100 text-slate-600',
  DIVERGENTE: 'bg-red-100 text-red-700',
  CANCELADO: 'bg-gray-100 text-gray-500',
}

const TIPOS = ['TODOS', 'NFE', 'NFCE', 'NFSE_EMITIDA', 'NFSE_TOMADA']

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export default function DocumentosPage() {
  const qc = useQueryClient()
  const [competencia, setCompetencia] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [tipoFiltro, setTipoFiltro] = useState('TODOS')
  const [statusFiltro, setStatusFiltro] = useState('')
  const [busca, setBusca] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [uploadEmpresaId, setUploadEmpresaId] = useState('')
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploadResults, setUploadResults] = useState<{ name: string; ok: boolean; msg: string }[]>(
    []
  )
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: documentos = [], isLoading } = useQuery<Documento[]>({
    queryKey: ['documentos', competencia, tipoFiltro, statusFiltro],
    queryFn: () => {
      const params = new URLSearchParams({ competencia, limit: '200' })
      if (tipoFiltro !== 'TODOS') params.set('tipo', tipoFiltro)
      if (statusFiltro) params.set('status', statusFiltro)
      return api.get(`/documentos?${params}`).then((r) => r.data?.data ?? r.data)
    },
  })

  const { data: empresas = [] } = useQuery<Empresa[]>({
    queryKey: ['empresas-lista'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
  })

  const atualizarStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/documentos/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documentos'] }),
  })

  const filtrados = documentos.filter((d) => {
    if (!busca) return true
    const q = busca.toLowerCase()
    return (
      d.cnpjEmitente.includes(q) ||
      d.numero.toLowerCase().includes(q) ||
      (d.chaveAcesso ?? '').includes(q)
    )
  })

  const totais = {
    total: filtrados.length,
    conciliados: filtrados.filter((d) => d.status === 'CONCILIADO').length,
    pendentes: filtrados.filter(
      (d) =>
        d.status === 'PENDENTE' || d.status === 'PENDENTE_REVISAO' || d.status === 'NORMALIZADO'
    ).length,
    valorTotal: filtrados.reduce((s, d) => s + Number(d.valorTotal ?? 0), 0),
  }

  async function handleUpload() {
    if (!uploadEmpresaId || uploadFiles.length === 0) return
    setUploading(true)
    setUploadResults([])
    const results: { name: string; ok: boolean; msg: string }[] = []

    for (const file of uploadFiles) {
      try {
        const form = new FormData()
        form.append('empresaId', uploadEmpresaId)
        form.append('xml', file)
        await api.post('/documentos/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        results.push({ name: file.name, ok: true, msg: 'Importado com sucesso' })
      } catch (err: any) {
        const msg = err.response?.data?.error ?? err.message ?? 'Erro desconhecido'
        results.push({ name: file.name, ok: false, msg })
      }
    }

    setUploadResults(results)
    setUploading(false)
    qc.invalidateQueries({ queryKey: ['documentos'] })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Documentos Fiscais</h1>
          <p className="text-slate-500 text-sm mt-1">NF-e, NFC-e, NFS-e emitidas e tomadas</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setShowUpload(true)
              setUploadResults([])
            }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Importar XML
          </button>
          <input
            type="month"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Modal upload */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Importar XML manualmente</h2>
              <button
                onClick={() => setShowUpload(false)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Empresa</label>
                <select
                  value={uploadEmpresaId}
                  onChange={(e) => setUploadEmpresaId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Selecione a empresa</option>
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.razaoSocial} ({e.cnpj})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Arquivos XML
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
                >
                  {uploadFiles.length > 0 ? (
                    <div className="text-sm text-slate-700">
                      {uploadFiles.length} arquivo(s) selecionado(s)
                      <div className="mt-1 text-slate-400 text-xs">
                        {uploadFiles.map((f) => f.name).join(', ')}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">
                      Clique para selecionar arquivos XML (NF-e, NFC-e, NFS-e)
                    </p>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xml"
                  multiple
                  className="hidden"
                  onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))}
                />
              </div>
            </div>

            {uploadResults.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-auto">
                {uploadResults.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded ${r.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
                  >
                    <span>{r.ok ? '✓' : '✗'}</span>
                    <span className="font-mono truncate">{r.name}</span>
                    <span className="ml-auto shrink-0">{r.msg}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowUpload(false)}
                className="text-sm text-slate-600 hover:text-slate-900 px-4 py-2"
              >
                Fechar
              </button>
              <button
                onClick={handleUpload}
                disabled={!uploadEmpresaId || uploadFiles.length === 0 || uploading}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg"
              >
                {uploading
                  ? 'Importando...'
                  : `Importar ${uploadFiles.length > 1 ? `${uploadFiles.length} arquivos` : 'arquivo'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Total de documentos</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{totais.total}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Conciliados</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{totais.conciliados}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Pendentes / Revisão</p>
          <p className="text-3xl font-bold text-yellow-600 mt-1">{totais.pendentes}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Valor total</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{fmt.format(totais.valorTotal)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Buscar por CNPJ, número ou chave..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="flex-1 min-w-48 border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={tipoFiltro}
            onChange={(e) => setTipoFiltro(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t === 'TODOS' ? 'Todos os tipos' : t}
              </option>
            ))}
          </select>
          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos os status</option>
            <option value="CONCILIADO">Conciliado</option>
            <option value="NORMALIZADO">Normalizado</option>
            <option value="PENDENTE_REVISAO">Pendente revisão</option>
            <option value="DIVERGENTE">Divergente</option>
          </select>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando documentos...</div>
        ) : filtrados.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            Nenhum documento encontrado para {competencia}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Tipo
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Número
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Emitente (CNPJ)
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Emissão
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">
                  Valor
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">
                  Ação
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtrados.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                      {doc.tipo}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{doc.numero}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{doc.cnpjEmitente}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(doc.dataEmissao).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-800">
                    {fmt.format(Number(doc.valorTotal))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COR[doc.status] ?? 'bg-slate-100 text-slate-500'}`}
                    >
                      {doc.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {(doc.status === 'PENDENTE_REVISAO' || doc.status === 'NORMALIZADO') && (
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() =>
                            atualizarStatus.mutate({ id: doc.id, status: 'CONCILIADO' })
                          }
                          className="text-xs bg-green-50 hover:bg-green-100 text-green-700 px-2 py-1 rounded"
                        >
                          Aprovar
                        </button>
                        <button
                          onClick={() =>
                            atualizarStatus.mutate({ id: doc.id, status: 'DIVERGENTE' })
                          }
                          className="text-xs bg-red-50 hover:bg-red-100 text-red-700 px-2 py-1 rounded"
                        >
                          Rejeitar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
