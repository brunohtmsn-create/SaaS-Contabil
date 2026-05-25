/**
 * Adapter — Prefeitura de Mogi das Cruzes (IBGE 3530607)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.mogidascruzes.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3530607Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.mogidascruzes.sp.gov.br',
      municipio: 'Mogi das Cruzes',
      ibge: '3530607',
      fonte: 'PREFEITURA_MOGI_CRUZES',
    })
  }
}
