import { expect, test } from 'bun:test'
import { extractSymbols } from './symbols.ts'

// The §4.8 example, near enough: cites `claimJob` by name and by lease.
const QUEUE_TS = `import type { Job } from './types.ts'

const LEASE_MS = 30_000

export class JobQueue {
  #jobs: Job[] = []

  async claimJob(worker: string): Promise<Job | null> {
    const job = this.#jobs.find((candidate) => candidate.leasedUntil < Date.now())
    if (job === undefined) return null
    job.leasedUntil = Date.now() + LEASE_MS
    return job
  }

  size(): number {
    return this.#jobs.length
  }
}

export function describeQueue(queue: JobQueue): string {
  return \`queue of \${queue.size()} { pending }\`
}
`

function lines(source: string, from: number, to: number): string {
  return source
    .split('\n')
    .slice(from - 1, to)
    .join('\n')
}

test('locates a class, its methods and a function, with 1-based inclusive ranges', () => {
  const found = extractSymbols('src/queue.ts', QUEUE_TS)

  expect(found).toEqual([
    { symbol: 'JobQueue', startLine: 5, endLine: 18 },
    { symbol: 'claimJob', startLine: 8, endLine: 13 },
    { symbol: 'size', startLine: 15, endLine: 17 },
    { symbol: 'describeQueue', startLine: 20, endLine: 22 },
  ])

  const claimJob = found.find((symbol) => symbol.symbol === 'claimJob')
  expect(lines(QUEUE_TS, claimJob?.startLine ?? 0, claimJob?.endLine ?? 0)).toBe(
    [
      '  async claimJob(worker: string): Promise<Job | null> {',
      '    const job = this.#jobs.find((candidate) => candidate.leasedUntil < Date.now())',
      '    if (job === undefined) return null',
      '    job.leasedUntil = Date.now() + LEASE_MS',
      '    return job',
      '  }',
    ].join('\n'),
  )
})

test('braces inside strings, comments and regular expressions do not move a range', () => {
  const source = [
    'export function render(name) {',
    '  const open = "{"',
    "  const close = '}'",
    '  // } this comment closes nothing',
    '  /* }}} nor does this */',
    '  const braces = /[{}]+/g',
    '  return `${name} {${open}${close}}`.replace(braces, "")',
    '}',
    '',
  ].join('\n')

  expect(extractSymbols('render.js', source)).toEqual([
    { symbol: 'render', startLine: 1, endLine: 8 },
  ])
})

test('locates an arrow function assigned to a const, and a signature wrapped over lines', () => {
  const source = [
    'export const retry = async (job: Job): Promise<void> => {',
    '  await run(job)',
    '}',
    '',
    'export async function scheduleWithBackoff(',
    '  job: Job,',
    '  attempts: number,',
    '): Promise<void> {',
    '  await sleep(attempts * 100)',
    '}',
    '',
  ].join('\n')

  expect(extractSymbols('worker.ts', source)).toEqual([
    { symbol: 'retry', startLine: 1, endLine: 3 },
    { symbol: 'scheduleWithBackoff', startLine: 5, endLine: 10 },
  ])
})

test('locates a Python def, a method and a class, docstring columns included', () => {
  const source = [
    'import time',
    '',
    '',
    'class Queue:',
    '    """Holds jobs.',
    '',
    'Lines in a docstring may sit at column zero and are still the body.',
    '    """',
    '',
    '    def claim_job(self, worker):',
    '        job = self._next()',
    '        return job',
    '',
    '',
    'def drain(',
    '    queue,',
    '):',
    '    while queue:',
    '        queue.pop()',
    '',
  ].join('\n')

  expect(extractSymbols('queue.py', source)).toEqual([
    { symbol: 'Queue', startLine: 4, endLine: 12 },
    { symbol: 'claim_job', startLine: 10, endLine: 12 },
    { symbol: 'drain', startLine: 15, endLine: 19 },
  ])
})

test('locates a Go function, a method with a receiver and a struct type', () => {
  const source = [
    'package queue',
    '',
    'type Job struct {',
    '\tID string',
    '}',
    '',
    'func (q *Queue) ClaimJob(worker string) (*Job, error) {',
    '\tconst raw = `a } inside a raw string`',
    '\treturn q.next()',
    '}',
    '',
    'func Drain(q *Queue) {',
    '\tq.jobs = nil',
    '}',
    '',
  ].join('\n')

  expect(extractSymbols('queue.go', source)).toEqual([
    { symbol: 'Job', startLine: 3, endLine: 5 },
    { symbol: 'ClaimJob', startLine: 7, endLine: 10 },
    { symbol: 'Drain', startLine: 12, endLine: 14 },
  ])
})

// The property the whole file exists for: a plausible header with no body to stand behind must
// report nothing rather than a §4.8 citation on code the candidate didn't write.
test('reports nothing rather than a guessed range for what it cannot locate', () => {
  const truncated = 'export function claimJob(worker) {\n  return worker\n'
  expect(extractSymbols('truncated.ts', truncated)).toEqual([])

  const misindented = ['class Queue {', '  claimJob() {', '    return 1', '}', '}', ''].join('\n')
  expect(extractSymbols('misindented.ts', misindented).map((found) => found.symbol)).toEqual([
    'Queue',
  ])

  const signaturesOnly = [
    'interface Worker {',
    '  claimJob(worker: string): Promise<void>',
    '}',
    '',
    'export abstract class Base {',
    '  abstract claimJob(worker: string): Promise<void>;',
    '}',
    '',
  ].join('\n')
  expect(extractSymbols('signatures.ts', signaturesOnly).map((found) => found.symbol)).toEqual([
    'Base',
  ])

  // Control flow wears a function's shape; none of it is a symbol.
  const controlFlow = [
    'export function run(jobs) {',
    '  for (const job of jobs) {',
    '    if (job.ready) {',
    '      while (job.next) {',
    '        job = job.next',
    '      }',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n')
  expect(extractSymbols('run.ts', controlFlow).map((found) => found.symbol)).toEqual(['run'])
})

test('a language it does not read yields nothing at all', () => {
  expect(extractSymbols('README.md', '# claimJob\n\nfunction claimJob() {}\n')).toEqual([])
  expect(extractSymbols('Makefile', 'build:\n\tgo build ./...\n')).toEqual([])
})
