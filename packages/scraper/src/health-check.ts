/**
 * CLI de health check dos adapters de prefeitura.
 *
 * Uso:
 *   pnpm scraper:health-check                  # todas as prefeituras
 *   pnpm scraper:health-check --ibge=3550308   # uma prefeitura específica
 *
 * Sai com código 1 se qualquer portal verificado estiver indisponível.
 */

import { ScraperOrchestrator } from './scraper-orchestrator.js'

async function main(): Promise<void> {
  const argIbge = process.argv.find((a) => a.startsWith('--ibge='))
  const ibge = argIbge?.split('=')[1]

  const orchestrator = new ScraperOrchestrator()

  if (ibge) {
    console.log(`Health check — prefeitura IBGE ${ibge}...`)
    const ok = await orchestrator.healthCheckPrefeitura(ibge)
    console.log(`  ${ok ? '✅ DISPONÍVEL' : '❌ INDISPONÍVEL'} — ${ibge}`)
    process.exit(ok ? 0 : 1)
  }

  const total = orchestrator.listarPrefeituras().length
  console.log(`Health check — ${total} prefeituras registradas...\n`)

  const resultados = await orchestrator.healthCheckPrefeituras()
  const ordenados = [...resultados.entries()].sort(([a], [b]) => a.localeCompare(b))

  let falhas = 0
  for (const [codigo, ok] of ordenados) {
    if (!ok) falhas++
    console.log(`  ${ok ? '✅' : '❌'} ${codigo}`)
  }

  console.log(`\n${total - falhas}/${total} portais disponíveis`)
  process.exit(falhas > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Erro no health check:', err instanceof Error ? err.message : err)
  process.exit(1)
})
