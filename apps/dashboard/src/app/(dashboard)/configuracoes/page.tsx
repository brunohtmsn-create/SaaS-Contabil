'use client'

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'

const PLANO_COR: Record<string, string> = {
  BASICO: 'bg-slate-100 text-slate-600',
  PROFISSIONAL: 'bg-blue-100 text-blue-700',
  ENTERPRISE: 'bg-purple-100 text-purple-700',
}

const PERFIL_COR: Record<string, string> = {
  ADMIN: 'bg-red-100 text-red-700',
  CONTADOR: 'bg-green-100 text-green-700',
  AUXILIAR: 'bg-yellow-100 text-yellow-700',
  CLIENTE: 'bg-slate-100 text-slate-600',
}

export default function ConfiguracoesPage() {
  const { logout } = useAuthStore()
  const [senhaAtual, setSenhaAtual] = useState('')
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [senhaMsg, setSenhaMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [nomeEdit, setNomeEdit] = useState('')
  const [editandoNome, setEditandoNome] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['configuracoes-perfil'],
    queryFn: () => api.get('/configuracoes/perfil').then((r) => r.data),
    onSuccess: (d: any) => {
      if (!editandoNome) setNomeEdit(d.usuario?.nome ?? '')
    },
  } as any)

  const atualizarNome = useMutation({
    mutationFn: (nome: string) => api.put('/configuracoes/perfil', { nome }),
    onSuccess: () => {
      refetch()
      setEditandoNome(false)
    },
  })

  async function handleSenha(e: React.FormEvent) {
    e.preventDefault()
    setSenhaMsg(null)
    if (novaSenha !== confirmar) {
      setSenhaMsg({ ok: false, texto: 'As senhas não coincidem' })
      return
    }
    if (novaSenha.length < 8) {
      setSenhaMsg({ ok: false, texto: 'Nova senha deve ter pelo menos 8 caracteres' })
      return
    }
    try {
      await api.put('/configuracoes/senha', { senhaAtual, novaSenha })
      setSenhaMsg({ ok: true, texto: 'Senha alterada com sucesso' })
      setSenhaAtual('')
      setNovaSenha('')
      setConfirmar('')
    } catch (err: any) {
      setSenhaMsg({ ok: false, texto: err.response?.data?.error ?? 'Erro ao alterar senha' })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Configurações</h1>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-slate-100 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const { tenant, usuario, stats } = (data ?? {}) as any

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Configurações</h1>
        <p className="text-slate-500 text-sm mt-1">
          Gerencie seu perfil, tenant e credenciais de acesso
        </p>
      </div>

      {/* Perfil do usuário */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Meu Perfil</h2>

        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center text-white text-xl font-bold select-none">
            {(usuario?.nome ?? 'U').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            {editandoNome ? (
              <div className="flex items-center gap-2">
                <input
                  value={nomeEdit}
                  onChange={(e) => setNomeEdit(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm flex-1"
                  autoFocus
                />
                <button
                  onClick={() => atualizarNome.mutate(nomeEdit)}
                  disabled={atualizarNome.isPending || !nomeEdit.trim()}
                  className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  Salvar
                </button>
                <button
                  onClick={() => setEditandoNome(false)}
                  className="text-slate-400 text-xs px-2 py-1.5"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="font-medium text-slate-900 truncate">{usuario?.nome}</p>
                <button
                  onClick={() => {
                    setEditandoNome(true)
                    setNomeEdit(usuario?.nome ?? '')
                  }}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  editar
                </button>
              </div>
            )}
            <p className="text-sm text-slate-500 mt-0.5">{usuario?.email}</p>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-medium ${PERFIL_COR[usuario?.perfil] ?? 'bg-slate-100 text-slate-600'}`}
          >
            {usuario?.perfil}
          </span>
        </div>

        <div className="text-xs text-slate-400">
          Conta criada em{' '}
          {usuario?.criadoEm ? new Date(usuario.criadoEm).toLocaleDateString('pt-BR') : '—'}
        </div>
      </section>

      {/* Informações do Tenant */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Escritório / Tenant</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Razão Social</p>
            <p className="font-medium text-slate-900">{tenant?.nome ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">CNPJ</p>
            <p className="font-mono text-slate-900">{tenant?.cnpj ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Subdomínio</p>
            <p className="font-mono text-slate-900">
              {tenant?.subdominio ?? '—'}.saascontabil.com.br
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Plano</p>
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium ${PLANO_COR[tenant?.plano] ?? 'bg-slate-100 text-slate-600'}`}
            >
              {tenant?.plano ?? '—'}
            </span>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4 grid grid-cols-2 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{stats?.totalEmpresas ?? 0}</p>
            <p className="text-xs text-slate-500 mt-0.5">Empresas cadastradas</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{stats?.totalUsuarios ?? 0}</p>
            <p className="text-xs text-slate-500 mt-0.5">Usuários ativos</p>
          </div>
        </div>
      </section>

      {/* Alterar Senha */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Alterar Senha</h2>

        <form onSubmit={handleSenha} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Senha atual</label>
            <input
              type="password"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              required
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nova senha</label>
            <input
              type="password"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              required
              minLength={8}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Mínimo 8 caracteres"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Confirmar nova senha
            </label>
            <input
              type="password"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              required
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Repita a nova senha"
            />
          </div>

          {senhaMsg && (
            <p className={`text-sm ${senhaMsg.ok ? 'text-green-600' : 'text-red-600'}`}>
              {senhaMsg.ok ? '✓ ' : '✗ '}
              {senhaMsg.texto}
            </p>
          )}

          <button
            type="submit"
            disabled={!senhaAtual || !novaSenha || !confirmar}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg"
          >
            Alterar senha
          </button>
        </form>
      </section>

      {/* Sobre */}
      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Sobre o Sistema</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Versão</dt>
            <dd className="font-mono text-slate-700">v0.1.0 — Fase 1 MVP</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Stack</dt>
            <dd className="text-slate-700">Fastify · Prisma · BullMQ · Next.js 14</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Projeto</dt>
            <dd className="text-slate-700">SaaS Contábil Automatizado — Piloto Bruno Conde</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Tenant ativo desde</dt>
            <dd className="text-slate-700">
              {tenant?.criadoEm ? new Date(tenant.criadoEm).toLocaleDateString('pt-BR') : '—'}
            </dd>
          </div>
        </dl>
      </section>

      {/* Sair */}
      <div className="flex justify-end pb-6">
        <button
          onClick={() => {
            logout()
            window.location.href = '/login'
          }}
          className="text-sm text-red-600 hover:text-red-800 font-medium"
        >
          Sair da conta
        </button>
      </div>
    </div>
  )
}
