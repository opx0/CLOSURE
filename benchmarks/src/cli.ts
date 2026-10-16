import { join } from 'node:path'
import { rubricSetV1 } from '@levelhead/core'
import type { ArmContext } from './arms/arm.ts'
import { ALL_ARMS } from './arms/index.ts'
import { loadFixtures } from './fixtures.ts'
import { LabelIndex, loadLabels } from './labels.ts'
import { runBenchmark } from './run.ts'
import type { GateBar } from './contract.ts'

// bun run benchmarks/src/cli.ts --fixtures <dir> --out <dir> [--dry-run] [--ports <module>]
//                               [--bar self_use|flagship] [--labels <file>] [--seed <int>]

interface Options {
  fixtures: string
  out: string
  labels: string | null
  ports: string | null
  bar: GateBar
  seed: number
  dryRun: boolean
}

export function parseArgs(argv: readonly string[]): Options | string {
  const options: Options = {
    fixtures: '',
    out: '',
    labels: null,
    ports: null,
    bar: 'self_use',
    seed: 1,
    dryRun: false,
  }

  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at]
    const value = argv[at + 1]
    switch (flag) {
      case '--dry-run':
        options.dryRun = true
        break
      case '--fixtures':
      case '--out':
      case '--labels':
      case '--ports':
      case '--bar':
      case '--seed': {
        if (value === undefined) return `${flag} needs a value`
        at += 1
        if (flag === '--fixtures') options.fixtures = value
        else if (flag === '--out') options.out = value
        else if (flag === '--labels') options.labels = value
        else if (flag === '--ports') options.ports = value
        else if (flag === '--seed') options.seed = Number.parseInt(value, 10)
        else if (value === 'self_use' || value === 'flagship') options.bar = value
        else return `--bar must be self_use or flagship, got ${value}`
        break
      }
      default:
        return `unknown argument ${String(flag)}`
    }
  }

  if (options.fixtures === '') return '--fixtures <dir> is required'
  if (options.out === '') return '--out <dir> is required'
  if (!Number.isInteger(options.seed)) return '--seed must be an integer'
  return options
}

// No default: a benchmark that invented its own ports would be measuring a stub.
type PortsFactory = () => Pick<
  ArmContext,
  'conductor' | 'evaluator' | 'clock' | 'ids' | 'ceilings' | 'alternateConductors'
>

async function loadPorts(path: string): Promise<PortsFactory | string> {
  const loaded: unknown = await import(path)
  const factory =
    typeof loaded === 'object' && loaded !== null && 'default' in loaded
      ? (loaded as { default: unknown }).default
      : null
  return typeof factory === 'function'
    ? (factory as PortsFactory)
    : `${path} must default-export a function returning the model ports`
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv)
  if (typeof options === 'string') {
    process.stderr.write(`${options}\n`)
    return 2
  }

  const loaded = await loadFixtures(options.fixtures)
  for (const error of loaded.errors) process.stderr.write(`fixtures: ${error}\n`)
  if (loaded.fixtures === null) return 1
  const fixtures = loaded.fixtures

  const parsedLabels =
    options.labels === null ? { labels: [], errors: [] } : await loadLabels(options.labels)
  for (const error of parsedLabels.errors) process.stderr.write(`labels: ${error}\n`)
  const labels = new LabelIndex(parsedLabels.labels)

  const runId = `${fixtures.id}-v${fixtures.version}-${new Date().toISOString().replace(/[:.]/g, '-')}`

  if (options.dryRun) {
    // No metric, no gate, no interval - a dry run has produced no outcome to report.
    const lines = [
      `fixture set  ${fixtures.id} v${fixtures.version}${fixtures.synthetic ? ' (SYNTHETIC)' : ''}`,
      `resumes      ${fixtures.resumes.length}`,
      `items        ${fixtures.items.length}`,
      `injections   ${fixtures.items.filter((item) => item.injection !== null).length}`,
      `labels       ${parsedLabels.labels.length} records from ${labels.labellers().length} labeller(s)`,
      `bar          ${options.bar}`,
      `arms         ${ALL_ARMS.map((arm) => arm.id).join(', ')}`,
      `ports        ${options.ports ?? '(none supplied - a real run would refuse)'}`,
      `would write  ${join(options.out, runId, 'report.json')}`,
      `             and append one line to ${join(options.out, 'runs.jsonl')}`,
      '',
      'dry run: nothing was executed, so this report contains no results.',
    ]
    process.stdout.write(`${lines.join('\n')}\n`)
    return 0
  }

  if (options.ports === null) {
    process.stderr.write(
      '--ports <module> is required for a real run: the benchmark will not fabricate model ports.\n',
    )
    return 2
  }
  const factory = await loadPorts(options.ports)
  if (typeof factory === 'string') {
    process.stderr.write(`${factory}\n`)
    return 2
  }

  const ports = factory()
  const context: ArmContext = {
    ...ports,
    level: 'mid',
    mode: 'coach',
    personaId: 'skeptic',
    rubricSet: rubricSetV1,
    maxTurns: 4,
  }

  const { report, reportPath } = await runBenchmark({
    fixtures,
    labels,
    arms: ALL_ARMS,
    context,
    outDir: options.out,
    runId,
    configuredModelAlias: process.env['MODEL_ALIAS'] ?? 'unset',
    bar: options.bar,
    invariants: [],
    seed: options.seed,
    repeatedRunVariance: null,
  })

  process.stdout.write(`report written: ${reportPath}\n`)
  for (const gate of report.gates.results) {
    process.stdout.write(`  ${gate.status.padEnd(7)} ${gate.id} - ${gate.reason}\n`)
  }
  for (const stop of report.stopConditions) {
    process.stdout.write(`  ${stop.status.padEnd(9)} stop condition ${stop.id}\n`)
  }
  process.stdout.write(
    `claims permitted: ${report.gates.claimsPermitted} - ${report.gates.claimsPermittedReason}\n`,
  )

  // A failing gate is not a failing command - exiting non-zero would give someone a reason not to run it.
  return 0
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
