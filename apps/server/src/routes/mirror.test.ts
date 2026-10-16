import { expect, test } from 'bun:test'
import { MIRROR_BOUNDARY } from '@levelhead/contracts'
import type { ScreenSimulation } from '@levelhead/contracts'
import { EXTRACTION, RESUME, confirmedClaim, testApi } from '../testing/harness.ts'
import type { MemoryEventStore } from '../../../cli/src/testing/fakes.ts'

// The résumé the harness extracts claims from already covers "job queue" and "PostgreSQL"; it says
// nothing about Kubernetes. This posting names all three so coverage has a present and an absent case.
const JOB_DESCRIPTION = `# Backend Engineer

We are hiring an engineer to own our ingestion pipeline.

## Requirements

- Strong experience with PostgreSQL.
- You have built a job queue or a durable work system.
- Familiarity with Kubernetes.
`

async function totalEvents(store: MemoryEventStore): Promise<number> {
  let count = 0
  for (const sessionId of await store.listSessions()) count += (await store.read(sessionId)).length
  return count
}

function coverageFor(simulation: ScreenSimulation, term: string) {
  return simulation.coverage.find((entry) => entry.term === term)
}

test('a job description is screened against the résumé claim set: present, absent, and flags', async () => {
  const { app } = await testApi({ scripted: [EXTRACTION] })
  await confirmedClaim(app)

  const response = await app.inject({
    method: 'POST',
    url: '/mirror',
    payload: { jobDescription: JOB_DESCRIPTION, resumeText: RESUME },
  })
  expect(response.statusCode).toBe(200)
  const simulation = response.json() as ScreenSimulation

  // Terms the résumé backs resolve to the span they were found in; a term it never uses does not.
  expect(coverageFor(simulation, 'postgresql')?.present).toBe(true)
  expect(coverageFor(simulation, 'postgresql')?.spanIds.length).toBeGreaterThan(0)
  expect(coverageFor(simulation, 'job queue')?.present).toBe(true)
  expect(coverageFor(simulation, 'kubernetes')?.present).toBe(false)

  // The absent required term is flagged so the candidate can go and fix it.
  expect(simulation.flags).toContainEqual({ kind: 'required_term_absent', term: 'kubernetes' })
  expect(simulation.boundary).toBe(MIRROR_BOUNDARY)

  // No aggregate: the simulation carries exactly these fields and no match number under any name.
  expect(Object.keys(simulation).sort()).toEqual(
    ['boundary', 'coverage', 'flags', 'jobDescriptionHash'].sort(),
  )
})

test('the mirror writes nothing to any event log and touches no session', async () => {
  const { app, store } = await testApi({ scripted: [EXTRACTION] })
  await confirmedClaim(app)

  const before = await totalEvents(store)
  await app.inject({
    method: 'POST',
    url: '/mirror',
    payload: { jobDescription: JOB_DESCRIPTION, resumeText: RESUME },
  })
  expect(await totalEvents(store)).toBe(before)
})

test('a mirror for a résumé with no extracted claim set still returns a simulation, terms absent', async () => {
  const { app } = await testApi()

  const response = await app.inject({
    method: 'POST',
    url: '/mirror',
    payload: { jobDescription: JOB_DESCRIPTION, resumeText: RESUME },
  })
  expect(response.statusCode).toBe(200)
  const simulation = response.json() as ScreenSimulation

  // Nothing was extracted, so nothing resolves to a span and every required term reads absent.
  expect(simulation.coverage.every((entry) => !entry.present)).toBe(true)
  expect(simulation.flags).toContainEqual({ kind: 'required_term_absent', term: 'kubernetes' })
})
