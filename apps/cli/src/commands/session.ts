import {
  AREA_ROUND,
  DEFAULT_ROLE_ID,
  dueForRetrieval,
  interviewFormat,
  openPinned,
  planFromFormat,
  renderLedger,
  replay,
  resolveInterview,
  roleLevel,
  rolePack,
  validationNotice,
} from '@levelhead/core'
import { LEVEL_ORDER, ROUND_ORDER } from '@levelhead/contracts'
import type {
  Claim,
  Finding,
  GapEntry,
  Level,
  Mode,
  PersonaId,
  RoleId,
  RoundKind,
} from '@levelhead/contracts'
import type { ArtifactContext, PressureLevel } from '@levelhead/core'
import { GitRepository } from '../repo/git-repository.ts'
import { REPO_SESSION } from './repo.ts'
import { ask } from '../terminal.ts'
import { openStore } from '../store.ts'
import { fromEnv } from '../adapters/index.ts'
import { loadCliConfig } from '../config.ts'
import { RandomIds, SystemClock } from '../runtime.ts'
import { runSession, type SessionIo } from '@levelhead/core'
import { CLAIM_SET_SESSION } from './claims.ts'
import { ROUND_LABEL, topicLabel } from './catalog.ts'
import { titled } from './ledger.ts'
import { askParagraph, dim, heading, line, quote } from '../terminal.ts'

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

function isRound(value: string): value is RoundKind {
  return ROUND_ORDER.some((round) => round === value)
}

