'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Credencial = {
  id: string
  empresaId: string
  tipo: string
  label?: string
  status: 'ATIVO' | 'REVOGADO' | 'VENCIDO' | 'ERRO'
  validade?: string
  criadoEm: string
  empresa?: { razaoSocial: string; cnpj: string }
}

const TIPO_ICONS: Record<string, string> = {
  CERTIFICADO_A1: '🔐',
  CERTIFICADO_A3: '🔑',
  PROCURACAO_ECAC: '📋',
  SENHA_PREFEITURA: '🏙️',
  SENHA_SIMPLES: '💰',
}

const STATUS_COR: Record<string, string> = {
  ATIVO: 'bg-green-100 text-green-700',
  REVOGADO: 'bg-red-100 text-red-700',
  VENCIDO: 'bg-gray-100 text-gray-500',
  ERRO: 'bg-red-50 text-red-500',
}

export default function CredenciaisPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'todas' | 'vencendo'>('todas')
  const [showForm, setShowForm] = useState(false)
  const [nova, setNova] = useState({
    empresaId: '',
    tipo: 'CERTIFICADO_A1',
    senha: '',
    validade: '',
    arquivo: null as File | null,
  })

  const { data: credenciais = [], isLoading } = useQuery<Credencial[]>({
    queryKey: ['credenciais', tab],
    queryFn: () => {
      const url = tab === 'vencendo' ? '/credenciais?vencendo=true' : '/credenciais'
      return api.get(url).then((r) => r.data)
    },
    refetchInterval: 30000,
  })

  const [erro, setErro] = useState<string | null>(null)

  const { data: empresas = [] } = useQuery<{ id: string; razaoSocial: string; cnpj: string }[]>({
    queryKey: ['empresas-lista'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
  })

  const revogar = useMutation({
    mutationFn: (id: string) => api.delete(`/credenciais/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credenciais'] }),
  })

  const isCertificado = nova.tipo === 'CERTIFICADO_A1' || nova.tipo === 'CERTIFICADO_A3'

  const salvar = useMutation({
    mutationFn: async () => {
      const empresa = empresas.find((e) => e.id === nova.empresaId)
      if (!empresa) throw new Error('Selecione uma empresa')
      if (isCertificado && !nova.arquivo) throw new Error('Selecione o arquivo .pfx do certificado')
      if (!isCertificado && !nova.senha) throw new Error('Informe a senha')

      if (isCertificado) {
        const form = new FormData()
        form.append('empresaId', nova.empresaId)
        form.append('cnpj', empresa.cnpj)
        form.append('tipo', nova.tipo)
        if (nova.validade) form.append('validade', nova.validade)
        form.append('escopos', JSON.stringify([]))
        form.append('arquivo', nova.arquivo!)
        return api.post('/credenciais', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }

      return api.post('/credenciais', {
        empresaId: nova.empresaId,
        cnpj: empresa.cnpj,
        tipo: nova.tipo,
        senha: nova.senha,
        validade: nova.validade || undefined,
        escopos: [],
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credenciais'] })
      setShowForm(false)
      setErro(null)
      setNova({ empresaId: '', tipo: 'CERTIFICADO_A1', senha: '', validade: '', arquivo: null })
    },
    onError: (e: any) => setErro(e.response?.data?.error ?? e.message ?? 'Erro ao salvar'),
  })

  const vencendoCount = credenciais.filter((c) => {
    if (!c.validade) return false
    const dias = Math.ceil((new Date(c.validade).getTime() - Date.now()) / 86400000)
    return dias >= 0 && dias <= 30
  }).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Credenciais</h1>
          <p className="text-slate-500 text-sm mt-1">
            Certificados digitais, procurações e senhas — AES-256-GCM
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + Nova Credencial
        </button>
      </div>

      {vencendoCount > 0 && (
        <div className="bg-orange-50 border border-orange-300 rounded-xl p-4 flex items-center gap-3">
          <span className="text-2xl">⏰</span>
          <div>
            <p className="font-semibold text-orange-900">
              {vencendoCount} credencial(is) vencendo nos próximos 30 dias
            </p>
            <p className="text-sm text-orange-700 mt-0.5">
              Renove os certificados digitais antes do vencimento para evitar bloqueios.
            </p>
          </div>
        </div>
      )}

      <div className="flex border-b border-slate-200">
        {(['todas', 'vencendo'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              tab === t
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'todas' ? 'Todas as credenciais' : `Vencendo em breve (${vencendoCount})`}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
          <h3 className="font-semibold text-slate-900 mb-4">Nova Credencial</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Empresa</label>
              <select
                value={nova.empresaId}
                onChange={(e) => setNova((n) => ({ ...n, empresaId: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Selecionar...</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.razaoSocial} ({e.cnpj})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tipo</label>
              <select
                value={nova.tipo}
                onChange={(e) => setNova((n) => ({ ...n, tipo: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="CERTIFICADO_A1">Certificado A1 (.pfx)</option>
                <option value="CERTIFICADO_A3">Certificado A3 (token)</option>
                <option value="PROCURACAO_ECAC">Procuração e-CAC</option>
                <option value="SENHA_PREFEITURA">Senha Prefeitura</option>
                <option value="SENHA_SIMPLES">Senha Simples Nacional</option>
              </select>
            </div>
            {isCertificado ? (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Arquivo .pfx
                </label>
                <input
                  type="file"
                  accept=".pfx,.p12"
                  onChange={(e) => setNova((n) => ({ ...n, arquivo: e.target.files?.[0] ?? null }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Criptografado com AES-256-GCM no servidor
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Senha / PIN</label>
                <input
                  type="password"
                  value={nova.senha}
                  onChange={(e) => setNova((n) => ({ ...n, senha: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Será criptografada com AES-256-GCM"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Validade</label>
              <input
                type="date"
                value={nova.validade}
                onChange={(e) => setNova((n) => ({ ...n, validade: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          {erro && <p className="text-xs text-red-600 mt-3 font-medium">{erro}</p>}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => salvar.mutate()}
              disabled={salvar.isPending}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {salvar.isPending ? 'Salvando...' : 'Salvar Credencial'}
            </button>
            <button
              onClick={() => {
                setShowForm(false)
                setErro(null)
              }}
              className="border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Carregando credenciais...</div>
        ) : credenciais.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Nenhuma credencial cadastrada.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Tipo
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Empresa
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Validade
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Cadastrado em
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {credenciais.map((cred) => {
                const diasParaVencer = cred.validade
                  ? Math.ceil((new Date(cred.validade).getTime() - Date.now()) / 86400000)
                  : null
                const vencendo =
                  diasParaVencer !== null && diasParaVencer <= 30 && diasParaVencer >= 0

                return (
                  <tr
                    key={cred.id}
                    className={`hover:bg-slate-50 ${vencendo ? 'bg-orange-50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2 text-sm">
                        <span>{TIPO_ICONS[cred.tipo] ?? '🔒'}</span>
                        <span className="font-medium text-slate-700">
                          {cred.tipo.replace(/_/g, ' ')}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {cred.empresa ? (
                        <>
                          <p className="font-medium text-slate-900 text-xs">
                            {cred.empresa.razaoSocial}
                          </p>
                          <p className="font-mono text-xs text-slate-400">{cred.empresa.cnpj}</p>
                        </>
                      ) : (
                        <span className="text-slate-400 text-xs font-mono">
                          {cred.empresaId.slice(0, 8)}...
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {cred.validade ? (
                        <span
                          className={vencendo ? 'text-orange-600 font-semibold' : 'text-slate-500'}
                        >
                          {new Date(cred.validade).toLocaleDateString('pt-BR')}
                          {vencendo && ` (${diasParaVencer}d)`}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COR[cred.status] ?? 'bg-slate-100 text-slate-500'}`}
                      >
                        {cred.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {new Date(cred.criadoEm).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {cred.status === 'ATIVO' && (
                        <button
                          onClick={() => {
                            if (confirm('Revogar esta credencial?')) revogar.mutate(cred.id)
                          }}
                          className="text-xs text-red-600 hover:text-red-800 font-medium"
                        >
                          Revogar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <p className="text-xs text-slate-500 font-medium">🔒 Segurança das credenciais</p>
        <p className="text-xs text-slate-400 mt-1">
          Todas as credenciais são criptografadas com AES-256-GCM usando chave derivada por tenant
          (PBKDF2/HKDF). As chaves nunca são logadas, serializadas ou transmitidas sem criptografia.
          Certificados A1 são zerados da memória após uso.
        </p>
      </div>
    </div>
  )
}
