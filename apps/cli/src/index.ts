import { calibrate } from './commands/calibrate.ts'
import { claims } from './commands/claims.ts'
import { formats, policy, roles, topics } from './commands/catalog.ts'
import { debrief } from './commands/debrief.ts'
import { delivery } from './commands/delivery.ts'
import { doctor } from './commands/doctor.ts'
import { exportAll } from './commands/export.ts'
import { forget } from './commands/forget.ts'
import { importLogs } from './commands/import.ts'
import { jobs } from './commands/jobs.ts'
import { label } from './commands/label.ts'
import { ledger } from './commands/ledger.ts'
import { mirror } from './commands/mirror.ts'
import { next } from './commands/next.ts'
import { replaySession } from './commands/replay.ts'
import { repo } from './commands/repo.ts'
import { resume } from './commands/resume.ts'
import { review } from './commands/review.ts'
import { session } from './commands/session.ts'
import { transfer } from './commands/transfer.ts'
import { trend } from './commands/trend.ts'
import { line } from './terminal.ts'

const USAGE = `levelhead — practise real tech interviews, led by the interviewer

  interview
    levelhead session              the interviewer picks the topics and asks; you answer
        --role <id>             the job you are practising for, default sde_generalist (see: roles)
        --rounds <a,b>          cs_fundamentals,problem_solving,role_knowledge,system_design,behavioral
                                (default: the role's first round)
        --topics <id,id>        ask these topics instead of letting the interviewer pick (see: topics)
        --level <junior|mid|senior|staff>   default: the role's level
        --persona <collaborator|skeptic|bar_raiser|rusher>
        --mode <simulation|coach|drill|transfer|review>
        --format <id>           use a published-guidance format preset
        --turns <n>             turns per round, default 6
        --pressure <0-3>        your own ceiling on pressure
        --no-drill              skip the drill after the first gap
    levelhead topics [--role <id>] [--area <area>]
                                what the interviewer can ask about
    levelhead transfer [--gap <id>]  retest a drilled gap under changed constraints
    levelhead next [--horizon <d>]   what is due, and the rounds that would cover it

  résumé & projects
    levelhead claims <resume.md>   what an interviewer will pick from your résumé; confirm each
    levelhead repo [<path>]        pin a project repository to a commit, or show the current pin
    levelhead session --rounds code_walkthrough
                                walk me through this project: real files, real functions
    levelhead session --rounds project_deep_dive,design_extension [--claim <id>]
                                cross-question your confirmed résumé claims
    levelhead resume               résumé feedback per line: what held, what is vague, what no code backs
    levelhead mirror --resume <file> --job <file>
                                what a keyword screen would extract — never a judgment, no score

  evidence
    levelhead ledger               the gap ledger, across every session
    levelhead review               compare attempts over time, in evidence
    levelhead replay [sessionId]   replay a session and re-check its citations
    levelhead delivery --session <id> [--from <turn.json>]
                                pace, pauses and filler words — never part of a judgment
    levelhead debrief --session <id> both lanes side by side, what you know and how you came across
    levelhead trend                two series over your sessions, never merged into one number

  measurement
    levelhead label [--out <file>]   label your own findings, to measure agreement against
    levelhead calibrate [--labels <file>]
                                agreement and calibration from the labels that exist

  your data
    levelhead export [--out <file>]  everything Levelhead holds about you
    levelhead forget [--expired]     delete the pinned snapshot; its citations survive as a tombstone

  the machine
    levelhead roles                role packs, the areas they draw on, and whether any has been measured
    levelhead formats              interview format presets and what they are derived from
    levelhead policy               the action set, personas and rubric the policy runs on
    levelhead jobs [--enqueue <kind>]  the durable job table
    levelhead import [--from <dir>]  copy the file event log into Postgres
    levelhead doctor               check the local setup
`

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv
  switch (command) {
    case 'session':
      return session(rest)
    case 'topics':
      return topics(rest)
    case 'claims':
      return claims(rest)
    case 'resume':
      return resume()
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
    case 'debrief':
      return debrief(rest)
    case 'trend':
      return trend()
    case 'mirror':
      return mirror(rest)
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
