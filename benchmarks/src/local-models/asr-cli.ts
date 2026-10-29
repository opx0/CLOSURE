import { readFile, writeFile } from 'node:fs/promises'
import { runStreamingAsrCase, type ReviewedSpeechCase } from './asr.ts'
import { preflightLocalModels } from './preflight.ts'

const [manifestPath, candidateId, casesPath, reportPath] = process.argv.slice(2)
if (!manifestPath || !candidateId || !casesPath || !reportPath || process.argv.length !== 6)
  throw new Error(
    'Usage: bun run models:asr:run CANDIDATES.json CANDIDATE_ID CASES.json NEW_REPORT.json',
  )
const endpoint = process.env.VOICE_STREAM_URL ?? 'ws://127.0.0.1:8092'
const token = process.env.VOICE_STREAM_TOKEN
if (!token) throw new Error('VOICE_STREAM_TOKEN is required for the local recognizer')
const preflight = await preflightLocalModels(JSON.parse(await readFile(manifestPath, 'utf8')))
const candidate = preflight.candidates.find((item) => item.id === candidateId)
if (!candidate || candidate.kind !== 'streaming_asr' || !candidate.artifactReady)
  throw new Error('Selected streaming ASR candidate has no verified local artifacts')
const cases: unknown = JSON.parse(await readFile(casesPath, 'utf8'))
if (
  !Array.isArray(cases) ||
  cases.length < 1 ||
  cases.length > 20 ||
  new Set(cases.map((item) => item?.id)).size !== cases.length
)
  throw new Error('Expected 1–20 distinct reviewed speech cases')
const observations = []
for (const item of cases as ReviewedSpeechCase[])
  observations.push(await runStreamingAsrCase(item, endpoint, token))
await writeFile(
  reportPath,
  `${JSON.stringify(
    {
      version: 1,
      candidate,
      cases: observations,
      selection: null,
      runtimeModelIdentityVerified: false,
      batchAsrComparison: null,
      concurrentResourceUse: null,
      note: 'Observed local streaming output; confirm the running sidecar loaded the candidate artifacts. No model selected; batch and concurrent comparisons remain open.',
    },
    null,
    2,
  )}\n`,
  { flag: 'wx', mode: 0o600 },
)
console.log(`Recorded ${observations.length} streaming ASR case(s); model selection remains open.`)
