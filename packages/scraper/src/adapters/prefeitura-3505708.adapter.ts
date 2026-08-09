/**
 * Adapter — Prefeitura de Barueri (IBGE 3505708)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.barueri.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3505708Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.barueri.sp.gov.br',
      municipio: 'Barueri',
      ibge: '3505708',
      fonte: 'PREFEITURA_BARUERI',
    })
  }
}
