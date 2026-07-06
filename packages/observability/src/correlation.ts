import { randomUUID } from 'node:crypto'

export const CORRELATION_HEADER = 'x-closer-correlation-id'

const SHAPE = /^[A-Za-z0-9._-]{1,128}$/

export function newCorrelationId(): string {
  return randomUUID()
}

// An inbound id is echoed only if it is a plain token; anything else would put caller-controlled
// text into every log line the request produces.
export function correlationIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header
  return value !== undefined && SHAPE.test(value) ? value : newCorrelationId()
}
