/**
 * Adapter — Prefeitura de Santa Isabel (IBGE 3546702)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.santaisabel.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3546702Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.santaisabel.sp.gov.br',
      municipio: 'Santa Isabel',
      ibge: '3546702',
      fonte: 'PREFEITURA_SANTA_ISABEL',
    })
  }
}
