/**
 * Adapter — Prefeitura de Maringá (IBGE 4115200)
 * Portal: Betha Sistemas / ISS.NET — https://nfse.maringa.pr.gov.br
 */
import { BaseBethaAdapter } from './base-betha.adapter.js'

export class Prefeitura4115200Adapter extends BaseBethaAdapter {
  constructor() {
    super({
      baseUrl: 'https://nfse.maringa.pr.gov.br',
      municipio: 'Maringá',
      ibge: '4115200',
      fonte: 'PREFEITURA_MARINGA',
    })
  }
}
