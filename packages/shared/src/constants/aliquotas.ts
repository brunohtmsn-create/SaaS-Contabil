import { Decimal } from 'decimal.js'

export const FUNDO_POBREZA: Record<string, Decimal> = {
  AL: new Decimal(2),
  BA: new Decimal(2),
  CE: new Decimal(2),
  MA: new Decimal(2),
  MG: new Decimal(2),
  PB: new Decimal(2),
  PE: new Decimal(2),
  PI: new Decimal(2),
  RN: new Decimal(2),
  SE: new Decimal(2),
}

export const ALIQUOTAS_ICMS_INTERESTADUAL: Record<string, Decimal> = {
  SP_MG: new Decimal(12),
  SP_PR: new Decimal(12),
  SP_RS: new Decimal(12),
  SP_RJ: new Decimal(12),
  SP_SC: new Decimal(12),
  default_sul_sudeste_co: new Decimal(12),
  default_norte_nordeste_es: new Decimal(7),
}

export const LIMITES_SIMPLES_NACIONAL = {
  sublimiteEstadual: new Decimal(3_600_000),
  limiteExclusao: new Decimal(4_800_000),
  alertaPreventivo: new Decimal(4_200_000),
}

export const PRESUNCAO_IRPJ: Record<string, Decimal> = {
  comercio_industria: new Decimal(8),
  servicos_gerais: new Decimal(32),
  servicos_profissionais: new Decimal(32),
  transporte_carga: new Decimal(8),
  transporte_passageiros: new Decimal(16),
  construcao_so_servico: new Decimal(32),
  construcao_com_material: new Decimal(8),
  atividade_rural: new Decimal(8),
  factoring: new Decimal(32),
}

export const PRESUNCAO_CSLL: Record<string, Decimal> = {
  comercio_industria: new Decimal(12),
  servicos_gerais: new Decimal(32),
  servicos_profissionais: new Decimal(32),
  atividade_rural: new Decimal(12),
}

export const TABELA_SIMPLES_NACIONAL = {
  ANEXO_I: [
    {
      limiteInferior: new Decimal(0),
      limiteSuperior: new Decimal(180000),
      aliquota: new Decimal(4),
      deducao: new Decimal(0),
    },
    {
      limiteInferior: new Decimal(180000.01),
      limiteSuperior: new Decimal(360000),
      aliquota: new Decimal(7.3),
      deducao: new Decimal(5940),
    },
    {
      limiteInferior: new Decimal(360000.01),
      limiteSuperior: new Decimal(720000),
      aliquota: new Decimal(9.5),
      deducao: new Decimal(13860),
    },
    {
      limiteInferior: new Decimal(720000.01),
      limiteSuperior: new Decimal(1800000),
      aliquota: new Decimal(10.7),
      deducao: new Decimal(22500),
    },
    {
      limiteInferior: new Decimal(1800000.01),
      limiteSuperior: new Decimal(3600000),
      aliquota: new Decimal(14.3),
      deducao: new Decimal(87300),
    },
    {
      limiteInferior: new Decimal(3600000.01),
      limiteSuperior: new Decimal(4800000),
      aliquota: new Decimal(19),
      deducao: new Decimal(378000),
    },
  ],
  ANEXO_III: [
    {
      limiteInferior: new Decimal(0),
      limiteSuperior: new Decimal(180000),
      aliquota: new Decimal(6),
      deducao: new Decimal(0),
    },
    {
      limiteInferior: new Decimal(180000.01),
      limiteSuperior: new Decimal(360000),
      aliquota: new Decimal(11.2),
      deducao: new Decimal(9360),
    },
    {
      limiteInferior: new Decimal(360000.01),
      limiteSuperior: new Decimal(720000),
      aliquota: new Decimal(13.5),
      deducao: new Decimal(17640),
    },
    {
      limiteInferior: new Decimal(720000.01),
      limiteSuperior: new Decimal(1800000),
      aliquota: new Decimal(16),
      deducao: new Decimal(35640),
    },
    {
      limiteInferior: new Decimal(1800000.01),
      limiteSuperior: new Decimal(3600000),
      aliquota: new Decimal(21),
      deducao: new Decimal(125640),
    },
    {
      limiteInferior: new Decimal(3600000.01),
      limiteSuperior: new Decimal(4800000),
      aliquota: new Decimal(33),
      deducao: new Decimal(648000),
    },
  ],
  ANEXO_V: [
    {
      limiteInferior: new Decimal(0),
      limiteSuperior: new Decimal(180000),
      aliquota: new Decimal(15.5),
      deducao: new Decimal(0),
    },
    {
      limiteInferior: new Decimal(180000.01),
      limiteSuperior: new Decimal(360000),
      aliquota: new Decimal(18),
      deducao: new Decimal(4500),
    },
    {
      limiteInferior: new Decimal(360000.01),
      limiteSuperior: new Decimal(720000),
      aliquota: new Decimal(19.5),
      deducao: new Decimal(9900),
    },
    {
      limiteInferior: new Decimal(720000.01),
      limiteSuperior: new Decimal(1800000),
      aliquota: new Decimal(20.5),
      deducao: new Decimal(17100),
    },
    {
      limiteInferior: new Decimal(1800000.01),
      limiteSuperior: new Decimal(3600000),
      aliquota: new Decimal(23),
      deducao: new Decimal(62100),
    },
    {
      limiteInferior: new Decimal(3600000.01),
      limiteSuperior: new Decimal(4800000),
      aliquota: new Decimal(30.5),
      deducao: new Decimal(540000),
    },
  ],
}
