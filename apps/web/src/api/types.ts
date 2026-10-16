import type { paths } from './schema.gen.ts'

type JsonOf<T> = T extends { content: { 'application/json': infer B } } ? B : never

export type ClaimsResponse = JsonOf<paths['/claims']['post']['responses'][200]>
export type Claim = ClaimsResponse['claims'][number]
export type Span = ClaimsResponse['spans'][number]

export type TurnUpdate = JsonOf<paths['/sessions']['post']['responses'][201]>
export type ShownArtifact = NonNullable<NonNullable<TurnUpdate['question']>['artifact']>
export type Finding = TurnUpdate['findings'][number]
export type QuotedEvidence = TurnUpdate['quotes'][number]

export type SessionView = JsonOf<paths['/sessions/{id}']['get']['responses'][200]>
export type Evidence = SessionView['evidence'][number]
export type TranscriptEntry = SessionView['transcript'][number]

export type LedgerResponse = JsonOf<paths['/ledger']['get']['responses'][200]>
export type GapEntry = LedgerResponse['gaps'][number]

export type SchedulePlan = JsonOf<paths['/schedule']['get']['responses'][200]>
export type ReviewResponse = JsonOf<paths['/review']['get']['responses'][200]>
export type ReplayResponse = JsonOf<paths['/sessions/{id}/replay']['get']['responses'][200]>
export type RolesResponse = JsonOf<paths['/roles']['get']['responses'][200]>
export type FormatsResponse = JsonOf<paths['/formats']['get']['responses'][200]>
export type RubricsResponse = JsonOf<paths['/rubrics']['get']['responses'][200]>
export type PersonasResponse = JsonOf<paths['/personas']['get']['responses'][200]>
export type ActionsResponse = JsonOf<paths['/actions']['get']['responses'][200]>
export type PrivacyResponse = JsonOf<paths['/privacy']['get']['responses'][200]>
export type BenchmarkRuns = JsonOf<paths['/benchmark/runs']['get']['responses'][200]>
export type DeliveryResponse = JsonOf<paths['/sessions/{id}/delivery']['get']['responses'][200]>
export type JobsResponse = JsonOf<paths['/jobs']['get']['responses'][200]>
export type TopicsResponse = JsonOf<paths['/topics']['get']['responses'][200]>
export type SnapshotsResponse = JsonOf<paths['/snapshots']['get']['responses'][200]>
export type PinnedSnapshot = SnapshotsResponse['snapshots'][number]
export type ResumeFeedbackResponse = JsonOf<paths['/resume/feedback']['get']['responses'][200]>
