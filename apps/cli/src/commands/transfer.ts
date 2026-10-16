import { AREA_ROUND, replay, topicById } from '@levelhead/core'
import type { GapEntry, Level } from '@levelhead/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { dim, heading, line } from '../terminal.ts'
import { CLAIM_SET_SESSION } from './claims.ts'
import { runSession } from '@levelhead/core'
import { fromEnv } from '../adapters/index.ts'
import { RandomIds, SystemClock } from '../runtime.ts'
import { terminalIo } from './session.ts'

// Its own session, not a retest in the sitting that opened the gap — that would measure memory of
// the feedback, not whether the skill generalised.
export async function transfer(argv: readonly string[]): Promise<number> {
  const config = loadCliConfig()
  const { store } = openStore(config)

  const drilled = new Map<string, GapEntry>()
  const judgedAt = new Map<string, Level>()
  for (const sessionId of await store.listSessions()) {
    const view = replay(await store.read(sessionId))
    for (const gap of view.gaps.values()) {
      const known = drilled.get(gap.id)
      if (known === undefined || gap.lastTouchedAt >= known.lastTouchedAt) drilled.set(gap.id, gap)
    }
    for (const finding of view.findings) judgedAt.set(finding.id, finding.level)
  }

  const at = argv.indexOf('--gap')
  const wanted = at === -1 ? undefined : argv[at + 1]
  const waiting = [...drilled.values()].filter((gap) => gap.status === 'drilled')
  const target = wanted === undefined ? waiting[0] : waiting.find((gap) => gap.id === wanted)
  if (target === undefined) {
    line('no gap is waiting for a transfer test — drill one first.')
    dim('  a gap reaches "drilled" when a drill lands; only a transfer closes it.')
    for (const gap of waiting) dim(`  ${gap.id}  ${gap.summary}`)
    return 1
  }

  const topic = target.topicId === undefined ? undefined : topicById(target.topicId)
  const claimSet = replay(await store.read(CLAIM_SET_SESSION))
  const claim = target.claimId === undefined ? undefined : claimSet.claims.get(target.claimId)
  if (topic === undefined && claim === undefined) {
    line(`gap ${target.id} is not attached to a claim or a topic; transfer needs one.`)
    return 1
  }

  const { conductor, evaluator } = fromEnv(process.env)
  heading('transfer test')
  line(target.summary)
  dim('  the same idea, different constraints. Passing this is what closes the gap.')

  const result = await runSession({
    claims: claim === undefined ? [] : [claim],
    ...(topic === undefined ? {} : { topics: [topic] }),
    rounds: [topic === undefined ? 'project_deep_dive' : AREA_ROUND[topic.area]],
    mode: 'transfer',
    // Retested against the anchor it failed, not a different bar.
    level:
      target.findingIds.map((id) => judgedAt.get(id)).find((level) => level !== undefined) ?? 'mid',
    personaId: 'skeptic',
    pressureCeiling: 1,
    turnsPerRound: 1,
    drill: false,
    transferGap: target,
    ceilings: {
      sessionCostUsd: config.sessionCostCeilingUsd,
      sessionTokens: config.sessionTokenCeiling,
      modelCallsPerTurn: config.modelCallsPerTurnCeiling,
    },
    deps: {
      store,
      clock: new SystemClock(),
      ids: new RandomIds(),
      conductor,
      evaluator,
      io: terminalIo(),
    },
  })

  dim(`session ${result.sessionId} · see it with: levelhead ledger`)
  return 0
}
