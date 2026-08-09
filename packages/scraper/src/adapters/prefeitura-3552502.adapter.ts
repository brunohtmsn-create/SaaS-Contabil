/**
 * Adapter — Prefeitura de Suzano (IBGE 3552502)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.suzano.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3552502Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.suzano.sp.gov.br',
      municipio: 'Suzano',
      ibge: '3552502',
      fonte: 'PREFEITURA_SUZANO',
    })
  }
}
