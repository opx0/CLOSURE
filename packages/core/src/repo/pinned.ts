import type { AnyEvent, Artifact, Evidence, Snapshot } from '@levelhead/contracts'

export interface PinnedEntry {
  snapshot: Snapshot
  artifacts: Artifact[]
  evidence: Evidence[]
  deleted: boolean
}

// In pin order. Replay's fold keeps only the latest pin and every artifact ever pinned, which is
// the wrong answer once a candidate has pinned more than one project or deleted one.
export function pinnedSnapshots(events: readonly AnyEvent[]): PinnedEntry[] {
  const pinned: PinnedEntry[] = []
  const deleted = new Set<string>()
  for (const event of events) {
    if (event.kind !== 'state_change') continue
    const change = event.payload
    if (change.change === 'snapshot_pinned') {
      const { snapshot, artifacts, evidence } = change
      pinned.push({ snapshot, artifacts, evidence, deleted: false })
    }
    if (change.change === 'snapshot_deleted') deleted.add(change.tombstone.snapshotId)
  }
  return pinned.map((entry) => ({ ...entry, deleted: deleted.has(entry.snapshot.id) }))
}

// The named snapshot while it is still pinned; with none named, the most recent one that is.
export function openPinned(
  events: readonly AnyEvent[],
  snapshotId?: string,
): PinnedEntry | undefined {
  const live = pinnedSnapshots(events).filter((entry) => !entry.deleted)
  return snapshotId === undefined
    ? live[live.length - 1]
    : live.find((entry) => entry.snapshot.id === snapshotId)
}
