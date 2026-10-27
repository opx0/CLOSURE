import type {
  Claim,
  DeliveryReport,
  Finding,
  GapEntry,
  Level,
  Mode,
  PersonaId,
  PolicyAction,
  Principal,
  RoleId,
  RoundKind,
  Topic,
  TransferVariant,
} from '@levelhead/contracts'
import type { ArtifactContext, IdSource, PinnedContext, PressureLevel } from '@levelhead/core'
import { runSession, type SessionIo, type SessionResult } from '@levelhead/core'
import type { ServerDeps } from './deps.ts'

// Reuses `runSession` unmodified rather than re-implementing the interview loop; `io.answer()`
// suspends between HTTP requests instead of stepping a turn per request.

export interface StartSessionInput {
  principal: Principal
  claims: readonly Claim[]
  mode: Mode
  level: Level
  personaId: PersonaId
  pressureCeiling: PressureLevel
  rounds: readonly RoundKind[]
  turnsPerRound: number
  drill: boolean
  drillGap?: GapEntry
  transferGap?: GapEntry
  transferVariant?: TransferVariant
  retrievals?: readonly GapEntry[]
  role?: RoleId
  topics?: readonly Topic[]
  topicHistory: readonly string[]
  pinned?: PinnedContext
}

export interface TurnRound {
  kind: RoundKind
  index: number
  total: number
  brief?: string
}

export type TurnArtifact = Omit<ArtifactContext, 'artifactId'>

export interface TurnQuestion {
  attemptId: string
  text: string
  turn: number
  action: PolicyAction
  pressureLevel: number
  round: RoundKind
  topic?: Pick<Topic, 'id' | 'area' | 'title'>
  claim?: Pick<Claim, 'id' | 'assertion'>
  artifact?: TurnArtifact
}

function shown(artifact: ArtifactContext): TurnArtifact {
  return {
    path: artifact.path,
    ...(artifact.symbol === undefined ? {} : { symbol: artifact.symbol }),
    ...(artifact.startLine === undefined ? {} : { startLine: artifact.startLine }),
    ...(artifact.endLine === undefined ? {} : { endLine: artifact.endLine }),
    code: artifact.code,
  }
}

export interface QuotedEvidence {
  evidenceId: string
  quoted: string
}

export interface TurnUpdate {
  sessionId: string
  status: 'awaiting_answer' | 'closed'
  round?: TurnRound
  question?: TurnQuestion
  findings: Finding[]
  quotes: QuotedEvidence[]
  notices: string[]
  // Delivery, when the caller measured any. Beside the interview, never inside a finding (§7).
  delivery?: DeliveryReport
  stoppedBy?: SessionResult['stoppedBy']
}

export class SessionNotAwaitingAnswer extends Error {
  constructor(readonly sessionId: string) {
    super(`session ${sessionId} is not waiting for an answer`)
    this.name = 'SessionNotAwaitingAnswer'
  }
}

// Mints the session id via the injected IdSource, so the edge learns it by watching rather than
// minting its own and hoping the two agree.
class CapturingIds implements IdSource {
  sessionId: string | null = null

  constructor(private readonly inner: IdSource) {}

  next(prefix: string): string {
    const id = this.inner.next(prefix)
    if (prefix === 'ses' && this.sessionId === null) this.sessionId = id
    return id
  }
}

interface Buffered {
  round: TurnRound | null
  question: TurnQuestion | null
  findings: Finding[]
  quotes: Map<string, string>
  notices: string[]
}

function emptyBuffer(): Buffered {
  return { round: null, question: null, findings: [], quotes: new Map(), notices: [] }
}

export type TurnListener = (update: TurnUpdate) => void

export class LiveSession {
  readonly #deps: ServerDeps
  readonly #input: StartSessionInput
  readonly #ids: CapturingIds
  readonly #listeners = new Set<TurnListener>()
  #buffer = emptyBuffer()
  #waiting: ((answer: string) => void) | null = null
  #restWaiters: (() => void)[] = []
  #atRest = false
  #outcome: SessionResult | null = null
  #failure: unknown = null
  #hint: ((level: number) => Promise<string>) | null = null

  constructor(deps: ServerDeps, input: StartSessionInput) {
    this.#deps = deps
    this.#input = input
    this.#ids = new CapturingIds(deps.ids)
  }

  get awaitingAnswer(): boolean {
    return this.#waiting !== null
  }

