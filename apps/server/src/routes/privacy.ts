import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { ExportBundleSchema, SnapshotTombstoneSchema } from '@levelhead/contracts'
import { SessionLog, buildExportBundle, pinnedSnapshots, tombstoneFor } from '@levelhead/core'
import { REPO_SESSION } from '../../../cli/src/commands/repo.ts'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema } from './shared.ts'

// PROJECT.md §7 and the honesty contract: export and deletion are the candidate's, and neither is
// a support request. Both are ordinary routes.
export function privacyRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/export',
      {
        schema: {
          summary: 'Everything Levelhead holds about you, as events plus the view they fold into',
          tags: ['privacy'],
          response: { 200: ExportBundleSchema },
        },
      },
      async (request) => {
        const store = deps.storeFor(request.principal)
        const sessions = []
        for (const sessionId of await store.listSessions()) {
          sessions.push({ sessionId, events: await store.read(sessionId) })
        }
        return buildExportBundle({
          ownerId: request.principal.ownerId,
          producedAt: deps.clock.now(),
          sessions,
        })
      },
    )

    app.delete(
      '/snapshots/:id',
      {
        schema: {
          summary: 'Delete a pinned repository snapshot; its citations survive as a tombstone',
          tags: ['privacy'],
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          response: {
            200: Type.Object({ tombstone: SnapshotTombstoneSchema }),
            404: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const store = deps.storeFor(request.principal)
        const pinned = pinnedSnapshots(await store.read(REPO_SESSION)).find(
          (entry) => entry.snapshot.id === request.params.id,
        )
        if (pinned === undefined) {
          return reply.code(404).send({ error: 'no such snapshot', detail: request.params.id })
        }
        const { snapshot } = pinned
        if (pinned.deleted) {
          return reply.code(404).send({ error: 'snapshot already deleted', detail: snapshot.id })
        }

        const tombstone = tombstoneFor({
          snapshot,
          contentHash: snapshot.commit,
          artifactCount: pinned.artifacts.length,
          reason: 'candidate_requested',
          deletedAt: deps.clock.now(),
        })

        const log = await SessionLog.open({ store, clock: deps.clock, ids: deps.ids }, REPO_SESSION)
        await log.append('state_change', { change: 'snapshot_deleted', tombstone })
        await deps.retrieval?.forget(request.principal.ownerId, snapshot.id)

        return { tombstone }
      },
    )

    app.get(
      '/privacy',
      {
        schema: {
          summary: 'What is kept, for how long, and what deletion means for a past session',
          tags: ['privacy'],
          response: {
            200: Type.Object({
              spans: Type.String(),
              snapshots: Type.String(),
              logs: Type.String(),
              providerRetention: Type.String(),
              replayAfterDeletion: Type.String(),
              export: Type.String(),
            }),
          },
        },
      },
      async () => ({
        spans:
          'A span is a citation into text you supplied. It is kept for as long as the session it ' +
          'is cited by, because a finding without its evidence is the thing Levelhead exists to refuse.',
        snapshots:
          'A pinned repository snapshot is deletable, by you at any time and automatically once it ' +
          'expires. Repository code is parsed, never executed, and never copied into the event log.',
        logs:
          'Ordinary logs carry opaque ids only. Résumé text, transcript text and repository source ' +
          'never appear in them.',
        providerRetention:
          'Answers and résumé text are sent to whichever model provider is configured, and are ' +
          'subject to that provider’s retention terms — documented, not prevented. The local-model ' +
          'adapter exists partly so self-use need not send anything at all.',
        replayAfterDeletion:
          'A replay after a snapshot is deleted still runs. Artifact citations read as ' +
          '"snapshot_deleted" — neither resolved nor broken — so a deletion can never be mistaken ' +
          'for a citation that never resolved.',
        export:
          'GET /export returns every event, transcript, finding and gap held for you, in the same ' +
          'append-only form Levelhead reads.',
      }),
    )
  }
}
