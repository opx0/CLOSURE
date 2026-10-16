import { assembleResumeFeedback, replay } from '@levelhead/core'
import type { ResumeTagKind } from '@levelhead/contracts'
import { openStore } from '../store.ts'
import { loadCliConfig } from '../config.ts'
import { dim, heading, line } from '../terminal.ts'
import { CLAIM_SET_SESSION } from './claims.ts'
import { REPO_SESSION } from './repo.ts'

const TAG_LABEL: Record<ResumeTagKind, string> = {
  implied_unconfirmed: 'implied, not confirmed',
  no_metric: 'no number',
  linked_code: 'files that share its words',
  no_code_evidence: 'no code behind it',
  code_not_checked: 'not checked against code',
  held: 'held',
  partially_supported: 'partially supported',
  contradicted: 'contradicted',
  open_gap: 'open gap',
}

export async function resume(): Promise<number> {
  const config = loadCliConfig()
  const { store, close } = openStore(config)

  try {
    const feedback = await assembleResumeFeedback(store, {
      claimSet: CLAIM_SET_SESSION,
      repo: REPO_SESSION,
    })
    if (feedback.lines.length === 0) {
      line('no résumé read yet — run: levelhead claims <resume.md>')
      return 0
    }
    const claims = replay(await store.read(CLAIM_SET_SESSION)).claims

    heading('résumé feedback, line by line')
    for (const entry of feedback.lines) {
      line('')
      line(entry.text)
      for (const claimId of entry.claimIds) {
        if (entry.claimIds.length > 1) dim(`  ${claims.get(claimId)?.assertion ?? claimId}`)
        for (const tag of entry.tags.filter((candidate) => candidate.claimId === claimId)) {
          line(`  ${TAG_LABEL[tag.kind]}`)
          dim(`    ${tag.advice}`)
          for (const said of tag.quotes) dim(`    │ ${said.replaceAll('\n', '\n    │ ')}`)
          for (const path of tag.artifactPaths) dim(`    ${path}`)
        }
      }
    }
    return 0
  } finally {
    await close()
  }
}
