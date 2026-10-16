import type { FailureKind, Result } from '@levelhead/core'
import type { FastifyReply } from 'fastify'

const STATUS: Record<FailureKind, number> = {
  not_found: 404,
  forbidden: 403,
  invalid_state: 409,
  conflict: 409,
  budget_exceeded: 429,
  limit_exceeded: 413,
  schema_violation: 502,
  provider_unavailable: 503,
}

// One mapping, so the same named failure never renders two ways in two routes (STACK §5).
export function statusFor(kind: FailureKind): number {
  return STATUS[kind]
}

export async function sendResult<T>(
  reply: FastifyReply,
  result: Result<T>,
): Promise<T | undefined> {
  if (result.ok) return result.value
  await reply.code(statusFor(result.failure.kind)).send({
    error: result.failure.message,
    ...(result.failure.detail === undefined ? {} : { detail: result.failure.detail }),
  })
  return undefined
}
