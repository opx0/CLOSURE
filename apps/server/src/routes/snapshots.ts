import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { JobRecordSchema } from '@levelhead/contracts'
import { SessionLog, openPinned, pinnedSnapshots, type PinnedEntry } from '@levelhead/core'
import { idempotencyKeyFor } from '@levelhead/db'
import { REPO_SESSION } from '../../../cli/src/commands/repo.ts'
import { GitRepository } from '../../../cli/src/repo/git-repository.ts'
import {
  DEFAULT_INGEST_LIMITS,
  pinIsolated,
} from '../../../worker/src/handlers/ingest-repository.ts'
import { IngestFailed } from '../../../worker/src/parse/isolated.ts'
import type { ServerDeps } from '../deps.ts'
import { ErrorSchema } from './shared.ts'
import { indexRepository } from '../../../cli/src/repository-search.ts'

const PinnedSnapshotSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  repoPath: Type.String({ minLength: 1 }),
  commit: Type.String({ minLength: 1 }),
  fileCount: Type.Integer({ minimum: 0 }),
  artifactCount: Type.Integer({ minimum: 0 }),
  pinnedAt: Type.String({ format: 'date-time' }),
  deleted: Type.Boolean(),
})

export const ShownArtifactSchema = Type.Object({
  path: Type.String({ minLength: 1 }),
  symbol: Type.Optional(Type.String({ minLength: 1 })),
  startLine: Type.Optional(Type.Integer({ minimum: 1 })),
  endLine: Type.Optional(Type.Integer({ minimum: 1 })),
  code: Type.String(),
  repositoryContext: Type.Optional(
    Type.Object({
      sources: Type.Array(
        Type.Object({
          artifactId: Type.String(),
          snapshotId: Type.String(),
          commit: Type.String(),
          path: Type.String(),
          startLine: Type.Integer(),
          endLine: Type.Integer(),
          contentHash: Type.String(),
          text: Type.String(),
        }),
      ),
      trace: Type.Object({
        version: Type.String(),
        queryHash: Type.String(),
        strategy: Type.Union([
          Type.Literal('lexical'),
          Type.Literal('dense'),
          Type.Literal('hybrid'),
        ]),
        embeddingProfileId: Type.Optional(Type.String()),
        sources: Type.Array(
          Type.Object({
            artifactId: Type.String(),
            snapshotId: Type.String(),
            commit: Type.String(),
            path: Type.String(),
            startLine: Type.Integer(),
            endLine: Type.Integer(),
            contentHash: Type.String(),
          }),
        ),
        contextHash: Type.String(),
        retrievedCount: Type.Integer(),
        sourceCount: Type.Integer(),
        tokenCount: Type.Integer(),
      }),
    }),
  ),
})

// Pinning and reading pinned code both read a path on this server's own disk.
const SHOWCASE_REFUSED = {
  error: 'a showcase visitor cannot pin or read a repository',
  detail: 'pinning reads a path on this server’s own disk',
}

function summaryOf(entry: PinnedEntry): Static<typeof PinnedSnapshotSchema> {
  return {
    id: entry.snapshot.id,
    repoPath: entry.snapshot.repoPath,
    commit: entry.snapshot.commit,
    fileCount: entry.snapshot.fileCount,
    artifactCount: entry.artifacts.length,
    pinnedAt: entry.snapshot.pinnedAt,
    deleted: entry.deleted,
  }
}

