import { calibrate } from './commands/calibrate.ts'
import { claims } from './commands/claims.ts'
import { formats, policy, roles } from './commands/catalog.ts'
import { delivery } from './commands/delivery.ts'
import { doctor } from './commands/doctor.ts'
import { exportAll } from './commands/export.ts'
import { forget } from './commands/forget.ts'
import { importLogs } from './commands/import.ts'
import { jobs } from './commands/jobs.ts'
import { label } from './commands/label.ts'
import { ledger } from './commands/ledger.ts'
import { next } from './commands/next.ts'
import { replaySession } from './commands/replay.ts'
import { repo } from './commands/repo.ts'
import { review } from './commands/review.ts'
import { session } from './commands/session.ts'
import { transfer } from './commands/transfer.ts'
import { line } from './terminal.ts'

const USAGE = `closer — an interview mentor that interrogates what you actually built

  practice
    closer claims <resume.md>   extract claims from a résumé and confirm them
    closer session              interrogate a confirmed claim
        --claim <id>            which claim (default: every confirmed one)
        --level <junior|mid|senior|staff>
        --persona <collaborator|skeptic|bar_raiser|rusher>
        --mode <simulation|coach|drill|transfer|review>
        --format <id>           use a published-guidance format preset
        --role <id>             role pack the questions are shaped by
        --rounds <a,b>          project_deep_dive,design_extension,behavioral,code_walkthrough
        --turns <n>             turns per round, default 6
        --pressure <0-3>        your own ceiling on pressure
        --no-drill              skip the drill after the first gap
    closer transfer [--gap <id>]  retest a drilled gap under changed constraints
    closer next [--horizon <d>]   what is due, and the rounds that would cover it

  evidence
    closer ledger               the gap ledger, across every session
    closer review               compare attempts over time, in evidence
    closer replay [sessionId]   replay a session and re-check its citations
    closer repo [<path>]        pin a repository to a commit, or show the current pin
    closer delivery --session <id> [--from <turn.json>]
                                pace, pauses and filler words — never part of a judgment

  measurement
    closer label [--out <file>]   label your own findings, to measure agreement against
    closer calibrate [--labels <file>]
                                agreement and calibration from the labels that exist

  your data
    closer export [--out <file>]  everything CLOSER holds about you
    closer forget [--expired]     delete the pinned snapshot; its citations survive as a tombstone

  the machine
    closer roles                role packs, and whether any has been measured
    closer formats              interview format presets and what they are derived from
    closer policy               the action set, personas and rubric the policy runs on
    closer jobs [--enqueue <kind>]  the durable job table
    closer import [--from <dir>]  copy the file event log into Postgres
    closer doctor               check the local setup
`

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv
  switch (command) {
    case 'claims':
      return claims(rest)
    case 'session':
      return session(rest)
    case 'repo':
      return repo(rest)
    case 'label':
      return label(rest)
    case 'calibrate':
      return calibrate(rest)
    case 'review':
      return review(rest)
    case 'transfer':
      return transfer(rest)
    case 'next':
      return next(rest)
    case 'ledger':
      return ledger()
    case 'replay':
      return replaySession(rest)
    case 'import':
      return importLogs(rest)
    case 'export':
      return exportAll(rest)
    case 'forget':
      return forget(rest)
    case 'delivery':
      return delivery(rest)
    case 'roles':
      return roles()
    case 'formats':
      return formats()
    case 'policy':
      return policy()
    case 'jobs':
      return jobs(rest)
    case 'doctor':
      return doctor()
    case undefined:
    case '--help':
    case '-h':
      line(USAGE)
      return 0
    default:
      line(`unknown command: ${command}\n`)
      line(USAGE)
      return 1
  }
}

process.exit(await main(process.argv.slice(2)))
