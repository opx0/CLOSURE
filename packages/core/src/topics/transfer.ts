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