export function snapshotRoutes(deps: ServerDeps): FastifyPluginAsyncTypebox {
  return async (app) => {
    app.get(
      '/snapshots',
      {
        schema: {
          summary: 'Repositories this owner has pinned, most recent first',
          tags: ['snapshots'],
          response: { 200: Type.Object({ snapshots: Type.Array(PinnedSnapshotSchema) }) },
        },
      },
      async (request) => ({
        snapshots: pinnedSnapshots(await deps.storeFor(request.principal).read(REPO_SESSION))
          .reverse()
          .map(summaryOf),
      }),
    )

    app.get(
      '/snapshots/:id/artifacts/:artifactId',
      {
        schema: {
          summary: 'The code of one artifact, read at the commit its snapshot pinned',
          tags: ['snapshots'],
          params: Type.Object({
            id: Type.String({ minLength: 1 }),
            artifactId: Type.String({ minLength: 1 }),
          }),
          response: {
            200: Type.Object({ artifact: ShownArtifactSchema }),
            403: ErrorSchema,
            404: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        if (request.principal.role === 'showcase') return reply.code(403).send(SHOWCASE_REFUSED)
        const { id, artifactId } = request.params
        const entry = openPinned(await deps.storeFor(request.principal).read(REPO_SESSION), id)
        const artifact = entry?.artifacts.find((candidate) => candidate.id === artifactId)
        if (
          entry === undefined ||
          artifact === undefined ||
          (deps.retrieval?.isLive !== undefined &&
            !(await deps.retrieval.isLive(request.principal.ownerId, id)))
        ) {
          return reply.code(404).send({ error: 'no such artifact', detail: `${id} ${artifactId}` })
        }

        const repository = new GitRepository({ ids: deps.ids, clock: deps.clock })
        repository.register(entry.snapshot)
        const code = await repository.read(artifact)
        if (
          code === null ||
          (deps.retrieval?.isLive !== undefined &&
            !(await deps.retrieval.isLive(request.principal.ownerId, id)))
        ) {
          return reply.code(404).send({
            error: 'the code is no longer readable',
            detail: `${artifact.path} at ${entry.snapshot.commit}`,
          })
        }
        const { path, symbol, startLine, endLine } = artifact
        return {
          artifact: {
            path,
            ...(symbol === undefined ? {} : { symbol }),
            ...(startLine === undefined ? {} : { startLine }),
            ...(endLine === undefined ? {} : { endLine }),
            code,
          },
        }
      },
    )

    app.post(
      '/snapshots',
      {
        schema: {
          summary:
            'Pin a repository. Parsing runs in an isolated process, never in this one: queued when ' +
            'a durable queue exists, awaited here when none does',
          tags: ['snapshots'],
          body: Type.Object({
            repoPath: Type.String({ minLength: 1 }),
            ref: Type.Optional(Type.String({ minLength: 1 })),
            sessionId: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' })),
          }),
          response: {
            201: Type.Object({ snapshot: PinnedSnapshotSchema }),
            202: Type.Object({ job: JobRecordSchema }),
            400: ErrorSchema,
            403: ErrorSchema,
            422: ErrorSchema,
          },
        },
      },
      async (request, reply) => {
        if (request.principal.role === 'showcase') return reply.code(403).send(SHOWCASE_REFUSED)

        const { repoPath } = request.body
        const ref = request.body.ref ?? 'HEAD'
        const sessionId = request.body.sessionId ?? REPO_SESSION

        if (deps.queue !== null) {
          const job = await deps.queue.enqueue({
            ownerId: request.principal.ownerId,
            kind: 'ingest_repository',
            payload: { kind: 'ingest_repository', repoPath, ref, sessionId },
            idempotencyKey: idempotencyKeyFor('ingest_repository', [repoPath, ref]),
          })
          return reply.code(202).send({ job })
        }

        try {
          const pinned = await pinIsolated(
            { store: deps.storeFor(request.principal), clock: deps.clock, ids: deps.ids },
            { repoPath, ref, sessionId },
            DEFAULT_INGEST_LIMITS,
            { reuseIdentical: true, publish: deps.retrieval === null },
          )
          const { snapshot, artifacts, evidence } = pinned
          if (deps.retrieval !== null) {
            if (deps.retrieval.recordSnapshot === undefined)
              throw new Error('repository index cannot publish snapshots')
            await indexRepository(
              {
                recordSnapshot: deps.retrieval.recordSnapshot.bind(deps.retrieval),
                index: deps.retrieval.index.bind(deps.retrieval),
              },
              request.principal.ownerId,
              snapshot,
              artifacts.map((artifact) => ({ artifact, text: pinned.bodies[artifact.id] ?? '' })),
            )
            const store = deps.storeFor(request.principal)
            if (
              !pinnedSnapshots(await store.read(sessionId)).some(
                (entry) => entry.snapshot.id === snapshot.id,
              )
            ) {
              const log = await SessionLog.open(
                { store, clock: deps.clock, ids: deps.ids },
                sessionId,
              )
              await log.append('state_change', {
                change: 'snapshot_pinned',
                snapshot,
                artifacts,
                evidence,
              })
            }
          }
          return reply
            .code(201)
            .send({ snapshot: summaryOf({ snapshot, artifacts, evidence, deleted: false }) })
        } catch (error) {
          if (!(error instanceof IngestFailed)) throw error
          return reply.code(error.reason === 'refused' ? 400 : 422).send({
            error: `repository not pinned: ${error.reason}`,
            detail: error.message,
          })
        }
      },
    )
  }
}
