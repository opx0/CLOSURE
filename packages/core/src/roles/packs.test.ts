import { expect, test } from 'bun:test'
import { ROLE_PACKS, expectedConceptsFor, rolePack, validationNotice } from './packs.ts'

test('every pack covers every competency the rubric judges', () => {
  for (const pack of ROLE_PACKS) {
    expect(pack.competencies).toEqual(['mechanism', 'trade_offs', 'failure_modes', 'composure'])
    for (const competency of pack.competencies) {
      expect(expectedConceptsFor(pack.id, competency).length).toBeGreaterThan(0)
    }
  }
})

// A role nobody has measured must say so. Promoting one to `measured` without a labelled set and an
// agreement interval would be exactly the unmeasured claim this project refuses to make.
test('no shipped role claims to be measured, and each says so out loud', () => {
  for (const pack of ROLE_PACKS) {
    expect(pack.validation).toBe('unvalidated')
    expect(validationNotice(pack.id)).toContain('no agreement has been measured')
  }
})

test('an unknown role is an absence, not a silent default', () => {
  expect(rolePack('does_not_exist')).toBeUndefined()
  expect(validationNotice('does_not_exist')).toContain('no role pack')
  expect(expectedConceptsFor('does_not_exist', 'mechanism')).toEqual([])
})
