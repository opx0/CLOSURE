import { forbidNetwork } from './no-network.ts'
import { GitRepository } from '../../../cli/src/repo/git-repository.ts'
import { RandomIds, SystemClock } from '../../../cli/src/runtime.ts'

forbidNetwork()

interface Request {
  repoPath: string
  ref: string
  limits: {
    maxFiles: number
    maxTotalBytes: number
    maxFileBytes: number
    maxDepth: number
    timeoutMs: number
  }
}

async function readRequest(): Promise<Request> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Request
}

const request = await readRequest()
const repository = new GitRepository({
  ids: new RandomIds(),
  clock: new SystemClock(),
  limits: request.limits,
})

try {
  const pinned = await repository.pin(request.repoPath, request.ref)
  const bodies: Record<string, string> = {}
  for (const artifact of pinned.artifacts) {
    const body = await repository.read(artifact)
    if (body !== null) bodies[artifact.id] = body
  }
  process.stdout.write(JSON.stringify({ ok: true, pinned, bodies }))
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
  process.exitCode = 1
}
