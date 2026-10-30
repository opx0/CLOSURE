import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { preflightLocalModels } from './preflight.ts'

// Records raw outputs for later human review. It never assigns quality labels or downloads models.
const [manifestPath, candidateId, casesPath, reportPath] = process.argv.slice(2)
if (!manifestPath || !candidateId || !casesPath || !reportPath || process.argv.length !== 6)
  throw new Error(
    'Usage: bun run models:llm:run CANDIDATES.json CANDIDATE_ID CASES.json NEW_REPORT.json',
  )
const base = new URL(process.env.LOCAL_LLM_URL ?? 'http://127.0.0.1:8080')
if (
  base.protocol !== 'http:' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  (base.pathname !== '/' && base.pathname !== '')
)
  throw new Error('LOCAL_LLM_URL must be a loopback HTTP origin')
const model = process.env.LOCAL_LLM_MODEL
if (!model?.trim()) throw new Error('LOCAL_LLM_MODEL must name the already loaded model')
const preflight = await preflightLocalModels(JSON.parse(await readFile(manifestPath, 'utf8')))
const candidate = preflight.candidates.find((entry) => entry.id === candidateId)
if (!candidate || candidate.kind !== 'llm' || !candidate.artifactReady)
  throw new Error('The candidate must be an LLM with verified artifacts')
const rawCases = await readFile(casesPath)
const cases: unknown = JSON.parse(rawCases.toString('utf8'))
if (
  !Array.isArray(cases) ||
  cases.length < 1 ||
  cases.length > 100 ||
  cases.some(
    (item) =>
      !item ||
      typeof item.id !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(item.id) ||
      typeof item.prompt !== 'string' ||
      !item.prompt.trim() ||
      item.prompt.length > 20000 ||
      typeof item.reviewedBy !== 'string' ||
      !item.reviewedBy.trim(),
  ) ||
  new Set(cases.map((item) => item.id)).size !== cases.length
)
  throw new Error('Cases must contain 1–100 distinct reviewed prompts')

async function measure(prompt: string) {
  const started = performance.now()
  const response = await fetch(new URL('/v1/chat/completions', base), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0,
      max_tokens: 512,
    }),
  })
  if (!response.ok || !response.body)
    throw new Error(`Local model request failed (${response.status})`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '',
    output = '',
    firstTokenMs: number | null = null,
    done = false
  try {
    while (true) {
      const chunk = await reader.read()
      buffer = (buffer + decoder.decode(chunk.value, { stream: !chunk.done })).replace(
        /\r\n/g,
        '\n',
      )
      if (buffer.length > 1024 * 1024 || output.length > 200000)
        throw new Error('Model response exceeded limit')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data) continue
        if (data === '[DONE]') {
          done = true
          continue
        }
        const payload = JSON.parse(data) as { choices?: { delta?: { content?: unknown } }[] }
        const text = payload.choices?.[0]?.delta?.content
        if (typeof text === 'string' && text.length) {
          firstTokenMs ??= Math.round(performance.now() - started)
          output += text
        }
      }
      if (chunk.done) break
    }
  } finally {
    reader.releaseLock()
  }
  if (!done || firstTokenMs === null || !output.trim())
    throw new Error('Incomplete streaming model response')
  return { firstTokenMs, elapsedMs: Math.round(performance.now() - started), output }
}

const observations = []
for (const item of cases as { id: string; prompt: string; reviewedBy: string }[]) {
  let first: Awaited<ReturnType<typeof measure>> | null = null
  let second: Awaited<ReturnType<typeof measure>> | null = null
  let failure: string | null = null
  try {
    first = await measure(item.prompt)
    second = await measure(item.prompt)
  } catch {
    failure = 'Local request failed or returned an incomplete response; inspect the local server.'
  }
  observations.push({ id: item.id, reviewedBy: item.reviewedBy, first, second, failure })
}
await writeFile(
  reportPath,
  `${JSON.stringify(
    {
      version: 1,
      measuredAt: new Date().toISOString(),
      candidate,
      model,
      casesSha256: createHash('sha256').update(rawCases).digest('hex'),
      observations,
      runtimeModelIdentityVerified: false,
      selection: null,
      note: 'First and second requests are labeled by order; an already loaded server is not a verified cold start. Outputs require independent review. Artifact identity, concurrent ASR/TTS, resource use and first audio remain unverified.',
    },
    null,
    2,
  )}\n`,
  { flag: 'wx', mode: 0o600 },
)
console.log(
  `Recorded ${observations.length} local model case(s); review and resource measurements remain required.`,
)
