import {
  DEFAULT_ROLE_ID,
  dueForRetrieval,
  interviewFormat,
  planFromFormat,
  renderLedger,
  replay,
  rolePack,
  roleRounds,
  validationNotice,
} from '@closer/core'
import type {
  Claim,
  Finding,
  GapEntry,
  Level,
  Mode,
  PersonaId,
  RoleId,
  RoundKind,
} from '@closer/contracts'
import type { PressureLevel } from '@closer/core'
import { GitRepository } from '../repo/git-repository.ts'
import { REPO_SESSION } from './repo.ts'
import { ask } from '../terminal.ts'
import { openStore } from '../store.ts'
import { fromEnv } from '../adapters/index.ts'
import { loadCliConfig } from '../config.ts'
import { RandomIds, SystemClock } from '../runtime.ts'
import { runSession, type SessionIo } from '@closer/core'
import { CLAIM_SET_SESSION } from './claims.ts'
import { askParagraph, dim, heading, line, quote } from '../terminal.ts'

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

// §4.4's own wording: a confidence is stated, not hidden, and never rounded into a verdict.
function confidenceWord(confidence: number): string {
  if (confidence >= 0.75) return 'high'
  if (confidence >= 0.4) return 'medium'
  return 'low'
}

function printFinding(finding: Finding, quotes: ReadonlyMap<string, string>): void {
  const headline =
    finding.kind === 'claim'
      ? `Finding — claim ${finding.verdict.replace(/_/g, ' ')}.`
      : finding.kind === 'claim_abstained'
        ? `Finding — abstained: ${finding.abstention.replace(/_/g, ' ')}.`
        : finding.kind === 'composure'
          ? `Composure — ${finding.signals.join(', ').replace(/_/g, ' ')}.`
          : `Finding — ${finding.competency.replace(/_/g, ' ')}, met ${finding.levelMet ?? 'no level anchor'}.`

  line('')
  line(headline)
  line(`  ${finding.rationale}`)
  for (const evidenceId of finding.evidenceIds) {
    const quoted = quotes.get(evidenceId)
    if (quoted !== undefined) quote(quoted)
  }
  dim(
    `  confidence: ${confidenceWord(finding.confidence)} (${finding.confidence.toFixed(2)}) · rubric ${finding.rubric.id} v${finding.rubric.version} · judged at ${finding.level}`,
  )
}

// Shared with `closer transfer`, so a transfer session looks and reads like the interrogation it retests.
const ROUND_LABEL: Record<RoundKind, string> = {
  project_deep_dive: 'project deep-dive',
  design_extension: 'design extension',
  behavioral: 'behavioural, with evidence',
  code_walkthrough: 'code walkthrough',
}

export function terminalIo(): SessionIo {
  return {
    round(kind, index, total, brief) {
      heading(`round ${index + 1} of ${total} — ${ROUND_LABEL[kind]}`)
      if (brief !== undefined) line(brief)
    },
    async confirmRetry() {
      const answer = (await ask('   answer that again? [y/N]')).toLowerCase()
      return answer === 'y' || answer === 'yes'
    },
    question(text, meta) {
      heading(
        `turn ${meta.turn + 1} · ${meta.action.toLowerCase().replace(/_/g, ' ')} · pressure ${meta.pressureLevel}`,
      )
      line(text)
    },
    async answer() {
      return askParagraph('')
    },
    findings(findings, quotes) {
      for (const finding of findings) printFinding(finding, quotes)
    },
    notice(text) {
      line('')
      dim(text)
    },
  }
}

