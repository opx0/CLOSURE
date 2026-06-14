// Injected, not ambient — replay identity (ticket 05 §3) needs byte-for-byte reproducible ids and timestamps.
export interface Clock {
  now(): string
}

export interface IdSource {
  next(prefix: string): string
}
