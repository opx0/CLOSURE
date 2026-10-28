import type { TransferVariant } from '@levelhead/contracts'

export const TRANSFER_VARIANTS: readonly TransferVariant[] = [
  {
    id: 'indexes.tenant_prefix',
    version: 1,
    topicId: 'dbms.indexes',
    reviewState: 'agent_authored_unreviewed',
    scenario:
      'An orders table has a B-tree index on (tenant_id, created_at). A new report filters only by created_at across all tenants. Explain what work the index can avoid, what it cannot guarantee, and a trade-off of changing it.',
  },
  {
    id: 'indexes.leading_wildcard',
    version: 1,
    topicId: 'dbms.indexes',
    reviewState: 'agent_authored_unreviewed',
    scenario:
      'A product search uses a plain B-tree index on name. The query changes from an exact name to LIKE %adapter%. Explain why lookup behavior can change, what evidence you would inspect, and the cost of an alternative.',
  },
  {
    id: 'indexes.low_selectivity',
    version: 1,
    topicId: 'dbms.indexes',
    reviewState: 'agent_authored_unreviewed',
    scenario:
      'An accounts table has an index on active, but 95 percent of rows are active. A query fetches all columns for active accounts. Explain why a table scan may be cheaper, how you would check, and the maintenance cost of retaining the index.',
  },
  {
    id: 'hash_maps.adversarial_keys',
    version: 1,
    topicId: 'dsa.hash_maps',
    reviewState: 'agent_authored_unreviewed',
    scenario:
      'A request counter uses a hash map keyed by arbitrary user-supplied strings. Most requests are fast, but one batch of distinct keys makes lookups much slower. Trace a possible collision path, distinguish average from worst-case cost, and explain a mitigation and its memory or CPU trade-off.',
  },
  {
    id: 'bfs_dfs_weighted_routes',
    version: 1,
    topicId: 'dsa.bfs_dfs',
    reviewState: 'agent_authored_unreviewed',
    scenario:
      'A delivery graph has roads with different travel times. A teammate uses BFS to find the route with the fewest minutes. Trace a small counterexample where the fewest edges is slower, identify what BFS still guarantees, and choose an approach that handles nonnegative weights.',
  },
  {
    id: 'isolation.concurrent_booking',
    version: 1,
    topicId: 'dbms.transactions_isolation',
    reviewState: 'agent_authored_unreviewed',
    scenario:
      'Two transactions each read that a workshop has one place left, then insert a booking for a different attendee. Both commit under a database setup that permits this outcome. Explain the invariant at risk, an isolation or constraint strategy, and how the application handles a rejected transaction.',
  },
  {
    id: 'deadlock.opposite_lock_order',
    version: 1,
    topicId: 'os.deadlock',
    reviewState: 'agent_authored_unreviewed',
    scenario:
      'Worker A holds the inventory lock and waits for payments; worker B holds the payments lock and waits for inventory. Trace the wait-for cycle, choose a prevention or recovery strategy, and explain how you would distinguish deadlock from a slow worker.',
  },
  {
    id: 'idempotency.timeout_retry',
    version: 1,
    topicId: 'backend.rest_idempotency',
    reviewState: 'agent_authored_unreviewed',
    scenario:
      'A client times out after POST /orders and retries the same body. The first request may already have committed. Explain why identical bodies alone cannot guarantee one order, how a scoped idempotency key is stored and checked under concurrent retries, and what happens if the key is reused with different input.',
  },
]

export function nextTransferVariant(
  topicId: string,
  exposed: ReadonlySet<string>,
): TransferVariant | undefined {
  return TRANSFER_VARIANTS.find(
    (variant) =>
      variant.topicId === topicId &&
      ![...exposed].some((key) => key === variant.id || key.startsWith(`${variant.id}@`)),
  )
}
