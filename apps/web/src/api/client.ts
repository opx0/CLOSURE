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

const TOKEN_KEY = 'closer.token'

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

export const api = {
  health: () => request<Json<'/health', 'get'>>('/health'),

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

  startSession: (body: Record<string, unknown>) =>
    request<Json<'/sessions', 'post'>>('/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  answer: (sessionId: string, text: string) =>
    request<Json<'/sessions/{id}/answers', 'post'>>(`/sessions/${sessionId}/answers`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  session: (sessionId: string) => request<Json<'/sessions/{id}', 'get'>>(`/sessions/${sessionId}`),

  events: (sessionId: string) =>
    request<Json<'/sessions/{id}/events', 'get'>>(`/sessions/${sessionId}/events`),

  replay: (sessionId: string) =>
    request<Json<'/sessions/{id}/replay', 'get'>>(`/sessions/${sessionId}/replay`),

  ledger: () => request<Json<'/ledger', 'get'>>('/ledger'),

  schedule: (horizonDays: number) =>
    request<Json<'/schedule', 'get'>>(`/schedule?horizonDays=${horizonDays}`),

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

  roles: () => request<Json<'/roles', 'get'>>('/roles'),
  formats: () => request<Json<'/formats', 'get'>>('/formats'),
  rubrics: () => request<Json<'/rubrics', 'get'>>('/rubrics'),
  personas: () => request<Json<'/personas', 'get'>>('/personas'),
  actions: () => request<Json<'/actions', 'get'>>('/actions'),

  privacy: () => request<Json<'/privacy', 'get'>>('/privacy'),
  exportBundle: () => request<Json<'/export', 'get'>>('/export'),
  deleteSnapshot: (snapshotId: string) =>
    request<Json<'/snapshots/{id}', 'delete'>>(`/snapshots/${snapshotId}`, { method: 'DELETE' }),

  jobs: () => request<Json<'/jobs', 'get'>>('/jobs'),
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
