import { FormatRegistry } from '@sinclair/typebox'

// Must run before any schema is checked (an unregistered format fails validation); `Date.parse` alone would accept a bare date like `2026-09-09`, not just an instant.
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/

if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set(
    'date-time',
    (value) => RFC3339.test(value) && !Number.isNaN(Date.parse(value)),
  )
}
