import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface GateVerdict {
  open: boolean
  reason: string
  runId: string | null
}

interface StoredReport {
  manifest: { runId: string; startedAt: string }
  syntheticFixtureData: boolean
  gates: {
    results: { id: string; status: string; bar: string; reason: string }[]
    claimsPermitted: boolean
    claimsPermittedReason: string
  }
}

const GAPS_PER_QUESTION = 'gaps_per_question'

// ADR-011 and STACK §19: an MCP surface is built only once the benchmark beats a baseline. The code
// exists; this is what decides whether it may serve. It reads published reports and nothing else —
// there is no override flag, because a gate with an override is a suggestion.
export async function agentInterfaceGate(reportsDir: string): Promise<GateVerdict> {
  let entries: string[]
  try {
    entries = await readdir(reportsDir)
  } catch {
    return {
      open: false,
      reason: `no benchmark reports under ${reportsDir}; the agent interface is gated behind beating a baseline, and nothing has been run`,
      runId: null,
    }
  }

  const reports: StoredReport[] = []
  for (const entry of entries) {
    try {
      reports.push(JSON.parse(await readFile(join(reportsDir, entry, 'report.json'), 'utf8')))
    } catch {
      continue
    }
  }
  if (reports.length === 0) {
    return { open: false, reason: `no readable report.json under ${reportsDir}`, runId: null }
  }

  reports.sort((left, right) => right.manifest.startedAt.localeCompare(left.manifest.startedAt))
  const latest = reports[0] as StoredReport

  if (latest.syntheticFixtureData) {
    return {
      open: false,
      reason: `run ${latest.manifest.runId} was over synthetic fixture data; a result over constructed inputs does not open this gate`,
      runId: latest.manifest.runId,
    }
  }
  if (!latest.gates.claimsPermitted) {
    return {
      open: false,
      reason: `run ${latest.manifest.runId}: ${latest.gates.claimsPermittedReason}`,
      runId: latest.manifest.runId,
    }
  }

  const beat = latest.gates.results.find((gate) => gate.id === GAPS_PER_QUESTION)
  if (beat === undefined || beat.status !== 'pass') {
    return {
      open: false,
      reason: `run ${latest.manifest.runId}: the ${GAPS_PER_QUESTION} gate is ${beat?.status ?? 'absent'} — ${beat?.reason ?? 'it was never evaluated'}`,
      runId: latest.manifest.runId,
    }
  }

  return {
    open: true,
    reason: `run ${latest.manifest.runId} passes ${GAPS_PER_QUESTION}: ${beat.reason}`,
    runId: latest.manifest.runId,
  }
}
