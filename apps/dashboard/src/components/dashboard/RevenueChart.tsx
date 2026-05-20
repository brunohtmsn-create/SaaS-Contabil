'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const mockData = [
  { mes: 'Jan', nfe: 45000, nfce: 12000, nfse: 8000 },
  { mes: 'Fev', nfe: 52000, nfce: 14000, nfse: 9500 },
  { mes: 'Mar', nfe: 48000, nfce: 11000, nfse: 8800 },
  { mes: 'Abr', nfe: 61000, nfce: 15500, nfse: 11000 },
  { mes: 'Mai', nfe: 55000, nfce: 13000, nfse: 10500 },
  { mes: 'Jun', nfe: 67000, nfce: 17000, nfse: 12000 },
]

export function RevenueChart() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <h3 className="font-semibold text-slate-900 mb-6">Volume de Documentos por Mês</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={mockData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#94a3b8' }} />
          <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} />
          <Tooltip
            formatter={(value: number) =>
              value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            }
          />
          <Legend />
          <Bar dataKey="nfe" name="NF-e" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          <Bar dataKey="nfce" name="NFC-e" fill="#10b981" radius={[4, 4, 0, 0]} />
          <Bar dataKey="nfse" name="NFS-e" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
