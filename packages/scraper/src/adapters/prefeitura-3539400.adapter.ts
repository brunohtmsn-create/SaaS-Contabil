/**
 * Adapter — Prefeitura de Poá (IBGE 3539400)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.poa.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3539400Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.poa.sp.gov.br',
      municipio: 'Poá',
      ibge: '3539400',
      fonte: 'PREFEITURA_POA',
    })
  }
}
