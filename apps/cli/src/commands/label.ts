import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { replay } from '@closer/core'
import type { ClaimAbstention, ClaimVerdict, Finding } from '@closer/contracts'
import { CLAIM_VERDICT_ORDER } from '@closer/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { ask, dim, heading, line, quote } from '../terminal.ts'

// One line per labelled item, appended and never rewritten. `labeller` must be disclosed in every
// report — a solo self-labeller is exactly the thing that has to be stated, not glossed over.
export interface ClaimLabel {
  kind: 'claim_verdict'
  itemId: string
  verdict: ClaimVerdict
  labeller: string
  labelledAt: string
  note: string
}

// The four ordinal statuses only — Krippendorff's ordinal alpha has no point for an abstention, so
// it's never offered here; skipping is the honest move for an item the labeller can't place.
const CHOICES: readonly ClaimVerdict[] = [...CLAIM_VERDICT_ORDER]

const DEFAULT_PATH = 'fixtures/labels/claims.jsonl'

async function alreadyLabelled(path: string): Promise<Set<string>> {
  try {
    const text = await readFile(path, 'utf8')
    return new Set(
      text
        .split('\n')
        .filter((row) => row.trim() !== '')
        .filter((row) => !row.trimStart().startsWith('#'))
        .map((row) => (JSON.parse(row) as ClaimLabel).itemId),
    )
  } catch {
    return new Set()
  }
}

function judged(finding: Finding): ClaimVerdict | ClaimAbstention | null {
  if (finding.kind === 'claim') return finding.verdict
  if (finding.kind === 'claim_abstained') return finding.abstention
  return null
}

export async function label(argv: readonly string[]): Promise<number> {
  const config = loadCliConfig()
  const { store } = openStore(config)
  const at = argv.indexOf('--out')
  const path = at === -1 ? DEFAULT_PATH : (argv[at + 1] ?? DEFAULT_PATH)
  const who = await ask('who is labelling? (recorded in every report)')
  if (who === '') {
    line(
      'a label with no labeller cannot be disclosed, and an undisclosed labeller is not a label.',
    )
    return 1
  }

  const done = await alreadyLabelled(path)
  await mkdir(dirname(path), { recursive: true })
  let added = 0

  heading('labelling')
  // Verdict shown after the evidence, deliberately — seeing it first biases the label toward agreement.
  dim("  you see the claim and the exact words first; the model's verdict comes after your call.")

  for (const sessionId of await store.listSessions()) {
    const view = replay(await store.read(sessionId))
    for (const finding of view.findings) {
      const modelVerdict = judged(finding)
      if (modelVerdict === null || done.has(finding.id)) continue
      const claim = view.claims.get(
        finding.kind === 'claim' || finding.kind === 'claim_abstained' ? finding.claimId : '',
      )
      if (claim === undefined) continue

      line('')
      line(`claim: ${claim.assertion}`)
      for (const spanId of finding.transcriptSpanIds) {
        const span = view.spans.get(spanId)
        if (span !== undefined) quote(span.quoted)
      }
      CHOICES.forEach((choice, index) => dim(`  ${index + 1}. ${choice.replace(/_/g, ' ')}`))

      const answer = await ask(`your verdict [1-${CHOICES.length}, or s to skip]:`)
      if (answer === 's' || answer === '') continue
      const chosen = CHOICES[Number(answer) - 1]
      if (chosen === undefined) {
        dim('  not one of the four — skipped rather than guessed.')
        continue
      }

      const note = await ask('note (optional):')
      const row: ClaimLabel = {
        kind: 'claim_verdict',
        itemId: finding.id,
        verdict: chosen,
        labeller: who,
        labelledAt: new Date().toISOString(),
        note,
      }
      await appendFile(path, `${JSON.stringify(row)}\n`)
      added += 1
      dim(`  model said: ${modelVerdict.replace(/_/g, ' ')}`)
    }
  }

  const total = done.size + added
  line('')
  line(`${added} labelled this pass · ${total} in ${path}`)
  // Pre-declared: the flagship agreement gate does not fire below n = 100.
  if (total < 100) {
    dim(`  ${100 - total} short of the n = 100 the flagship agreement gate needs before it fires.`)
    dim('  below that, alpha ships with its interval and no pass or fail is asserted.')
  }
  return 0
}
