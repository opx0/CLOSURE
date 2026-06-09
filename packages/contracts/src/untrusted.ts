declare const untrustedBrand: unique symbol

// ADR-014. Compile-time only — erases on serialization, so it must be reapplied at every read boundary.
export type Untrusted<T> = T & { readonly [untrustedBrand]: true }

export function untrusted<T>(value: T): Untrusted<T> {
  return value as Untrusted<T>
}

declare const deterministicBrand: unique symbol

// A value computed by code, never the model — kept distinguishable at the type level so the two can't be silently interchanged (ticket 05 §2).
export type Deterministic<T> = T & { readonly [deterministicBrand]: true }

export function deterministic<T>(value: T): Deterministic<T> {
  return value as Deterministic<T>
}
