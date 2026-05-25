/**
 * Adapter — Prefeitura de São Caetano do Sul (IBGE 3548807)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.saocaetanodosul.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3548807Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.saocaetanodosul.sp.gov.br',
      municipio: 'São Caetano do Sul',
      ibge: '3548807',
      fonte: 'PREFEITURA_SAO_CAETANO_SUL',
    })
  }
}
