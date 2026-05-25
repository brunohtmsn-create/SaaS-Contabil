/**
 * Adapter — Prefeitura de Ribeirão Preto (IBGE 3543402)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.ribeiraopreto.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3543402Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.ribeiraopreto.sp.gov.br',
      municipio: 'Ribeirão Preto',
      ibge: '3543402',
      fonte: 'PREFEITURA_RIBEIRAO_PRETO',
    })
  }
}
