/**
 * Adapter — Prefeitura de Cotia (IBGE 3513009)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.cotia.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3513009Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.cotia.sp.gov.br',
      municipio: 'Cotia',
      ibge: '3513009',
      fonte: 'PREFEITURA_COTIA',
    })
  }
}
