type Props = {
  title: string
  value: number | string
  icon: string
  color: 'blue' | 'green' | 'yellow' | 'red'
}

const colorMap = {
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-green-50 text-green-700',
  yellow: 'bg-yellow-50 text-yellow-700',
  red: 'bg-red-50 text-red-700',
}

export function StatsCard({ title, value, icon, color }: Props) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-slate-500">{title}</span>
        <span className={`w-10 h-10 flex items-center justify-center rounded-lg text-lg ${colorMap[color]}`}>
          {icon === 'building' ? '🏢' : icon === 'file' ? '📄' : icon === 'bell' ? '🔔' : '📅'}
        </span>
      </div>
      <p className="text-3xl font-bold text-slate-900">{value.toLocaleString('pt-BR')}</p>
    </div>
  )
}