export async function session(argv: readonly string[]): Promise<number> {
  const config = loadCliConfig()
  const { store } = openStore(config)
  const claimSet = replay(await store.read(CLAIM_SET_SESSION))

  const confirmed = [...claimSet.claims.values()].filter((claim) =>
    claimSet.confirmedClaimIds.has(claim.id),
  )
  if (confirmed.length === 0) {
    line('no confirmed claims yet — run: closer claims <resume.md>')
    return 1
  }

  const wanted = flag(argv, 'claim')
  let claims: Claim[] = confirmed
  if (wanted !== undefined) {
    const one = confirmed.find((candidate) => candidate.id === wanted)
    if (one === undefined) {
      line(`no confirmed claim with id ${wanted}`)
      for (const candidate of confirmed) dim(`  ${candidate.id}  ${candidate.assertion}`)
      return 1
    }
    claims = [one]
  }

  const roleId = (flag(argv, 'role') ?? DEFAULT_ROLE_ID) as RoleId
  if (rolePack(roleId) === undefined) {
    line(`no role pack named ${roleId} — run: closer roles`)
    return 1
  }

  // A format preset supplies rounds, persona, turns, pressure and level; an explicit flag still wins,
  // so the preset is a starting point rather than a mode you cannot leave.
  const formatId = flag(argv, 'format')
  const format = formatId === undefined ? undefined : interviewFormat(formatId)
  if (formatId !== undefined && format === undefined) {
    line(`no format named ${formatId} — run: closer formats`)
    return 1
  }
  const preset = format === undefined ? undefined : planFromFormat(format)

  const rounds = (flag(argv, 'rounds')?.split(',') ??
    preset?.rounds ??
    (flag(argv, 'role') === undefined
      ? ['project_deep_dive']
      : [...roleRounds(roleId)])) as RoundKind[]

  // Refused rather than degraded — without a pin, a walkthrough is a generic question wearing a citation.
  let pinned
  if (rounds.includes('code_walkthrough')) {
    const repoView = replay(await store.read(REPO_SESSION))
    if (repoView.snapshot === null) {
      line('a code walkthrough needs a pinned repository — run: closer repo <path>')
      return 1
    }
    const repository = new GitRepository({ ids: new RandomIds() })
    // Re-registers the earlier process's pin, so the walkthrough reads that commit, not today's tree.
    repository.register(repoView.snapshot)
    pinned = {
      snapshot: repoView.snapshot,
      artifacts: [...repoView.artifacts.values()],
      evidence: [...repoView.evidence.values()],
      repository,
    }
  }

  // Gathered across every log, because a gap outlives the session that closed it.
  const settled: GapEntry[] = []
  for (const sessionId of await store.listSessions()) {
    for (const gap of replay(await store.read(sessionId)).gaps.values()) {
      const known = settled.findIndex((other) => other.id === gap.id)
      if (known === -1) settled.push(gap)
      else if (gap.lastTouchedAt >= (settled[known]?.lastTouchedAt ?? '')) settled[known] = gap
    }
  }
  const retrievals = dueForRetrieval(settled, new Date().toISOString(), 3)
  if (retrievals.length > 0) {
    // Said to the operator, never to the candidate mid-session.
    dim(`  ${retrievals.length} earlier gap${retrievals.length === 1 ? '' : 's'} due for retrieval`)
  }

  const { conductor, evaluator } = fromEnv(process.env)
  heading(`${claims.length} claim${claims.length === 1 ? '' : 's'} in play`)
  for (const candidate of claims) dim(`  ${candidate.assertion}`)
  dim(`  ${validationNotice(roleId)}`)
  if (format !== undefined) {
    dim(`  format: ${format.label}`)
    dim(`  ${format.disclaimer}`)
  }

  const result = await runSession({
    claims,
    rounds,
    retrievals,
    ...(pinned === undefined ? {} : { pinned }),
    mode: (flag(argv, 'mode') ?? 'simulation') as Mode,
    level: (flag(argv, 'level') ?? preset?.level ?? 'mid') as Level,
    role: roleId,
    // Warm and gentle by default — skeptic/high pressure is a deliberate choice the candidate
    // opts into with a flag, not something a first run throws them into unannounced.
    personaId: (flag(argv, 'persona') ?? preset?.personaId ?? 'collaborator') as PersonaId,
    pressureCeiling: Number(
      flag(argv, 'pressure') ?? String(preset?.pressureCeiling ?? 1),
    ) as PressureLevel,
    turnsPerRound: Number(flag(argv, 'turns') ?? String(preset?.turnsPerRound ?? 6)),
    drill: !argv.includes('--no-drill'),
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

  const gaps = [...result.view.gaps.values()]
  if (gaps.length > 0) {
    const quotes = new Map<string, string>()
    for (const link of result.view.evidence.values()) {
      if (link.target.kind !== 'span') continue
      const span = result.view.spans.get(link.target.spanId)
      if (span !== undefined) quotes.set(link.id, span.quoted)
    }
    heading('gap ledger')
    for (const row of renderLedger(gaps, quotes)) line(row)
  }

  line('')
  dim(
    `session ${result.sessionId} · stopped by ${result.stoppedBy} · ${result.view.invocations.length} model calls · $${result.view.totals.costUsd.toFixed(4)}`,
  )
  dim(`replay it with: closer replay ${result.sessionId}`)
  return 0
}
