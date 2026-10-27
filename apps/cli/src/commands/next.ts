import { gapsAcrossViews } from '@levelhead/core'
import { planNextSession, replay, topicById } from '@levelhead/core'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { SystemClock } from '../runtime.ts'
import { dim, heading, line } from '../terminal.ts'
import { topicLabel } from './catalog.ts'

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
    const views = await Promise.all(
      (await store.listSessions()).map(async (id) => replay(await store.read(id))),
    )
    const gaps = gapsAcrossViews(views)

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
      const topic = entry.gap.topicId === undefined ? undefined : topicById(entry.gap.topicId)
      line(`  ${entry.dueAt.slice(0, 10)}  ${entry.gap.summary}`)
      dim(
        `            ${topic === undefined ? '' : `${topicLabel(topic)} · `}${entry.gap.competency} · ${REASON[entry.reason] ?? entry.reason}`,
      )
    }

    line('')
    if (plan.suggestedRounds.length > 0) {
      dim(`  suggested rounds: ${plan.suggestedRounds.join(', ')}`)
      dim(`  levelhead session --rounds ${plan.suggestedRounds.join(',')}`)
    }
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
