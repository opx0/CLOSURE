import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { JobRecordSchema } from '@levelhead/contracts'
import { openPinned, pinnedSnapshots, type PinnedEntry } from '@levelhead/core'
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
        if (entry === undefined || artifact === undefined) {
          return reply.code(404).send({ error: 'no such artifact', detail: `${id} ${artifactId}` })
        }

        const repository = new GitRepository({
          ids: deps.ids,
          clock: deps.clock,
          ...(deps.sourceRelocation === undefined
            ? {}
            : { sourceRelocation: deps.sourceRelocation }),
        })
        repository.register(entry.snapshot)
        const code = await repository.read(artifact)
        if (code === null) {
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
            { reuseIdentical: true },
          )
          const { snapshot, artifacts, evidence } = pinned
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
