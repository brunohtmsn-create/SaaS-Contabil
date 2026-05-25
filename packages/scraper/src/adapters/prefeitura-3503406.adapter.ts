/**
 * Adapter — Prefeitura de Arujá (IBGE 3503406)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.aruja.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3503406Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.aruja.sp.gov.br',
      municipio: 'Arujá',
      ibge: '3503406',
      fonte: 'PREFEITURA_ARUJA',
    })
  }
}