  // A stream is a view of progress, never the record of it (STACK §12): every update pushed here
  // was already written to the log before it reached a subscriber.
  subscribe(listener: TurnListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async begin(): Promise<TurnUpdate> {
    const { role, topics, pinned } = this.#input
    const run = runSession({
      claims: this.#input.claims,
      mode: this.#input.mode,
      level: this.#input.level,
      personaId: this.#input.personaId,
      pressureCeiling: this.#input.pressureCeiling,
      rounds: this.#input.rounds,
      turnsPerRound: this.#input.turnsPerRound,
      drill: this.#input.drill,
      ...(this.#input.transferGap === undefined ? {} : { transferGap: this.#input.transferGap }),
      ...(this.#input.transferVariant === undefined
        ? {}
        : { transferVariant: this.#input.transferVariant }),
      ...(this.#input.drillGap === undefined ? {} : { drillGap: this.#input.drillGap }),
      ...(this.#input.retrievals === undefined ? {} : { retrievals: this.#input.retrievals }),
      topicHistory: this.#input.topicHistory,
      ...(role === undefined ? {} : { role }),
      ...(topics === undefined ? {} : { topics }),
      ...(pinned === undefined ? {} : { pinned }),
      ceilings: this.#deps.ceilings,
      deps: {
        store: this.#deps.storeFor(this.#input.principal),
        clock: this.#deps.clock,
        ids: this.#ids,
        conductor: this.#deps.conductor,
        evaluator: this.#deps.evaluator,
        io: this.#io(),
      },
    })

    // Handled here, not awaited: the request returns while the run is parked in `io.answer()`, so
    // nothing else would catch a rejection.
    run.then(
      (result) => {
        this.#outcome = result
        this.#rest()
      },
      (error: unknown) => {
        this.#failure = error
        this.#rest()
      },
    )

    await this.#rested()
    return this.#drain()
  }

  async submit(answer: string): Promise<TurnUpdate> {
    const waiting = this.#waiting
    if (waiting === null) throw new SessionNotAwaitingAnswer(this.#ids.sessionId ?? 'unknown')
    this.#waiting = null
    this.#hint = null
    this.#atRest = false
    waiting(answer)
    await this.#rested()
    return this.#drain()
  }

  async hint(level: number): Promise<string | null> {
    return this.awaitingAnswer && this.#hint !== null ? this.#hint(level) : null
  }

  #io(): SessionIo {
    const buffer = () => this.#buffer
    return {
      round: (kind, index, total, brief) => {
        buffer().round = { kind, index, total, ...(brief === undefined ? {} : { brief }) }
      },
      question: (text, meta) => {
        this.#hint = meta.hint ?? null
        const { topic, claim, artifact } = meta
        buffer().question = {
          attemptId: meta.attemptId,
          text,
          turn: meta.turn,
          action: meta.action,
          pressureLevel: meta.pressureLevel,
          round: meta.round,
          ...(topic === undefined
            ? {}
            : { topic: { id: topic.id, area: topic.area, title: topic.title } }),
          ...(claim === undefined ? {} : { claim: { id: claim.id, assertion: claim.assertion } }),
          ...(artifact === undefined ? {} : { artifact: shown(artifact) }),
        }
      },
      answer: () =>
        new Promise<string>((resolve) => {
          this.#waiting = resolve
          this.#rest()
        }),
      findings: (findings, quotes) => {
        buffer().findings.push(...findings)
        for (const finding of findings) {
          for (const evidenceId of finding.evidenceIds) {
            const quoted = quotes.get(evidenceId)
            if (quoted !== undefined) buffer().quotes.set(evidenceId, quoted)
          }
        }
      },
      // Always declines: coach's mid-turn retry has no place to be asked across separate HTTP requests.
      confirmRetry: async () => false,
      notice: (text) => {
        buffer().notices.push(text)
      },
    }
  }

  // Fires once parked in `answer()` or finished — everything owed for this request has been said.
  #rest(): void {
    this.#atRest = true
    for (const waiter of this.#restWaiters.splice(0)) waiter()
  }

  #rested(): Promise<void> {
    if (this.#atRest) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.#restWaiters.push(resolve)
    })
  }

  #drain(): TurnUpdate {
    if (this.#failure !== null) throw this.#failure
    const sessionId = this.#ids.sessionId
    if (sessionId === null) throw new Error('the session ended before it minted an id')

    const buffer = this.#buffer
    this.#buffer = emptyBuffer()
    const update: TurnUpdate = {
      sessionId,
      status: this.#waiting === null ? 'closed' : 'awaiting_answer',
      ...(buffer.round === null ? {} : { round: buffer.round }),
      ...(buffer.question === null ? {} : { question: buffer.question }),
      findings: buffer.findings,
      quotes: [...buffer.quotes].map(([evidenceId, quoted]) => ({ evidenceId, quoted })),
      notices: buffer.notices,
      ...(this.#outcome === null ? {} : { stoppedBy: this.#outcome.stoppedBy }),
    }
    for (const listener of this.#listeners) listener(update)
    return update
  }
}

// In-memory only — holds the suspended continuation, not the session; losing this map loses the
// ability to continue an interview, never the record of it (the event log `GET /sessions/:id` reads).
export class SessionHost {
  readonly #live = new Map<string, LiveSession>()
  readonly #owners = new Map<string, string>()

  constructor(private readonly deps: ServerDeps) {}

  async start(input: StartSessionInput): Promise<TurnUpdate> {
    const session = new LiveSession(this.deps, input)
    const update = await session.begin()
    this.#live.set(update.sessionId, session)
    this.#owners.set(update.sessionId, input.principal.ownerId)
    return update
  }

  // A live session belongs to the owner who started it; another owner asking for it is told the
  // same thing as someone asking for a session that does not exist.
  get(sessionId: string, ownerId: string): LiveSession | undefined {
    return this.#owners.get(sessionId) === ownerId ? this.#live.get(sessionId) : undefined
  }
}
