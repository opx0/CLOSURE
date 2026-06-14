export type FailureKind =
  | 'not_found'
  | 'forbidden'
  | 'invalid_state'
  | 'budget_exceeded'
  | 'schema_violation'
  | 'provider_unavailable'
  | 'limit_exceeded'
  | 'conflict'

export interface Failure {
  kind: FailureKind
  message: string
  detail?: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function fail<T = never>(kind: FailureKind, message: string, detail?: string): Result<T> {
  return { ok: false, failure: { kind, message, ...(detail === undefined ? {} : { detail }) } }
}

export function isFailure<T>(result: Result<T>): result is { ok: false; failure: Failure } {
  return !result.ok
}

export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.value : fallback
}
