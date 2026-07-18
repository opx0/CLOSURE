import { planNextSession, replay } from '@closer/core'
import type { GapEntry } from '@closer/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { SystemClock } from '../runtime.ts'
import { dim, heading, line } from '../terminal.ts'

const REASON: Record<string, string> = {
  drill_the_open_gap: 'open — drill it',
  transfer_the_drilled_gap: 'drilled — retest it under changed constraints',
  retrieve_the_closed_gap: 'closed — due for unannounced retrieval',
  restate_the_unverified: 'never judged — ask for it explicitly',
}

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

export async function next(argv: readonly string[]): Promise<number> {
  const config = loadCliConfig()
  const { store, close } = openStore(config)

  try {
    const gaps = new Map<string, GapEntry>()
    for (const sessionId of await store.listSessions()) {
      for (const gap of replay(await store.read(sessionId)).gaps.values()) {
        const known = gaps.get(gap.id)
        if (known === undefined || gap.lastTouchedAt >= known.lastTouchedAt) gaps.set(gap.id, gap)
      }
    }

    const plan = planNextSession({
      gaps: [...gaps.values()],
      now: new SystemClock().now(),
      horizonDays: Number(flag(argv, 'horizon') ?? '7'),
      retrievalLimit: 3,
    })

    heading('what is due')
    if (plan.work.length === 0) {
      dim('  nothing is due in this horizon.')
      return 0
    }
    for (const entry of plan.work) {
      line(`  ${entry.dueAt.slice(0, 10)}  ${entry.gap.summary}`)
      dim(`            ${entry.gap.competency} · ${REASON[entry.reason] ?? entry.reason}`)
    }

    line('')
    dim(`  suggested rounds: ${plan.suggestedRounds.join(', ')}`)
    dim(`  closer session --rounds ${plan.suggestedRounds.join(',')}`)
    if (plan.retrievals.length > 0) {
      dim(
        `  ${plan.retrievals.length} of these arrive inside the session unannounced — that is deliberate.`,
      )
    }
    return 0
  } finally {
    await close()
  }
}
