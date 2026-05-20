'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'

export default function FiscalPage() {
  const [competencia] = useState(() => new Date().toISOString().slice(0, 7))

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas'],
    queryFn: () => api.get('/empresas').then((r) => r.data),
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Apuração Fiscal</h1>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Empresa</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">CNPJ</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Regime</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">PGDAS</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">DIFAL</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase">DeSTDA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {empresas.map((e: any) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-medium">{e.razaoSocial}</td>
                <td className="px-6 py-4 font-mono text-xs">{e.cnpj}</td>
                <td className="px-6 py-4">
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                    {e.regime?.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 text-center">—</td>
                <td className="px-6 py-4 text-center">—</td>
                <td className="px-6 py-4 text-center">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
