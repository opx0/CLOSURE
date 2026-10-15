import { expect, test } from 'bun:test'
import { resolveInterview } from './interview.ts'

test('with nothing named, an interview is the role’s first round and needs no résumé', () => {
  expect(resolveInterview({ roleId: 'frontend' })).toEqual({
    ok: true,
    rounds: ['cs_fundamentals'],
    needsClaims: false,
    readsClaims: false,
    needsSnapshot: false,
  })
})

test('named topics choose their own rounds, and a topic outside the named rounds is refused', () => {
  const resolved = resolveInterview({
    roleId: 'sde_generalist',
    topicIds: ['dsa.hash_maps', 'os.deadlock'],
  })
  expect(resolved.ok && resolved.rounds).toEqual(['cs_fundamentals', 'problem_solving'])
  expect(resolved.ok && resolved.topics?.map((topic) => topic.id)).toEqual([
    'dsa.hash_maps',
    'os.deadlock',
  ])

  expect(
    resolveInterview({ roleId: 'sde_generalist', topicIds: ['os.deadlock', 'os.nope'] }),
  ).toEqual({ ok: false, problem: 'unknown_topics', topicIds: ['os.nope'] })

  const stray = resolveInterview({
    roleId: 'sde_generalist',
    rounds: ['behavioral'],
    topicIds: ['os.deadlock'],
  })
  expect(stray.ok === false && stray.problem === 'stray_topics' && stray.topics[0]?.id).toBe(
    'os.deadlock',
  )
})

test('résumé rounds need confirmed claims; a walkthrough reads them and needs a pinned project', () => {
  const deepDive = resolveInterview({ roleId: 'sde_generalist', rounds: ['project_deep_dive'] })
  const walkthrough = resolveInterview({ roleId: 'sde_generalist', rounds: ['code_walkthrough'] })
  const mixed = resolveInterview({
    roleId: 'sde_generalist',
    rounds: ['behavioral', 'code_walkthrough'],
  })

  const needs = (resolved: ReturnType<typeof resolveInterview>) =>
    resolved.ok ? [resolved.needsClaims, resolved.readsClaims, resolved.needsSnapshot] : null
  expect(needs(deepDive)).toEqual([true, true, false])
  expect(needs(walkthrough)).toEqual([false, true, true])
  expect(needs(mixed)).toEqual([false, true, true])
})
