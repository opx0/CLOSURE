import { replay } from '@closer/core'
import type { GapEntry } from '@closer/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { dim, heading, line } from '../terminal.ts'
import { CLAIM_SET_SESSION } from './claims.ts'
import { runSession } from '@closer/core'
import { fromEnv } from '../adapters/index.ts'
import { RandomIds, SystemClock } from '../runtime.ts'
import { terminalIo } from './session.ts'

// Its own session, not a retest in the sitting that opened the gap — that would measure memory of
// the feedback, not whether the skill generalised.
export async function transfer(argv: readonly string[]): Promise<number> {
  const config = loadCliConfig()
  const { store } = openStore(config)

  const drilled = new Map<string, GapEntry>()
  for (const sessionId of await store.listSessions()) {
    for (const gap of replay(await store.read(sessionId)).gaps.values()) {
      const known = drilled.get(gap.id)
      if (known === undefined || gap.lastTouchedAt >= known.lastTouchedAt) drilled.set(gap.id, gap)
    }
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

  const claimSet = replay(await store.read(CLAIM_SET_SESSION))
  const claim = target.claimId === undefined ? undefined : claimSet.claims.get(target.claimId)
  if (claim === undefined) {
    line(`gap ${target.id} is not attached to a claim; transfer needs one.`)
    return 1
  }

  const { conductor, evaluator } = fromEnv(process.env)
  heading('transfer test')
  line(target.summary)
  dim('  the same idea, different constraints. Passing this is what closes the gap.')

  const result = await runSession({
    claims: [claim],
    rounds: ['project_deep_dive'],
    mode: 'transfer',
    level: 'mid',
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

  dim(`session ${result.sessionId} · see it with: closer ledger`)
  return 0
}
