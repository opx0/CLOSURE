import { expect, test } from 'bun:test'
import {
  DEFAULT_ROLE_ID,
  ROLE_PACKS,
  expectedConceptsFor,
  roleAreas,
  rolePack,
  roleRounds,
  validationNotice,
} from './packs.ts'

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

test('roles read the way a student would pick one, each with the areas its role round asks about', () => {
  expect(ROLE_PACKS.map((pack) => [pack.id, pack.label, pack.areas])).toEqual([
    ['sde_generalist', 'Software engineer (general SDE)', ['backend', 'web']],
    ['backend_services', 'Backend engineer', ['backend']],
    ['frontend', 'Frontend engineer', ['web']],
    ['fullstack', 'Full-stack engineer', ['web', 'backend']],
    ['applied_ai', 'ML / AI engineer', ['ml', 'data']],
    ['data_engineering', 'Data engineer', ['data']],
    ['platform_reliability', 'DevOps / cloud / SRE', ['devops', 'backend']],
  ])
})

test('every role starts an interview without a résumé or a repository', () => {
  const resumeRounds = ['project_deep_dive', 'design_extension', 'code_walkthrough']
  const needsResume = ROLE_PACKS.filter((pack) =>
    pack.defaultRounds.some((round) => resumeRounds.includes(round)),
  )

  expect(needsResume.map((pack) => pack.id)).toEqual([])
  expect(roleRounds('frontend')).toEqual([
    'cs_fundamentals',
    'problem_solving',
    'role_knowledge',
    'behavioral',
  ])
})

test('the general software engineer is the default role and the fallback for an unknown one', () => {
  expect(DEFAULT_ROLE_ID).toBe('sde_generalist')
  expect(roleAreas('does_not_exist')).toEqual(['backend', 'web'])
  expect(roleRounds('does_not_exist')).toEqual(roleRounds('sde_generalist'))
})
