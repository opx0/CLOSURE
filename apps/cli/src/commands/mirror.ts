import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { renderScreen, replay, simulateScreen } from '@levelhead/core'
import { untrusted, type Claim, type Span } from '@levelhead/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { CLAIM_SET_SESSION } from './claims.ts'
import { dim, line } from '../terminal.ts'

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

// A model of the automated screen on the other side of an application, run against one job posting.
// It is never a judgment of the candidate and produces no match number; `renderScreen` prints that.
export async function mirror(argv: readonly string[]): Promise<number> {
  const resumePath = flag(argv, 'resume')
  const jobPath = flag(argv, 'job')
  if (resumePath === undefined || jobPath === undefined) {
    line('levelhead mirror --resume <file> --job <file>')
    return 1
  }

  const resumeText = await readFile(resumePath, 'utf8')
  const jobText = await readFile(jobPath, 'utf8')
  // The same source id the `claims` flow derives, so a claim set confirmed for this résumé is found.
  const resumeSourceId = `resume:${createHash('sha256').update(resumeText).digest('hex').slice(0, 12)}`

  const config = loadCliConfig()
  const { store, close } = openStore(config)

  try {
    const claimSet = replay(await store.read(CLAIM_SET_SESSION))
    const claims: Claim[] = [...claimSet.claims.values()].filter(
      (claim) =>
        claimSet.confirmedClaimIds.has(claim.id) &&
        claimSet.spans.get(claim.spanId)?.sourceId === resumeSourceId,
    )
    const claimSpans: Span[] = claims.flatMap((claim) => {
      const span = claimSet.spans.get(claim.spanId)
      return span === undefined ? [] : [span]
    })

    // The screen reads the whole résumé, so coverage is checked against a span over all of it. The
    // claim spans ride alongside so a vague verb in the candidate's own words is still flagged.
    const wholeResume: Span = {
      id: 'resume:all',
      sourceId: resumeSourceId,
      startByte: 0,
      endByte: Buffer.byteLength(resumeText, 'utf8'),
      quoted: resumeText,
    }

    const simulation = simulateScreen({
      jobDescription: untrusted(jobText),
      resumeText: untrusted(resumeText),
      resumeSourceId,
      spans: [wholeResume, ...claimSpans],
      claims,
    })

    for (const row of renderScreen(simulation)) line(row)

    if (claims.length === 0) {
      dim(
        '  No confirmed claims for this résumé, so only the keyword coverage ran. Run levelhead claims first to screen your claims too.',
      )
    }
    return 0
  } finally {
    await close()
  }
}
