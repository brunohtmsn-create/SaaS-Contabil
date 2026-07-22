'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

const REGIMES = [
  { value: 'SIMPLES_NACIONAL', label: 'Simples Nacional' },
  { value: 'MEI', label: 'MEI' },
  { value: 'LUCRO_PRESUMIDO', label: 'Lucro Presumido' },
  { value: 'LUCRO_REAL', label: 'Lucro Real' },
]

const UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
]

export default function NovaEmpresaPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    cnpj: '',
    razaoSocial: '',
    nomeFantasia: '',
    regime: 'SIMPLES_NACIONAL',
    cnae: '',
    uf: 'SP',
    municipio: '',
    ibge: '',
    dataAbertura: '',
  })
  const [erros, setErros] = useState<Record<string, string>>({})

  const criar = useMutation({
    mutationFn: (data: typeof form) =>
      api
        .post('/empresas', {
          ...data,
          cnpj: data.cnpj.replace(/\D/g, ''),
        })
        .then((r) => r.data),
    onSuccess: (empresa) => router.push(`/empresas/${empresa.id}`),
    onError: (err: any) => {
      const msg = err?.response?.data?.error ?? 'Erro ao cadastrar empresa'
      setErros({ geral: msg })
    },
  })

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
    setErros((prev) => ({ ...prev, [field]: '' }))
  }

  const [situacaoCadastral, setSituacaoCadastral] = useState('')

  const consultarCNPJ = useMutation({
    mutationFn: (cnpj: string) => api.get(`/empresas/consultar-cnpj/${cnpj}`).then((r) => r.data),
    onSuccess: (dados) => {
      setForm((prev) => ({
        ...prev,
        razaoSocial: dados.razaoSocial || prev.razaoSocial,
        nomeFantasia: dados.nomeFantasia || prev.nomeFantasia,
        cnae: dados.cnae || prev.cnae,
        uf: dados.uf || prev.uf,
        municipio: dados.municipio || prev.municipio,
        ibge: dados.ibge || prev.ibge,
        dataAbertura: dados.dataAbertura || prev.dataAbertura,
        regime: dados.regimeSugerido ?? prev.regime,
      }))
      setSituacaoCadastral(dados.situacaoCadastral ?? '')
      setErros({})
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error ?? 'Falha ao consultar CNPJ'
      setErros((prev) => ({ ...prev, cnpj: msg }))
    },
  })

  function handleConsultarCNPJ() {
    const digits = form.cnpj.replace(/\D/g, '')
    if (digits.length !== 14) {
      setErros((prev) => ({ ...prev, cnpj: 'Informe os 14 dígitos do CNPJ para consultar' }))
      return
    }
    consultarCNPJ.mutate(digits)
  }

  const formatCNPJ = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 14)
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  }

  function validar(): boolean {
    const novosErros: Record<string, string> = {}
    const cnpjDigits = form.cnpj.replace(/\D/g, '')
    if (cnpjDigits.length !== 14) novosErros.cnpj = 'CNPJ deve ter 14 dígitos'
    if (!form.razaoSocial.trim()) novosErros.razaoSocial = 'Razão social é obrigatória'
    if (!form.cnae.trim()) novosErros.cnae = 'CNAE é obrigatório'
    if (!form.municipio.trim()) novosErros.municipio = 'Município é obrigatório'
    if (form.ibge.replace(/\D/g, '').length !== 7)
      novosErros.ibge = 'Código IBGE deve ter 7 dígitos'
    if (!form.dataAbertura) novosErros.dataAbertura = 'Data de abertura é obrigatória'
    setErros(novosErros)
    return Object.keys(novosErros).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (validar()) criar.mutate(form)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="text-slate-400 hover:text-slate-600 text-sm"
        >
          ← Voltar
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Nova Empresa</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-slate-200 p-6 space-y-5"
      >
        {erros.geral && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {erros.geral}
          </div>
        )}

        {/* CNPJ */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">CNPJ *</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={form.cnpj}
              onChange={(e) => setForm((prev) => ({ ...prev, cnpj: formatCNPJ(e.target.value) }))}
              placeholder="00.000.000/0000-00"
              className={`flex-1 border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 ${erros.cnpj ? 'border-red-400' : 'border-slate-200'}`}
            />
            <button
              type="button"
              onClick={handleConsultarCNPJ}
              disabled={consultarCNPJ.isPending}
              className="px-4 py-2 text-sm font-medium text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {consultarCNPJ.isPending ? 'Consultando...' : 'Buscar na Receita'}
            </button>
          </div>
          {erros.cnpj && <p className="text-xs text-red-600 mt-1">{erros.cnpj}</p>}
          {situacaoCadastral && (
            <p
              className={`text-xs mt-1 font-medium ${situacaoCadastral === 'ATIVA' ? 'text-green-600' : 'text-orange-600'}`}
            >
              Situação cadastral na Receita: {situacaoCadastral}
            </p>
          )}
        </div>

        {/* Razão Social */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Razão Social *</label>
          <input
            type="text"
            value={form.razaoSocial}
            onChange={set('razaoSocial')}
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${erros.razaoSocial ? 'border-red-400' : 'border-slate-200'}`}
          />
          {erros.razaoSocial && <p className="text-xs text-red-600 mt-1">{erros.razaoSocial}</p>}
        </div>

        {/* Nome Fantasia */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Nome Fantasia</label>
          <input
            type="text"
            value={form.nomeFantasia}
            onChange={set('nomeFantasia')}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Regime Tributário */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Regime Tributário *
          </label>
          <select
            value={form.regime}
            onChange={set('regime')}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {REGIMES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {/* CNAE + Data Abertura */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              CNAE Principal *
            </label>
            <input
              type="text"
              value={form.cnae}
              onChange={set('cnae')}
              placeholder="0000-0/00"
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${erros.cnae ? 'border-red-400' : 'border-slate-200'}`}
            />
            {erros.cnae && <p className="text-xs text-red-600 mt-1">{erros.cnae}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Data de Abertura *
            </label>
            <input
              type="date"
              value={form.dataAbertura}
              onChange={set('dataAbertura')}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${erros.dataAbertura ? 'border-red-400' : 'border-slate-200'}`}
            />
            {erros.dataAbertura && (
              <p className="text-xs text-red-600 mt-1">{erros.dataAbertura}</p>
            )}
          </div>
        </div>

        {/* UF + Município + IBGE */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">UF *</label>
            <select
              value={form.uf}
              onChange={set('uf')}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Município *</label>
            <input
              type="text"
              value={form.municipio}
              onChange={set('municipio')}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${erros.municipio ? 'border-red-400' : 'border-slate-200'}`}
            />
            {erros.municipio && <p className="text-xs text-red-600 mt-1">{erros.municipio}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Código IBGE *</label>
            <input
              type="text"
              value={form.ibge}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  ibge: e.target.value.replace(/\D/g, '').slice(0, 7),
                }))
              }
              placeholder="0000000"
              className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 ${erros.ibge ? 'border-red-400' : 'border-slate-200'}`}
            />
            {erros.ibge && <p className="text-xs text-red-600 mt-1">{erros.ibge}</p>}
          </div>
        </div>

        {/* Botões */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={criar.isPending}
            className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {criar.isPending ? 'Cadastrando...' : 'Cadastrar Empresa'}
          </button>
        </div>
      </form>
    </div>
  )
}
