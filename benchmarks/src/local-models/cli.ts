import { readFile, writeFile } from 'node:fs/promises'
import { preflightLocalModels } from './preflight.ts'

const [, , manifestPath, reportPath] = process.argv
if (!manifestPath || !reportPath || process.argv.length !== 4)
  throw new Error('Usage: bun run models:preflight CANDIDATES.json NEW_REPORT.json')
const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
const report = await preflightLocalModels(manifest)
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(`Checked ${report.candidates.length} local candidate(s); no model selected or invoked.`)
