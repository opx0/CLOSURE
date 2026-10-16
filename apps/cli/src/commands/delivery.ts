import { readFile } from 'node:fs/promises'
import { SessionLog, measureDelivery, renderDelivery, replay } from '@levelhead/core'
import type { SpokenTurn } from '@levelhead/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { RandomIds, SystemClock } from '../runtime.ts'
import { dim, heading, line } from '../terminal.ts'

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

// Voice reports pace, pauses and filler words and nothing else. These observations are recorded
// beside the interview and never enter a finding, the rubric, or the gap ledger.
export async function delivery(argv: readonly string[]): Promise<number> {
  const sessionId = flag(argv, 'session')
  if (sessionId === undefined) {
    line('levelhead delivery --session <id> [--from <spoken-turn.json>]')
    return 1
  }

  const config = loadCliConfig()
  const { store, close } = openStore(config)

  try {
    const events = await store.read(sessionId)
    if (events.length === 0) {
      line(`no such session: ${sessionId}`)
      return 1
    }

    const source = flag(argv, 'from')
    if (source === undefined) {
      const reports = replay(events).delivery
      heading('delivery observations')
      if (reports.length === 0) {
        dim('  none recorded for this session.')
        return 0
      }
      for (const report of reports) {
        line(`  attempt ${report.attemptId}`)
        for (const row of renderDelivery(report)) line(row)
        line('')
      }
      return 0
    }

    const turn = JSON.parse(await readFile(source, 'utf8')) as SpokenTurn
    const view = replay(events)
    if (!view.attempts.has(turn.attemptId)) {
      line(`attempt ${turn.attemptId} is not part of session ${sessionId}`)
      return 1
    }

    const report = measureDelivery(turn)
    const log = await SessionLog.open(
      { store, clock: new SystemClock(), ids: new RandomIds() },
      sessionId,
    )
    await log.append('state_change', { change: 'delivery_recorded', report })

    heading('delivery observations')
    for (const row of renderDelivery(report)) line(row)
    return 0
  } finally {
    await close()
  }
}
