/**
 * Adapter — Prefeitura de Guarulhos (IBGE 3518800)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.guarulhos.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3518800Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.guarulhos.sp.gov.br',
      municipio: 'Guarulhos',
      ibge: '3518800',
      fonte: 'PREFEITURA_GUARULHOS',
    })
  }
}
