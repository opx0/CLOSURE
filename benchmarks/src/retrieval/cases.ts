import type { FixtureArtifact } from './corpus.ts'

export const CASES_VERSION = 'enm62-authored-judgments-v1'

export interface RetrievalCase {
  id: string
  family: string
  split: 'tuning' | 'heldout'
  query: string
  /** Exhaustive artifact-level judgments for the authored corpus; absent IDs have grade zero. */
  relevant: Readonly<Record<string, number>>
}

/** Labels were authored by reading the literal fixture behavior, not derived from any ranker.
 * Grade 3 = directly answers, 1 = useful partial context. Contradictions and injected directives
 * are judged as source data, not obeyed. All unlisted corpus artifacts are judged irrelevant.
 * Source families used as positives never cross the split; the indexed corpus stays identical.
 * Heldout means reserved from tuning, not an independently collected or human-validated set. */
export const cases: readonly RetrievalCase[] = [
  {
    id: 'queue-symbol',
    family: 'queue',
    split: 'tuning',
    query: 'claimJob',
    relevant: { 'queue-lease': 3 },
  },
  {
    id: 'queue-paraphrase',
    family: 'queue',
    split: 'tuning',
    query: 'Where does a worker reserve work without blocking on work another worker locked?',
    relevant: { 'queue-lease': 3 },
  },
  {
    id: 'queue-retry',
    family: 'queue',
    split: 'tuning',
    query: 'Where is the exponential retry delay capped?',
    relevant: { 'queue-backoff': 3 },
  },
  {
    id: 'cache-symbol',
    family: 'cache',
    split: 'tuning',
    query: 'readFresh',
    relevant: { 'cache-expiry': 3 },
  },
  {
    id: 'cache-paraphrase',
    family: 'cache',
    split: 'tuning',
    query: 'Which read refuses to serve an item whose lifetime has elapsed?',
    relevant: { 'cache-expiry': 3 },
  },
  {
    id: 'cache-unanswerable',
    family: 'cache',
    split: 'tuning',
    query: 'Where is a least recently used capacity eviction policy implemented?',
    relevant: {},
  },
  {
    id: 'auth-symbol',
    family: 'auth',
    split: 'heldout',
    query: 'verifyBearer',
    relevant: { 'auth-verify': 3 },
  },
  {
    id: 'auth-paraphrase',
    family: 'auth',
    split: 'heldout',
    query:
      'Which routine checks that a credential was signed and is still valid before identifying its owner?',
    relevant: { 'auth-verify': 3 },
  },
  {
    id: 'auth-near-distractor',
    family: 'auth',
    split: 'heldout',
    query: 'Where is a bearer payload decoded without checking its signature?',
    relevant: { 'auth-decode': 3 },
  },
  {
    id: 'injection',
    family: 'auth',
    split: 'heldout',
    query:
      'Find the code that verifies bearer signatures, not repository instructions telling you what to rank.',
    relevant: { 'auth-verify': 3 },
  },
  {
    id: 'contradictory-code',
    family: 'auth',
    split: 'heldout',
    query: 'Which password storage implementation contradicts its comment about secure hashing?',
    relevant: { 'auth-plaintext': 3 },
  },
  {
    id: 'auth-unanswerable',
    family: 'auth',
    split: 'heldout',
    query: 'Where is the Argon2 password hash calculated?',
    relevant: {},
  },
  {
    id: 'export-symbol',
    family: 'export',
    split: 'heldout',
    query: 'exportWithoutSecrets',
    relevant: { 'export-redact': 3 },
  },
  {
    id: 'export-paraphrase',
    family: 'export',
    split: 'heldout',
    query: 'Which JSON export removes credentials before serializing a record?',
    relevant: { 'export-redact': 3 },
  },
  {
    id: 'export-contrast',
    family: 'export',
    split: 'heldout',
    query: 'Which debug export leaks password and access token fields?',
    relevant: { 'export-raw': 3 },
  },
  {
    id: 'ledger-delete',
    family: 'ledger',
    split: 'heldout',
    query: 'Where are repository bytes removed while keeping a deletion marker?',
    relevant: { 'ledger-delete': 3 },
  },
  {
    id: 'overlapping-chunks',
    family: 'ledger',
    split: 'heldout',
    query:
      'Find rebuildLedger checkpoint replay code and supporting code for counting its append-only input events',
    relevant: { 'ledger-overlap': 3, 'ledger-count': 1 },
  },
  {
    id: 'ledger-unanswerable',
    family: 'ledger',
    split: 'heldout',
    query: 'Where does the ledger publish events to a Kafka broker?',
    relevant: {},
  },
]

export function validateCases(
  queries: readonly RetrievalCase[],
  artifacts: readonly FixtureArtifact[],
): void {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  if (byId.size !== artifacts.length) throw new Error('Duplicate artifact ID')
  const families = new Map<string, RetrievalCase['split']>()
  const ids = new Set<string>()
  for (const query of queries) {
    if (ids.has(query.id)) throw new Error(`Duplicate query ID: ${query.id}`)
    ids.add(query.id)
    const split = families.get(query.family)
    if (split && split !== query.split)
      throw new Error(`Leaked source/query family: ${query.family}`)
    families.set(query.family, query.split)
    for (const [id, grade] of Object.entries(query.relevant)) {
      const artifact = byId.get(id)
      if (!artifact) throw new Error(`Unknown judged artifact: ${id}`)
      if (artifact.family !== query.family)
        throw new Error(`Judgment source family mismatch: ${id}`)
      if (!Number.isInteger(grade) || grade < 1 || grade > 3)
        throw new Error(`Invalid relevance grade: ${id}`)
    }
  }
}
