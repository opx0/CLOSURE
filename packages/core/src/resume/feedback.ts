import type {
  Artifact,
  Claim,
  ClaimFinding,
  ClaimType,
  ClaimVerdict,
  Evidence,
  Finding,
  GapEntry,
  ResumeFeedback,
  ResumeTag,
  ResumeTagKind,
  Span,
} from '@levelhead/contracts'

export interface ResumeFeedbackInput {
  spans: readonly Span[]
  claims: readonly Claim[]
  confirmedClaimIds: ReadonlySet<string>
  snapshotIds: readonly string[]
  artifacts: readonly Artifact[]
  evidence: readonly Evidence[]
  findings: readonly Finding[]
  quotes: ReadonlyMap<string, string>
  gaps: readonly GapEntry[]
}

const ADVICE: Record<ResumeTagKind, string> = {
  implied_unconfirmed:
    'This is read into your wording rather than stated; confirm it only if you can explain it in depth, otherwise reword the line so it stops implying it.',
  no_metric:
    'Add the number you measured and its baseline; the first follow-up to this line is “by how much, measured how?”',
  linked_code:
    'Files in your pinned repository share words with this line. That is what an interviewer may open, not proof the code backs it: expect to explain why they are written this way and what breaks them.',
  no_code_evidence:
    'Nothing in your pinned repositories links to this line; pin the repository that holds this work, or be ready to explain it with no code to point at.',
  code_not_checked:
    'Not checked against code because no repository is pinned; pin the project behind this line so it can be cross-questioned file by file.',
  held: 'Your answer held up on this line; keep it, and keep the explanation you gave.',
  partially_supported:
    'Your answer covered only part of this line; narrow it to what you explained, or prepare the part you could not.',
  contradicted:
    'Your own answer contradicted this line. Rewrite it to what you can defend, or prepare the mechanism before an interviewer asks.',
  open_gap:
    'This line has a gap that has not yet held under a transfer question; close it before an interviewer who reads this line finds it.',
}

// An unsupported verdict opens a gap on the claim; open_gap reports it with the gap's evidence.
const VERDICT_TAG: Record<ClaimVerdict, ResumeTagKind | null> = {
  supported: 'held',
  partially_supported: 'partially_supported',
  unsupported_by_available_evidence: null,
  contradicted: 'contradicted',
}

const NEEDS_A_NUMBER: readonly ClaimType[] = ['optimized', 'measured']

type Citations = Partial<Pick<ResumeTag, 'quotes' | 'findingIds' | 'gapIds' | 'artifactPaths'>>

function tag(kind: ResumeTagKind, claimId: string, cited: Citations = {}): ResumeTag {
  return {
    kind,
    claimId,
    advice: ADVICE[kind],
    quotes: cited.quotes ?? [],
    findingIds: cited.findingIds ?? [],
    gapIds: cited.gapIds ?? [],
    artifactPaths: cited.artifactPaths ?? [],
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function push<T>(groups: Map<string, T[]>, key: string, value: T): void {
  const group = groups.get(key)
  if (group === undefined) groups.set(key, [value])
  else group.push(value)
}

export function resumeFeedback(input: ResumeFeedbackInput): ResumeFeedback {
  const pinned = new Set(input.snapshotIds)
  const pathByArtifact = new Map(
    input.artifacts
      .filter((artifact) => pinned.has(artifact.snapshotId))
      .map((artifact) => [artifact.id, artifact.path]),
  )

  const pathsByClaim = new Map<string, string[]>()
  for (const link of input.evidence) {
    if (link.subject.kind !== 'claim' || link.target.kind !== 'artifact') continue
    const path = pathByArtifact.get(link.target.artifactId)
    if (path !== undefined) push(pathsByClaim, link.subject.claimId, path)
  }

  const latestFinding = new Map<string, ClaimFinding>()
  for (const finding of input.findings) {
    if (finding.kind === 'claim') latestFinding.set(finding.claimId, finding)
  }

  const liveGaps = new Map<string, GapEntry[]>()
  for (const gap of input.gaps) {
    if (gap.claimId === undefined) continue
    if (gap.status === 'open' || gap.status === 'drilled') push(liveGaps, gap.claimId, gap)
  }

  // A claim finding also cites the résumé line it judged; that is not the candidate's answer.
  const asserted = new Set(
    input.evidence.filter((link) => link.trust === 'candidate_asserted').map((link) => link.id),
  )
  const quoted = (evidenceIds: readonly string[]): string[] =>
    unique(
      evidenceIds
        .filter((id) => !asserted.has(id))
        .map((id) => input.quotes.get(id))
        .filter((quote) => quote !== undefined),
    )

  const tagsFor = (claim: Claim): ResumeTag[] => {
    const tags: ResumeTag[] = []

    if (claim.implied && !input.confirmedClaimIds.has(claim.id)) {
      tags.push(tag('implied_unconfirmed', claim.id))
    }
    if (NEEDS_A_NUMBER.includes(claim.type) && claim.metrics.length === 0) {
      tags.push(tag('no_metric', claim.id))
    }

    const paths = pathsByClaim.get(claim.id)
    if (pinned.size === 0) tags.push(tag('code_not_checked', claim.id))
    else if (paths === undefined) tags.push(tag('no_code_evidence', claim.id))
    else tags.push(tag('linked_code', claim.id, { artifactPaths: unique(paths).sort() }))

    const finding = latestFinding.get(claim.id)
    const verdict = finding === undefined ? null : VERDICT_TAG[finding.verdict]
    if (finding !== undefined && verdict !== null) {
      const cited = { quotes: quoted(finding.evidenceIds), findingIds: [finding.id] }
      tags.push(tag(verdict, claim.id, cited))
    }

    const gaps = liveGaps.get(claim.id)
    if (gaps !== undefined) {
      tags.push(
        tag('open_gap', claim.id, {
          quotes: quoted(gaps.flatMap((gap) => gap.evidenceIds)),
          findingIds: unique(gaps.flatMap((gap) => gap.findingIds)),
          gapIds: gaps.map((gap) => gap.id),
        }),
      )
    }

    return tags
  }

  const claimsBySpan = new Map<string, Claim[]>()
  for (const claim of input.claims) push(claimsBySpan, claim.spanId, claim)

  const lines = [...input.spans]
    .sort((a, b) => a.startByte - b.startByte)
    .flatMap((span) => {
      const claims = claimsBySpan.get(span.id)
      if (claims === undefined) return []
      return [
        {
          spanId: span.id,
          text: span.quoted,
          claimIds: claims.map((claim) => claim.id),
          tags: claims.flatMap(tagsFor),
        },
      ]
    })

  return { lines, snapshotIds: [...input.snapshotIds] }
}
