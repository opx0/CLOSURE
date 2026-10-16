import { randomUUID } from 'node:crypto'
import type { Clock, IdSource } from '@levelhead/core'

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString()
  }
}

export class RandomIds implements IdSource {
  next(prefix: string): string {
    return `${prefix}_${randomUUID().slice(0, 8)}`
  }
}
