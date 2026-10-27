import { expect, test } from 'bun:test'
import { nextTransferVariant, TRANSFER_VARIANTS } from './transfer.ts'

test('authored transfer variants are versioned, selected without repetition, and unavailable after exhaustion', () => {
  const exposed = new Set<string>()
  const selected: string[] = []
  for (let index = 0; index < 3; index++) {
    const variant = nextTransferVariant('dbms.indexes', exposed)!
    expect(variant.reviewState).toBe('agent_authored_unreviewed')
    selected.push(variant.scenario)
    exposed.add(`${variant.id}@${variant.version}`)
  }
  expect(new Set(selected).size).toBe(3)
  expect(nextTransferVariant('dbms.indexes', exposed)).toBeUndefined()
  expect(nextTransferVariant('unknown.topic', new Set())).toBeUndefined()
  expect(nextTransferVariant('dbms.indexes', new Set(['indexes.tenant_prefix@0']))?.id).toBe(
    'indexes.leading_wildcard',
  )
  expect(TRANSFER_VARIANTS.every((variant) => variant.version === 1)).toBe(true)
})
