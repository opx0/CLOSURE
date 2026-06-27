import { expect, test } from 'bun:test'
import { INTERVIEW_FORMATS, interviewFormat, planFromFormat } from './presets.ts'

test('every preset cites the published guidance it is derived from', () => {
  for (const format of INTERVIEW_FORMATS) {
    expect(format.derivedFrom.length).toBeGreaterThan(0)
    for (const source of format.derivedFrom) {
      expect(source.url.startsWith('https://')).toBe(true)
      expect(source.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  }
})

// A format preset must never read as a company's real loop. The disclaimer is on every one of them
// because a missing one is the only way this becomes a false claim about someone else's process.
test('every preset disclaims affiliation and reproduction', () => {
  for (const format of INTERVIEW_FORMATS) {
    expect(format.disclaimer).toContain('Not affiliated')
    expect(format.disclaimer).toContain('reproduction')
  }
})

test('a plan takes the widest of the rounds it contains, so no round is silently truncated', () => {
  const format = interviewFormat('ownership_and_depth')
  expect(format).toBeDefined()
  const plan = planFromFormat(format as NonNullable<typeof format>)

  expect(plan.rounds).toEqual(['behavioral', 'project_deep_dive', 'design_extension'])
  expect(plan.turnsPerRound).toBe(6)
  expect(plan.pressureCeiling).toBe(2)
  expect(plan.personaId).toBe('skeptic')
})
