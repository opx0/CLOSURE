import { expect, test } from 'bun:test'
import { AREA_ROUND, TOPIC_ROUNDS, planTopics, type TopicPlanInput } from './index.ts'

const interview: TopicPlanInput = {
  roleId: 'sde_generalist',
  round: 'cs_fundamentals',
  level: 'junior',
  count: 50,
  seed: 'session-1',
}

function ids(input: TopicPlanInput): string[] {
  return planTopics(input).map((topic) => topic.id)
}

function areas(input: TopicPlanInput): string[] {
  return planTopics(input).map((topic) => topic.area)
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

test('the interview rounds are the rounds topics are asked in, in round order', () => {
  expect(TOPIC_ROUNDS).toEqual([
    'cs_fundamentals',
    'problem_solving',
    'role_knowledge',
    'system_design',
    'behavioral',
  ])
  expect(AREA_ROUND.dbms).toBe('cs_fundamentals')
  expect(AREA_ROUND.dsa).toBe('problem_solving')
  expect(AREA_ROUND.web).toBe('role_knowledge')
})

test('the same session plans the same topics in the same order', () => {
  expect(ids(interview)).toEqual(ids({ ...interview }))
})

test('another session starts the rotation somewhere else', () => {
  expect(ids({ ...interview, seed: 'session-2' })).not.toEqual(ids(interview))
  expect(distinct(ids({ ...interview, seed: 'session-2' }))).toEqual(distinct(ids(interview)))
})

test('topics asked in an earlier session come after every unasked one', () => {
  const planned = ids({ ...interview, askedBefore: ['os.deadlock', 'dbms.indexes'] })

  expect(planned.slice(-2).sort()).toEqual(['dbms.indexes', 'os.deadlock'])
  expect(planned).toHaveLength(ids(interview).length)
})

test('a topic above the session level is not planned', () => {
  const design: TopicPlanInput = { ...interview, round: 'system_design' }

  expect(ids({ ...design, level: 'junior' })).not.toContain('system_design.rate_limiter')
  expect(ids({ ...design, level: 'mid' })).toContain('system_design.rate_limiter')
  for (const round of TOPIC_ROUNDS) {
    const levels = planTopics({ ...interview, round }).map((topic) => topic.minLevel)
    expect(distinct(levels)).toEqual(['junior'])
  }
})

test('the role round draws only from the areas of the chosen role', () => {
  const role = (roleId: string) =>
    distinct(areas({ ...interview, roleId, round: 'role_knowledge', level: 'staff' }))

  expect(role('frontend')).toEqual(['web'])
  expect(role('applied_ai')).toEqual(['data', 'ml'])
  expect(role('platform_reliability')).toEqual(['backend', 'devops'])
  expect(role('fullstack')).toEqual(['backend', 'web'])
})

test('an unknown role falls back to the general software engineer', () => {
  const round: TopicPlanInput = { ...interview, round: 'role_knowledge' }

  expect(ids({ ...round, roleId: 'does_not_exist' })).toEqual(ids(round))
})

test('every other interview round asks the same topics whatever the role', () => {
  for (const round of [
    'cs_fundamentals',
    'problem_solving',
    'system_design',
    'behavioral',
  ] as const) {
    expect(ids({ ...interview, round, roleId: 'frontend' })).toEqual(
      ids({ ...interview, round, roleId: 'applied_ai' }),
    )
  }
  expect(distinct(areas(interview))).toEqual(['dbms', 'networks', 'oop', 'os'])
  expect(distinct(areas({ ...interview, round: 'problem_solving' }))).toEqual(['dsa'])
})

test('areas take turns, so two topics from one area are not back to back', () => {
  expect(distinct(areas({ ...interview, count: 4 }))).toEqual(['dbms', 'networks', 'oop', 'os'])
  expect(
    distinct(areas({ ...interview, roleId: 'fullstack', round: 'role_knowledge', count: 2 })),
  ).toEqual(['backend', 'web'])
})

test('count caps the plan to the head of the full order', () => {
  expect(ids({ ...interview, count: 3 })).toEqual(ids(interview).slice(0, 3))
  expect(ids({ ...interview, count: 0 })).toEqual([])
  expect(ids({ ...interview, count: -1 })).toEqual([])
  expect(new Set(ids(interview)).size).toBe(ids(interview).length)
})

test('an excluded topic is never planned', () => {
  const planned = ids({ ...interview, exclude: ['os.deadlock'] })

  expect(planned).not.toContain('os.deadlock')
  expect(planned).toHaveLength(ids(interview).length - 1)
})

test('a round about a claim or a file plans no topics', () => {
  for (const round of ['project_deep_dive', 'design_extension', 'code_walkthrough'] as const) {
    expect(planTopics({ ...interview, round, level: 'staff' })).toEqual([])
  }
})
