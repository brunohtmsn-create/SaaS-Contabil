/**
 * Adapter — Prefeitura de Santo André (IBGE 3547809)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.santoandre.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3547809Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.santoandre.sp.gov.br',
      municipio: 'Santo André',
      ibge: '3547809',
      fonte: 'PREFEITURA_SANTO_ANDRE',
    })
  }
}
