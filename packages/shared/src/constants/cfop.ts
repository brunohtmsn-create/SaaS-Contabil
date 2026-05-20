export const CFOPS_COMPRA_ENTRADA = [
  '1.102', '1.202', '1.403', '1.503', '1.551', '1.556',
  '2.102', '2.202', '2.403', '2.551',
]

export const CFOPS_VENDA_SAIDA = [
  '5.101', '5.102', '5.103', '5.104', '5.202', '5.405',
  '6.101', '6.102', '6.103', '6.104',
]

export const CFOPS_INTERESTADUAIS_DIFAL = [
  '1.102', '1.202', '1.403', '1.503', '1.551', '1.556',
  '2.102', '2.202', '2.403', '2.551',
]

export const MAPA_CFOP_CONTA: Record<string, { debito: string; credito: string }> = {
  '1.102': { debito: '1.1.3.01', credito: '2.1.1.01' },
  '1.202': { debito: '1.1.3.01', credito: '2.1.1.01' },
  '1.403': { debito: '1.1.2.01', credito: '2.1.1.01' },
  '2.102': { debito: '1.1.3.01', credito: '2.1.1.01' },
  '5.102': { debito: '1.1.2.01', credito: '3.1.1.01' },
  '5.405': { debito: '1.1.2.01', credito: '3.1.1.01' },
}
