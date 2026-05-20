export function limparCNPJ(cnpj: string): string {
  return cnpj.replace(/\D/g, '')
}

export function formatarCNPJ(cnpj: string): string {
  const c = limparCNPJ(cnpj)
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12, 14)}`
}

export function validarCNPJ(cnpj: string): boolean {
  const c = limparCNPJ(cnpj)
  if (c.length !== 14) return false
  if (/^(\d)\1+$/.test(c)) return false

  const calcDigit = (cnpj: string, length: number): number => {
    let sum = 0
    let pos = length - 7
    for (let i = length; i >= 1; i--) {
      sum += parseInt(cnpj.charAt(length - i)) * pos--
      if (pos < 2) pos = 9
    }
    const result = sum % 11 < 2 ? 0 : 11 - (sum % 11)
    return result
  }

  if (calcDigit(c, 12) !== parseInt(c.charAt(12))) return false
  if (calcDigit(c, 13) !== parseInt(c.charAt(13))) return false
  return true
}

export function limparCPF(cpf: string): string {
  return cpf.replace(/\D/g, '')
}
