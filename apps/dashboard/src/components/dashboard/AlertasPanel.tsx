type Alerta = {
  id: string
  tipo: string
  mensagem: string
  empresa: { cnpj: string; razaoSocial: string }
  criadoEm: string
}

const tipoColor: Record<string, string> = {
  DIVERGENCIA_CONCILIACAO: 'bg-red-100 text-red-700',
  CREDENCIAL_VENCENDO: 'bg-yellow-100 text-yellow-700',
  RISCO_EXCLUSAO_SN: 'bg-orange-100 text-orange-700',
  VENCIMENTO_OBRIGACAO: 'bg-blue-100 text-blue-700',
}

export function AlertasPanel({ alertas }: { alertas: Alerta[] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="px-6 py-4 border-b border-slate-200">
        <h3 className="font-semibold text-slate-900">Alertas Recentes</h3>
      </div>
      <div className="divide-y divide-slate-100">
        {alertas.length === 0 ? (
          <div className="px-6 py-8 text-center text-slate-400 text-sm">Nenhum alerta pendente</div>
        ) : (
          alertas.slice(0, 8).map((alerta) => (
            <div key={alerta.id} className="px-6 py-4">
              <div className="flex items-start gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 mt-0.5 ${tipoColor[alerta.tipo] ?? 'bg-slate-100 text-slate-600'}`}>
                  {alerta.tipo.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-sm text-slate-700 mt-1 line-clamp-2">{alerta.mensagem}</p>
              <p className="text-xs text-slate-400 mt-1">{alerta.empresa?.razaoSocial}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
