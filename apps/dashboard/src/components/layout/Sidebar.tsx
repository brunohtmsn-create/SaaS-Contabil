'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'

const navItems = [
  { href: '/dashboard', label: 'Painel', icon: '◉' },
  { href: '/compliance', label: 'Compliance', icon: '✅' },
  { href: '/empresas', label: 'Empresas', icon: '🏢' },
  { href: '/documentos', label: 'Documentos', icon: '📄' },
  { href: '/fiscal', label: 'Fiscal', icon: '💰' },
  { href: '/fiscal/difal-gnre', label: 'DIFAL / GNRE', icon: '🔀' },
  { href: '/fiscal/efdreinf', label: 'EFD-Reinf', icon: '📬' },
  { href: '/fiscal/esocial', label: 'eSocial', icon: '👥' },
  { href: '/fiscal/dasn', label: 'DASN / DEFIS', icon: '📋' },
  { href: '/fiscal/lplr', label: 'LP / LR', icon: '🏛️' },
  { href: '/fiscal/ecf', label: 'ECF', icon: '📑' },
  { href: '/fiscal/lr', label: 'IRPJ/CSLL LR', icon: '🏦' },
  { href: '/fiscal/sped-fiscal', label: 'SPED Fiscal', icon: '🗂️' },
  { href: '/fiscal/sped-contribuicoes', label: 'EFD Contrib.', icon: '📊' },
  { href: '/fiscal/creditos-pis-cofins-lr', label: 'Créditos PIS/COFINS', icon: '💳' },
  { href: '/fiscal/retencoes-fonte', label: 'Retenções Fonte', icon: '✂️' },
  { href: '/fiscal/ajuste-anual-lr', label: 'Ajuste Anual LR', icon: '🔄' },
  { href: '/fiscal/dctfweb', label: 'DCTFWeb', icon: '📤' },
  { href: '/fiscal/prejuizos-fiscais-lr', label: 'Prejuízos Fiscais LR', icon: '📉' },
  { href: '/fiscal/irpj-estimativa-lr', label: 'Estimativa LR', icon: '🔢' },
  { href: '/fiscal/dctf-mensal', label: 'DCTF Mensal', icon: '📝' },
  { href: '/fiscal/depreciacao-lr', label: 'Depreciação LR', icon: '📦' },
  { href: '/fiscal/destda', label: 'DeSTDA', icon: '🗃️' },
  { href: '/fiscal/dms', label: 'DMS / ISS', icon: '🏙️' },
  { href: '/fiscal/inss-patronal', label: 'INSS Patronal', icon: '👷' },
  { href: '/fiscal/fator-r', label: 'Fator R', icon: '📐' },
  { href: '/fiscal/lalur', label: 'LALUR', icon: '📒' },
  { href: '/fiscal/simulador-tributario', label: 'Simulador Tributário', icon: '🧮' },
  { href: '/fiscal/planejamento-tributario', label: 'Planejamento Tributário', icon: '📈' },
  { href: '/fiscal/icms-st', label: 'ICMS-ST', icon: '🔁' },
  { href: '/fiscal/encerramento-sn', label: 'Encerramento SN', icon: '🔒' },
  { href: '/fiscal/livro-fiscal', label: 'Livro Fiscal', icon: '📖' },
  { href: '/fiscal/diagnostico', label: 'Diagnóstico Fiscal', icon: '🩺' },
  { href: '/fiscal/relatorio', label: 'Relatório Fiscal', icon: '📋' },
  { href: '/obrigacoes', label: 'Obrigações', icon: '📅' },
  { href: '/fgts', label: 'FGTS Digital', icon: '🏦' },
  { href: '/conciliacao', label: 'Conciliação', icon: '⚖️' },
  { href: '/contabil', label: 'Contábil', icon: '📒' },
  { href: '/contabil/ecd', label: 'ECD', icon: '📚' },
  { href: '/portais', label: 'Portais Gov.', icon: '🏛️' },
  { href: '/auditoria', label: 'Auditoria', icon: '🔍' },
  { href: '/relatorios', label: 'Relatórios', icon: '📊' },
  { href: '/credenciais', label: 'Credenciais', icon: '🔐' },
  { href: '/configuracoes', label: 'Configurações', icon: '⚙️' },
]

function isActive(href: string, pathname: string): boolean {
  if (pathname === href) return true
  // Para rotas sem sub-páginas com mesmo prefixo, verificar startsWith
  if (href !== '/fiscal' && pathname.startsWith(href + '/')) return true
  return false
}

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
              isActive(item.href, pathname)
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
