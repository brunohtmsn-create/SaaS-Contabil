'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'

const navItems = [
  { href: '/dashboard', label: 'Painel', icon: '◉' },
  { href: '/empresas', label: 'Empresas', icon: '🏢' },
  { href: '/documentos', label: 'Documentos', icon: '📄' },
  { href: '/fiscal', label: 'Fiscal', icon: '💰' },
  { href: '/obrigacoes', label: 'Obrigações', icon: '📅' },
  { href: '/fgts', label: 'FGTS Digital', icon: '🏦' },
  { href: '/conciliacao', label: 'Conciliação', icon: '⚖️' },
  { href: '/contabil', label: 'Contábil', icon: '📒' },
  { href: '/portais', label: 'Portais Gov.', icon: '🏛️' },
  { href: '/auditoria', label: 'Auditoria', icon: '🔍' },
  { href: '/relatorios', label: 'Relatórios', icon: '📊' },
  { href: '/credenciais', label: 'Credenciais', icon: '🔐' },
  { href: '/configuracoes', label: 'Configurações', icon: '⚙️' },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 bg-slate-900 text-white flex flex-col">
      <div className="p-6 border-b border-slate-700">
        <h1 className="text-lg font-bold text-white">SaaS Contábil</h1>
        <p className="text-slate-400 text-xs mt-1">Escritório Inteligente</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors',
              pathname === item.href || pathname.startsWith(item.href + '/')
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            )}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-700">
        <p className="text-slate-400 text-xs">v0.1.0 — Fase 1 MVP</p>
      </div>
    </aside>
  )
}
