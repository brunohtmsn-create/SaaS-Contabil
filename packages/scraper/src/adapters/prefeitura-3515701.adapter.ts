/**
 * Adapter — Prefeitura de Ferraz de Vasconcelos (IBGE 3515701)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.ferrazdevasconcelos.sp.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura3515701Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.ferrazdevasconcelos.sp.gov.br',
      municipio: 'Ferraz de Vasconcelos',
      ibge: '3515701',
      fonte: 'PREFEITURA_FERRAZ_VASCONCELOS',
    })
  }
}
