import { Type, type Static } from '@sinclair/typebox'

// Deletable — replay has to survive its absence, and artifacts carry locations rather than copies of the code.
export const SnapshotSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  repoPath: Type.String({ minLength: 1 }),
  commit: Type.String({ minLength: 1 }),
  pinnedAt: Type.String({ format: 'date-time' }),
  fileCount: Type.Integer({ minimum: 0 }),
})
export type Snapshot = Static<typeof SnapshotSchema>
