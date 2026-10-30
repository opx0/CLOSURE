import type { paths } from './schema.gen.ts'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const TOKEN_KEY = 'levelhead.token'

export function apiToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setApiToken(token: string | null): void {
  try {
    if (token === null || token === '') localStorage.removeItem(TOKEN_KEY)
    else localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // A browser that refuses storage still works; the token just does not survive a reload.
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = apiToken()
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...init.headers,
    },
  })

  const text = await response.text()
  const body: unknown = text === '' ? {} : JSON.parse(text)
  if (!response.ok) {
    const shaped = body as { error?: string; detail?: string }
    throw new ApiError(
      response.status,
      shaped.detail,
      shaped.error ?? `request failed with ${response.status}`,
    )
  }
  return body as T
}

type Json<P extends keyof paths, M extends 'get' | 'post' | 'delete'> = paths[P][M] extends {
  responses: infer R
}
  ? R extends { 200: { content: { 'application/json': infer B } } }
    ? B
    : R extends { 201: { content: { 'application/json': infer B } } }
      ? B
      : R extends { 202: { content: { 'application/json': infer B } } }
        ? B
        : unknown
  : unknown

// The request body a POST expects, read off the same generated schema, so a caller cannot post a
// shape the server would reject at its boundary.
type Body<P extends keyof paths, M extends 'post'> = paths[P][M] extends {
  requestBody: { content: { 'application/json': infer B } }
}
  ? B
  : never

// One status's body, for a route that answers with more than one success shape.
type Reply<P extends keyof paths, M extends 'post', S extends 201 | 202> = paths[P][M] extends {
  responses: Record<S, { content: { 'application/json': infer B } }>
}
  ? B
  : never

export type StartSessionBody = Body<'/sessions', 'post'>
// 201 when the server parsed the repository itself; 202 and a job to poll when a worker will.
export type PinResult = Reply<'/snapshots', 'post', 201> | Reply<'/snapshots', 'post', 202>
export type ProsodyReportBody = Body<'/sessions/{id}/prosody', 'post'>
export type KinematicsReportBody = Body<'/sessions/{id}/kinematics', 'post'>
export type MirrorBody = Body<'/mirror', 'post'>

// Response shapes for the performance-lane surfaces, derived from the generated schema so the pages
// never restate a type the server owns.
export type Debrief = Json<'/sessions/{id}/debrief', 'get'>
export type SessionPerformance = Json<'/sessions/{id}/performance', 'get'>
export type Analytics = Json<'/analytics', 'get'>
export type ScreenSimulation = Json<'/mirror', 'post'>

