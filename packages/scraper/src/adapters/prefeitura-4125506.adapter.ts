/**
 * Adapter — Prefeitura de São José dos Pinhais (IBGE 4125506)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.sjp.pr.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura4125506Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.sjp.pr.gov.br',
      municipio: 'São José dos Pinhais',
      ibge: '4125506',
      fonte: 'PREFEITURA_SAO_JOSE_PINHAIS',
    })
  }
}
