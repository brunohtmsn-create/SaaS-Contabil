/**
 * Adapter — Prefeitura de Navegantes (IBGE 4211405)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.navegantes.sc.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura4211405Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.navegantes.sc.gov.br',
      municipio: 'Navegantes',
      ibge: '4211405',
      fonte: 'PREFEITURA_NAVEGANTES',
    })
  }
}
