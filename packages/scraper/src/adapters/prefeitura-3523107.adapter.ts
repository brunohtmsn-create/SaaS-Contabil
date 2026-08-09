/**
 * Adapter — Prefeitura de Itaquaquecetuba (IBGE 3523107)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.itaquaquecetuba.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3523107Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.itaquaquecetuba.sp.gov.br',
      municipio: 'Itaquaquecetuba',
      ibge: '3523107',
      fonte: 'PREFEITURA_ITAQUAQUECETUBA',
    })
  }
}
