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

test('representative fundamentals have distinct, versioned unfamiliar retests without recycling exposure', () => {
  const topics = [
    'dsa.hash_maps',
    'dsa.bfs_dfs',
    'dbms.transactions_isolation',
    'os.deadlock',
    'backend.rest_idempotency',
  ]
  for (const topicId of topics) {
    const first = nextTransferVariant(topicId, new Set())!
    expect(first.topicId).toBe(topicId)
    expect(first.reviewState).toBe('agent_authored_unreviewed')
    expect(first.scenario.length).toBeGreaterThan(100)
    expect(nextTransferVariant(topicId, new Set([`${first.id}@${first.version}`]))).toBeUndefined()
    // Prior exposure follows the identity across a future version bump.
    expect(nextTransferVariant(topicId, new Set([`${first.id}@0`]))).toBeUndefined()
  }
  expect(new Set(TRANSFER_VARIANTS.map((variant) => variant.id)).size).toBe(
    TRANSFER_VARIANTS.length,
  )
})
