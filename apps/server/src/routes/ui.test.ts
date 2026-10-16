import { expect, test } from 'bun:test'
import { testApi } from '../testing/harness.ts'

async function verdictLine(): Promise<(finding: unknown) => string> {
  const { app } = await testApi()
  const page = (await app.inject({ method: 'GET', url: '/voice' })).body
  const source = /function verdictLine\(finding\) \{[\s\S]*?\n\}/.exec(page)?.[0]
  if (source === undefined) throw new Error('the /voice page has no verdictLine')
  return new Function(`${source}; return verdictLine`)() as (finding: unknown) => string
}

// The page speaks this line aloud, so a declined judgment read as a miss is said to the candidate.
test('the voice page says an abstention is one, never that the answer met no level', async () => {
  const line = await verdictLine()

  expect(
    line({
      kind: 'competency_abstained',
      competency: 'trade_offs',
      abstention: 'insufficient_evidence',
    }),
  ).toBe('trade offs — abstained: insufficient evidence')
  expect(line({ kind: 'competency', competency: 'mechanism', levelMet: null })).toBe(
    'mechanism — met no level',
  )
  expect(line({ kind: 'some_future_kind' })).toBe('some future kind')
})
