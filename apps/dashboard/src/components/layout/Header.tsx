'use client'

import { useAuthStore } from '@/store/auth.store'
import { useRouter } from 'next/navigation'
import { NotificacoesBell } from './NotificacoesBell'

export function Header() {
  const { usuario, logout } = useAuthStore()
  const router = useRouter()

  function handleLogout() {
    logout()
    router.push('/login')
  }

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
      <div />
      <div className="flex items-center gap-4">
        <NotificacoesBell />
        <span className="text-sm text-slate-600">{usuario?.nome}</span>
        <button
          onClick={handleLogout}
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          Sair
        </button>
      </div>
    </header>
  )
}
