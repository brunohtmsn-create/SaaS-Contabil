export class S3KeyBuilder {
  static xmlNFeEmitida(cnpj: string, competencia: string, chave: string): string {
    return `${cnpj}/${competencia}/notas-emitidas/nfe/${chave}.xml`
  }

  static pdfNFeEmitida(cnpj: string, competencia: string, chave: string): string {
    return `${cnpj}/${competencia}/notas-emitidas/nfe/${chave}-danfe.pdf`
  }

  static xmlNFCeEmitida(cnpj: string, competencia: string, chave: string): string {
    return `${cnpj}/${competencia}/notas-emitidas/nfce/${chave}.xml`
  }

  static xmlNFSe(cnpj: string, competencia: string, numero: string, ibge: string): string {
    return `${cnpj}/${competencia}/notas-emitidas/nfse/${numero}-${ibge}.xml`
  }

  static xmlNFSeTomada(cnpj: string, competencia: string, ibge: string, numero: string): string {
    return `${cnpj}/${competencia}/notas-tomadas/nfse-prefeitura/${ibge}/${numero}.xml`
  }

  static guiaDAS(cnpj: string, competencia: string): string {
    return `${cnpj}/${competencia}/guias/das-${competencia}.pdf`
  }

  static guiaGNRE(cnpj: string, competencia: string, uf: string): string {
    return `${cnpj}/${competencia}/guias/gnre-${uf}-${competencia}.pdf`
  }

  static guiaISS(cnpj: string, competencia: string, ibge: string): string {
    return `${cnpj}/${competencia}/guias/iss-${ibge}-${competencia}.pdf`
  }

  static relatorioConciliacao(cnpj: string, competencia: string, tipo: string): string {
    return `${cnpj}/${competencia}/relatorios/conciliacao-${tipo}-${competencia}.xlsx`
  }

  static apuracaoPGDAS(cnpj: string, competencia: string): string {
    return `${cnpj}/${competencia}/relatorios/apuracao-pgdas-${competencia}.pdf`
  }

  static memoriaCalcDifal(cnpj: string, competencia: string): string {
    return `${cnpj}/${competencia}/relatorios/memoria-calculo-difal-${competencia}.pdf`
  }

  static reciboObrigacao(cnpj: string, competencia: string, tipo: string): string {
    return `${cnpj}/${competencia}/obrigacoes/${tipo}-${competencia}-recibo.xml`
  }

  static lancamentosContabeis(cnpj: string, competencia: string): string {
    return `${cnpj}/${competencia}/contabil/lancamentos-${competencia}.json`
  }

  static ecdArquivo(cnpj: string, ano: string): string {
    return `${cnpj}/${ano}/contabil/ecd-${ano}.txt`
  }

  static erroScreenshot(cnpj: string, jobId: string): string {
    return `${cnpj}/erros/screenshots/${jobId}-${Date.now()}.png`
  }

  static erroLog(cnpj: string, jobId: string): string {
    return `${cnpj}/erros/logs/${jobId}-${Date.now()}.json`
  }

  static auditoriaEvidencia(tenantId: string, auditEventId: string, filename: string): string {
    return `auditoria/evidencias/${auditEventId}/${filename}`
  }
}
