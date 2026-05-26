'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Credencial = {
  id: string
  tipo: string
  status: 'ATIVO' | 'REVOGADO' | 'VENCIDO' | 'ERRO'
  validade?: string
  escopos: string[]
  criadoEm: string
  ultimoUso?: string
  ultimoResultado?: string
}

type Props = { empresaId: string; cnpj: string }

const TIPO_ICON: Record<string, string> = {
  CERTIFICADO_A1: '🔐',
  CERTIFICADO_A3: '🔑',
  PROCURACAO_ECAC: '📋',
  SENHA_PREFEITURA: '🏙️',
  SENHA_SIMPLES: '💰',
}

const TIPO_LABEL: Record<string, string> = {
  CERTIFICADO_A1: 'Certificado A1 (.pfx)',
  CERTIFICADO_A3: 'Certificado A3',
  PROCURACAO_ECAC: 'Procuração e-CAC',
  SENHA_PREFEITURA: 'Senha Prefeitura',
  SENHA_SIMPLES: 'Senha Simples Nacional',
}

const STATUS_COR: Record<string, string> = {
  ATIVO: 'bg-green-100 text-green-700',
  REVOGADO: 'bg-red-100 text-red-700',
  VENCIDO: 'bg-slate-100 text-slate-500',
  ERRO: 'bg-orange-100 text-orange-700',
}

const TIPOS_SENHA = ['PROCURACAO_ECAC', 'SENHA_PREFEITURA', 'SENHA_SIMPLES']
const TIPOS_ARQUIVO = ['CERTIFICADO_A1', 'CERTIFICADO_A3']

export function CredenciaisPanel({ empresaId, cnpj }: Props) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [showForm, setShowForm] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [form, setForm] = useState({
    tipo: 'CERTIFICADO_A1',
    senha: '',
    validade: '',
    arquivo: null as File | null,
  })

  const { data: credenciais = [], isLoading } = useQuery<Credencial[]>({
    queryKey: ['credenciais-empresa', empresaId],
    queryFn: () => api.get(`/credenciais/${empresaId}/credenciais`).then((r) => r.data),
    refetchInterval: 60000,
  })

  const revogar = useMutation({
    mutationFn: (id: string) => api.delete(`/credenciais/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credenciais-empresa', empresaId] }),
  })

  const criar = useMutation({
    mutationFn: async () => {
      setErro(null)
      if (TIPOS_ARQUIVO.includes(form.tipo)) {
        if (!form.arquivo) throw new Error('Selecione o arquivo .pfx')
        const fd = new FormData()
        fd.append('file', form.arquivo)
        fd.append('empresaId', empresaId)
        fd.append('cnpj', cnpj)
        fd.append('tipo', form.tipo)
        if (form.validade) fd.append('validade', form.validade)
        if (form.senha) fd.append('senha', form.senha)
        return api.post('/credenciais', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }
      if (!form.senha) throw new Error('Informe a senha')
      return api.post('/credenciais', {
        empresaId,
        cnpj,
        tipo: form.tipo,
        senha: form.senha,
        ...(form.validade && { validade: form.validade }),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credenciais-empresa', empresaId] })
      setShowForm(false)
      setForm({ tipo: 'CERTIFICADO_A1', senha: '', validade: '', arquivo: null })
      if (fileRef.current) fileRef.current.value = ''
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Erro ao salvar credencial'
      setErro(msg)
    },
  })

  const usaArquivo = TIPOS_ARQUIVO.includes(form.tipo)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-900">Credenciais</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Certificados e senhas usados para acesso aos portais governamentais
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm((v) => !v)
            setErro(null)
          }}
          className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Nova Credencial
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <h4 className="font-medium text-slate-800">Cadastrar credencial</h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Tipo</label>
              <select
                value={form.tipo}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tipo: e.target.value, arquivo: null, senha: '' }))
                }
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              >
                {Object.entries(TIPO_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            {usaArquivo ? (
              <>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Arquivo .pfx / .p12
                  </label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pfx,.p12"
                    onChange={(e) =>
                      setForm((f) => ({ ...f, arquivo: e.target.files?.[0] ?? null }))
                    }
                    className="block w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm file:font-medium hover:file:bg-blue-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Senha do certificado
                  </label>
                  <input
                    type="password"
                    value={form.senha}
                    onChange={(e) => setForm((f) => ({ ...f, senha: e.target.value }))}
                    placeholder="Senha do .pfx"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </>
            ) : (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Senha</label>
                <input
                  type="password"
                  value={form.senha}
                  onChange={(e) => setForm((f) => ({ ...f, senha: e.target.value }))}
                  placeholder="Senha de acesso ao portal"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Validade (opcional)
              </label>
              <input
                type="date"
                value={form.validade}
                onChange={(e) => setForm((f) => ({ ...f, validade: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {erro && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {erro}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => criar.mutate()}
              disabled={criar.isPending}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {criar.isPending ? 'Salvando...' : 'Salvar'}
            </button>
            <button
              onClick={() => {
                setShowForm(false)
                setErro(null)
                setForm({ tipo: 'CERTIFICADO_A1', senha: '', validade: '', arquivo: null })
              }}
              className="border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-center text-slate-400 text-sm">Carregando credenciais...</div>
      ) : credenciais.length === 0 ? (
        <div className="py-8 text-center text-slate-400 text-sm">
          Nenhuma credencial cadastrada. Adicione um certificado A1 ou senha para permitir acesso
          aos portais.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Tipo
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Validade
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Último uso
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {credenciais.map((cred) => (
                <tr key={cred.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span>{TIPO_ICON[cred.tipo] ?? '🔒'}</span>
                      <div>
                        <div className="font-medium text-slate-800">
                          {TIPO_LABEL[cred.tipo] ?? cred.tipo}
                        </div>
                        {cred.ultimoResultado && (
                          <div className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">
                            {cred.ultimoResultado}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COR[cred.status] ?? 'bg-slate-100 text-slate-600'}`}
                    >
                      {cred.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {cred.validade ? new Date(cred.validade).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {cred.ultimoUso
                      ? new Date(cred.ultimoUso).toLocaleString('pt-BR')
                      : 'Nunca usado'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {cred.status === 'ATIVO' && (
                      <button
                        onClick={() => {
                          if (
                            confirm('Revogar esta credencial? Esta ação não pode ser desfeita.')
                          ) {
                            revogar.mutate(cred.id)
                          }
                        }}
                        disabled={revogar.isPending}
                        className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                      >
                        Revogar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