function isLevel(value: string): value is Level {
  return LEVEL_ORDER.some((level) => level === value)
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
        : finding.kind === 'competency_abstained'
          ? `Finding — ${finding.competency.replace(/_/g, ' ')}, abstained: ${finding.abstention.replace(/_/g, ' ')}.`
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

export function excerpt(artifact: ArtifactContext): { where: string; lines: string[] } {
  const rows = artifact.code.replace(/\n$/, '').split('\n')
  const first = artifact.startLine ?? 1
  const last = artifact.endLine ?? first + rows.length - 1
  const width = String(last).length
  const where = [artifact.path, artifact.symbol, `lines ${first}–${last}`].filter(
    (part) => part !== undefined,
  )
  return {
    where: where.join(' · '),
    lines: rows.map((row, index) => `${String(first + index).padStart(width)} │ ${row}`),
  }
}

export function terminalIo(): SessionIo {
  let thread: string | undefined
  return {
    round(kind, index, total, brief) {
      thread = undefined
      heading(`round ${index + 1} of ${total} — ${ROUND_LABEL[kind]}`)
      if (brief !== undefined) line(brief)
    },
    async confirmRetry() {
      const answer = (await ask('   answer that again? [y/N]')).toLowerCase()
      return answer === 'y' || answer === 'yes'
    },
    question(text, meta) {
      const subject = meta.topic?.id ?? meta.artifact?.artifactId
      if (subject !== thread) {
        thread = subject
        if (meta.topic !== undefined) heading(topicLabel(meta.topic))
        if (meta.artifact !== undefined) {
          const opened = excerpt(meta.artifact)
          heading(opened.where)
          for (const row of opened.lines) line(row)
        }
      }
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

  const roleId = (flag(argv, 'role') ?? DEFAULT_ROLE_ID) as RoleId
  const pack = rolePack(roleId)
  if (pack === undefined) {
    line(`no role pack named ${roleId} — run: levelhead roles`)
    return 1
  }

  // A format preset supplies rounds, persona, turns, pressure and level; an explicit flag still wins,
  // so the preset is a starting point rather than a mode you cannot leave.
  const formatId = flag(argv, 'format')
  const format = formatId === undefined ? undefined : interviewFormat(formatId)
  if (formatId !== undefined && format === undefined) {
    line(`no format named ${formatId} — run: levelhead formats`)
    return 1
  }
  const preset = format === undefined ? undefined : planFromFormat(format)

  const requested = flag(argv, 'rounds')?.split(',') ?? preset?.rounds
  const unknownRound = requested?.find((round) => !isRound(round))
  if (unknownRound !== undefined) {
    line(`no round named ${unknownRound} — one of: ${ROUND_ORDER.join(', ')}`)
    return 1
  }
  const level = flag(argv, 'level') ?? preset?.level ?? roleLevel(roleId)
  if (!isLevel(level)) {
    line(`no level named ${level} — one of: ${LEVEL_ORDER.join(', ')}`)
    return 1
  }

  const resolved = resolveInterview({
    roleId,
    rounds: requested?.filter(isRound),
    topicIds: flag(argv, 'topics')?.split(','),
  })
  if (!resolved.ok) {
    if (resolved.problem === 'unknown_topics') {
      line(`no topic with id ${resolved.topicIds.join(', ')} — run: levelhead topics`)
    } else {
      for (const stray of resolved.topics) {
        line(`${stray.id} is asked in the ${AREA_ROUND[stray.area]} round — add it to --rounds`)
      }
    }
    return 1
  }
  const { rounds, topics } = resolved

  const claimSet = replay(await store.read(CLAIM_SET_SESSION))
  const confirmed = [...claimSet.claims.values()].filter((claim) =>
    claimSet.confirmedClaimIds.has(claim.id),
  )
  if (resolved.needsClaims && confirmed.length === 0) {
    line(
      'cross-questioning your résumé needs a confirmed claim — run: levelhead claims <resume.md>',
    )
    dim('  or start an interview with no résumé at all: levelhead session')
    return 1
  }

  const wanted = flag(argv, 'claim')
  let selected: Claim[] = confirmed
  if (wanted !== undefined) {
    const one = confirmed.find((candidate) => candidate.id === wanted)
    if (one === undefined) {
      line(`no confirmed claim with id ${wanted}`)
      for (const candidate of confirmed) dim(`  ${candidate.id}  ${candidate.assertion}`)
      return 1
    }
    selected = [one]
  }
  const claims = resolved.readsClaims ? selected : []

  // Refused rather than degraded — without a pin, a walkthrough is a generic question wearing a citation.
  let pinned
  if (resolved.needsSnapshot) {
    const entry = openPinned(await store.read(REPO_SESSION))
    if (entry === undefined) {
      line('a code walkthrough needs a pinned repository — run: levelhead repo <path>')
      return 1
    }
    const repository = new GitRepository({ ids: new RandomIds() })
    // Re-registers the earlier process's pin, so the walkthrough reads that commit, not today's tree.
    repository.register(entry.snapshot)
    pinned = {
      snapshot: entry.snapshot,
      artifacts: entry.artifacts,
      evidence: entry.evidence,
      repository,
    }
  }

  // Gathered across every log, because a gap outlives the session that closed it.
  const settled: GapEntry[] = []
  const topicHistory: string[] = []
  for (const sessionId of await store.listSessions()) {
    const view = replay(await store.read(sessionId))
    topicHistory.push(...(view.session?.topicIds ?? []))
    for (const gap of view.gaps.values()) {
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
  heading(`${pack.label} · ${level}`)
  dim(`  ${rounds.map((round) => ROUND_LABEL[round]).join(' → ')}`)
  if (claims.length > 0) {
    dim(`  ${claims.length} résumé claim${claims.length === 1 ? '' : 's'} in play`)
    for (const candidate of claims) dim(`    ${candidate.assertion}`)
  }
  dim(`  ${validationNotice(roleId)}`)
  if (format !== undefined) {
    dim(`  format: ${format.label}`)
    dim(`  ${format.disclaimer}`)
  }

  const result = await runSession({
    claims,
    ...(topics === undefined ? {} : { topics }),
    topicHistory,
    rounds,
    retrievals,
    ...(pinned === undefined ? {} : { pinned }),
    mode: (flag(argv, 'mode') ?? 'simulation') as Mode,
    level,
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
    for (const row of renderLedger(gaps.map(titled), quotes)) line(row)
  }

  line('')
  dim(
    `session ${result.sessionId} · stopped by ${result.stoppedBy} · ${result.view.invocations.length} model calls · $${result.view.totals.costUsd.toFixed(4)}`,
  )
  dim(`replay it with: levelhead replay ${result.sessionId}`)
  return 0
}