export const api = {
  voiceTicket: (id: string) =>
    request<Json<'/sessions/{id}/voice-ticket', 'post'>>(
      `/sessions/${encodeURIComponent(id)}/voice-ticket`,
      { method: 'POST' },
    ),
  health: () => request<Json<'/health', 'get'>>('/health'),

  hint: (id: string, level: number) =>
    request<Json<'/sessions/{id}/hints', 'post'>>(`/sessions/${encodeURIComponent(id)}/hints`, {
      method: 'POST',
      body: JSON.stringify({ level }),
    }),
  closeInterrupted: (id: string) =>
    request<Json<'/sessions/{id}/close-interrupted', 'post'>>(
      `/sessions/${encodeURIComponent(id)}/close-interrupted`,
      { method: 'POST' },
    ),
  feedback: (id: string) =>
    request<Json<'/sessions/{id}/feedback', 'get'>>(`/sessions/${encodeURIComponent(id)}/feedback`),
  correctAnswer: (id: string, body: Body<'/sessions/{id}/corrections', 'post'>) =>
    request<Json<'/sessions/{id}/corrections', 'post'>>(
      `/sessions/${encodeURIComponent(id)}/corrections`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  reassessAnswer: (id: string, body: { requestId: string; attemptId: string; revision: number }) =>
    request<{ revision: number; findings: number }>(
      `/sessions/${encodeURIComponent(id)}/reassess`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),
  reviewFinding: (id: string, body: Body<'/sessions/{id}/feedback', 'post'>) =>
    request<Json<'/sessions/{id}/feedback', 'post'>>(
      `/sessions/${encodeURIComponent(id)}/feedback`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  preparation: () => request<Json<'/preparation', 'get'>>('/preparation'),
  stories: () => request<Json<'/stories', 'get'>>('/stories'),
  saveStory: (story: Body<'/stories', 'post'>) =>
    request<Json<'/stories', 'post'>>('/stories', { method: 'POST', body: JSON.stringify(story) }),
  designs: () => request<Json<'/designs', 'get'>>('/designs'),
  saveDesign: (design: Body<'/designs', 'post'>) =>
    request<Json<'/designs', 'post'>>('/designs', { method: 'POST', body: JSON.stringify(design) }),
  preparationGoals: () => request<Json<'/preparation/goals', 'get'>>('/preparation/goals'),
  savePreparationGoals: (goals: Body<'/preparation/goals', 'post'>) =>
    request<Json<'/preparation/goals', 'post'>>('/preparation/goals', {
      method: 'POST',
      body: JSON.stringify(goals),
    }),
  savePreparation: (selection: Body<'/preparation', 'post'>) =>
    request<Json<'/preparation', 'post'>>('/preparation', {
      method: 'POST',
      body: JSON.stringify(selection),
    }),
  claimSet: () => request<Json<'/claims', 'get'>>('/claims'),

  extractClaims: (resumeText: string) =>
    request<Json<'/claims', 'post'>>('/claims', {
      method: 'POST',
      body: JSON.stringify({ resumeText }),
    }),

  confirmClaim: (claimId: string, confirmed: boolean, editedAssertion?: string) =>
    request<Json<'/claims/{id}/confirm', 'post'>>(`/claims/${claimId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        confirmed,
        ...(editedAssertion === undefined ? {} : { editedAssertion }),
      }),
    }),

  resumeFeedback: () => request<Json<'/resume/feedback', 'get'>>('/resume/feedback'),

  startSession: (body: StartSessionBody) =>
    request<Json<'/sessions', 'post'>>('/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  answer: (sessionId: string, text: string) =>
    request<Json<'/sessions/{id}/answers', 'post'>>(`/sessions/${sessionId}/answers`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  timing: (sessionId: string, action: 'pause' | 'resume') =>
    request<Json<'/sessions/{id}/timing', 'post'>>(`/sessions/${sessionId}/timing`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  stopSession: (sessionId: string) =>
    request<Json<'/sessions/{id}/stop', 'post'>>(`/sessions/${sessionId}/stop`, { method: 'POST' }),

  sessions: () => request<Json<'/sessions', 'get'>>('/sessions'),

  session: (sessionId: string) => request<Json<'/sessions/{id}', 'get'>>(`/sessions/${sessionId}`),

  events: (sessionId: string) =>
    request<Json<'/sessions/{id}/events', 'get'>>(`/sessions/${sessionId}/events`),

  replay: (sessionId: string) =>
    request<Json<'/sessions/{id}/replay', 'get'>>(`/sessions/${sessionId}/replay`),

  ledger: () => request<Json<'/ledger', 'get'>>('/ledger'),

  schedule: (horizonDays: number) =>
    request<Json<'/schedule', 'get'>>(`/schedule?horizonDays=${horizonDays}`),
  saveSchedule: (selection: Body<'/schedule/plan', 'post'>) =>
    request<Json<'/schedule/plan', 'post'>>('/schedule/plan', {
      method: 'POST',
      body: JSON.stringify(selection),
    }),

  review: (subject?: string) =>
    request<Json<'/review', 'get'>>(
      subject === undefined ? '/review' : `/review?subject=${encodeURIComponent(subject)}`,
    ),

  delivery: (sessionId: string) =>
    request<Json<'/sessions/{id}/delivery', 'get'>>(`/sessions/${sessionId}/delivery`),

  recordDelivery: (sessionId: string, body: Record<string, unknown>) =>
    request<Json<'/sessions/{id}/delivery', 'post'>>(`/sessions/${sessionId}/delivery`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // The performance lane over HTTP. Prosody and kinematics are recorded beside the interview and
  // never travel with an answer; the server keeps them structurally out of every finding.
  recordProsody: (sessionId: string, report: ProsodyReportBody) =>
    request<Json<'/sessions/{id}/prosody', 'post'>>(`/sessions/${sessionId}/prosody`, {
      method: 'POST',
      body: JSON.stringify(report),
    }),

  recordKinematics: (sessionId: string, report: KinematicsReportBody) =>
    request<Json<'/sessions/{id}/kinematics', 'post'>>(`/sessions/${sessionId}/kinematics`, {
      method: 'POST',
      body: JSON.stringify(report),
    }),

  performance: (sessionId: string) =>
    request<Json<'/sessions/{id}/performance', 'get'>>(`/sessions/${sessionId}/performance`),

  debrief: (sessionId: string) =>
    request<Json<'/sessions/{id}/debrief', 'get'>>(`/sessions/${sessionId}/debrief`),

  analytics: () => request<Json<'/analytics', 'get'>>('/analytics'),

  mirror: (body: MirrorBody) =>
    request<Json<'/mirror', 'post'>>('/mirror', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  roles: () => request<Json<'/roles', 'get'>>('/roles'),
  topics: () => request<Json<'/topics', 'get'>>('/topics'),
  formats: () => request<Json<'/formats', 'get'>>('/formats'),
  rubrics: () => request<Json<'/rubrics', 'get'>>('/rubrics'),
  personas: () => request<Json<'/personas', 'get'>>('/personas'),
  actions: () => request<Json<'/actions', 'get'>>('/actions'),

  privacy: () => request<Json<'/privacy', 'get'>>('/privacy'),
  exportBundle: () => request<Json<'/export', 'get'>>('/export'),
  deleteSnapshot: (snapshotId: string) =>
    request<Json<'/snapshots/{id}', 'delete'>>(`/snapshots/${snapshotId}`, { method: 'DELETE' }),

  snapshots: () => request<Json<'/snapshots', 'get'>>('/snapshots'),
  artifact: (snapshotId: string, artifactId: string) =>
    request<Json<'/snapshots/{id}/artifacts/{artifactId}', 'get'>>(
      `/snapshots/${snapshotId}/artifacts/${artifactId}`,
    ),
  pinSnapshot: (repoPath: string, ref?: string) =>
    request<PinResult>('/snapshots', {
      method: 'POST',
      body: JSON.stringify({ repoPath, ...(ref === undefined ? {} : { ref }) }),
    }),

  jobs: () => request<Json<'/jobs', 'get'>>('/jobs'),
  job: (jobId: string) => request<Json<'/jobs/{id}', 'get'>>(`/jobs/${jobId}`),
  benchmarkRuns: () => request<Json<'/benchmark/runs', 'get'>>('/benchmark/runs'),
}

export function streamTurns(
  sessionId: string,
  onTurn: (update: unknown) => void,
): { close: () => void } {
  const source = new EventSource(`/sessions/${sessionId}/stream`)
  source.addEventListener('turn', (event) => {
    onTurn(JSON.parse((event as MessageEvent<string>).data))
  })
  return { close: () => source.close() }
}
