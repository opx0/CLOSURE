import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  SessionLog,
  extractClaims,
  claimsExtractedPayload,
  claimConfirmedPayload,
  replay,
} from '@closer/core'
import type { Claim } from '@closer/contracts'
import { openStore } from '../store.ts'
import { fromEnv } from '../adapters/index.ts'
import { loadCliConfig } from '../config.ts'
import { SystemClock, RandomIds } from '../runtime.ts'
import { ask, dim, heading, line, quote } from '../terminal.ts'

// Not owned by any one interview, so it gets its own log — a session only ever reads it.
export const CLAIM_SET_SESSION = 'claims'

function describe(claim: Claim): string {
  const facts = [...claim.technologies, ...claim.metrics].join(' · ')
  return facts ? `${claim.assertion} — ${facts}` : claim.assertion
}

export async function claims(argv: readonly string[]): Promise<number> {
  const path = argv.find((arg) => !arg.startsWith('--'))
  // A deliberate choice made once, not the default the flow drifts into.
  const assumeYes = argv.includes('--yes')
  if (path === undefined) {
    line('usage: closer claims <resume.md>')
    return 1
  }

  const config = loadCliConfig()
  const resumeText = await readFile(path, 'utf8')
  const sourceId = `resume:${createHash('sha256').update(resumeText).digest('hex').slice(0, 12)}`

  const { store } = openStore(config)
  const clock = new SystemClock()
  const ids = new RandomIds()
  const log = await SessionLog.open({ store, clock, ids }, CLAIM_SET_SESSION)
  const { evaluator } = fromEnv(process.env)

  const already = replay(await store.read(CLAIM_SET_SESSION))
  if (!already.sources.has(sourceId)) {
    await log.append('state_change', {
      change: 'source_registered',
      sourceId,
      kind: 'resume',
      text: resumeText,
      contentHash: createHash('sha256').update(resumeText).digest('hex'),
    })
  }

  heading(`reading ${path}`)
  const result = await extractClaims({ resumeText, sourceId, evaluator, ids, clock })
  if ('failed' in result) {
    line(`extraction failed: ${result.failed.kind}`)
    dim('  Nothing was written. A failure is reported as a failure, never as an empty claim set.')
    return 1
  }

  await log.append('state_change', claimsExtractedPayload(result))

  heading(`${result.claims.length} claims`)
  for (const rejected of result.rejected) {
    dim(`  skipped: ${rejected.reason} — "${rejected.quote.slice(0, 60)}"`)
  }

  // An implied claim is offered, never silently entered into play.
  let confirmed = 0
  for (const [index, claim] of result.claims.entries()) {
    const span = result.spans.find((candidate) => candidate.id === claim.spanId)
    line('')
    line(`${index + 1}. ${describe(claim)}`)
    if (span) quote(span.quoted)
    if (claim.implied) dim('   implied by your wording, not stated — do you want to defend this?')

    const answer = assumeYes ? 'y' : (await ask(`   keep it? [Y/n/edit]`)).toLowerCase()
    if (answer === 'n' || answer === 'no') {
      await log.append(
        'state_change',
        claimConfirmedPayload({ claimId: claim.id, confirmed: false }),
      )
      continue
    }
    if (answer === 'e' || answer === 'edit') {
      const edited = await ask('   corrected assertion:')
      await log.append(
        'state_change',
        claimConfirmedPayload({ claimId: claim.id, confirmed: true, editedAssertion: edited }),
      )
      confirmed += 1
      continue
    }
    await log.append('state_change', claimConfirmedPayload({ claimId: claim.id, confirmed: true }))
    confirmed += 1
  }

  line('')
  line(`${confirmed} claims in play. Interrogate one with: closer session`)
  return 0
}
