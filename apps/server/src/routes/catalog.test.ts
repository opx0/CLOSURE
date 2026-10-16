import { expect, test } from 'bun:test'
import { AREA_ROUND, TOPICS } from '@levelhead/core'
import { testApi } from '../testing/harness.ts'

interface TopicsBody {
  rounds: unknown[]
  levels: unknown[]
  roles: Record<string, unknown>[]
  topics: Record<string, unknown>[]
}

test('the topic catalog lists every role and topic by what the candidate may know', async () => {
  const { app } = await testApi()

  const response = await app.inject({ method: 'GET', url: '/topics' })
  expect(response.statusCode).toBe(200)
  const body = response.json() as TopicsBody

  expect(body.roles.map((role) => role['id'])).toEqual([
    'sde_generalist',
    'backend_services',
    'frontend',
    'fullstack',
    'applied_ai',
    'data_engineering',
    'platform_reliability',
  ])
  const { topicIds, ...frontend } = body.roles[2] ?? {}
  expect(frontend).toEqual({
    id: 'frontend',
    label: 'Frontend engineer',
    areas: ['web'],
    defaultRounds: ['cs_fundamentals', 'problem_solving', 'role_knowledge', 'behavioral'],
    defaultLevel: 'junior',
  })
  const roleKnowledge = TOPICS.filter((topic) => AREA_ROUND[topic.area] === 'role_knowledge')
  const asked = new Set(topicIds as string[])
  expect(roleKnowledge.filter((topic) => asked.has(topic.id)).map((topic) => topic.area)).toEqual(
    roleKnowledge.filter((topic) => topic.area === 'web').map((topic) => topic.area),
  )
  expect(body.topics.map((topic) => topic['id'])).toEqual(TOPICS.map((topic) => topic.id))
  expect(body.topics[1]).toEqual({
    id: 'os.deadlock',
    area: 'os',
    title: 'Deadlock',
    minLevel: 'junior',
    round: 'cs_fundamentals',
  })
  expect(body.rounds).toEqual([
    { kind: 'cs_fundamentals', subject: 'topic' },
    { kind: 'problem_solving', subject: 'topic' },
    { kind: 'role_knowledge', subject: 'topic' },
    { kind: 'system_design', subject: 'topic' },
    { kind: 'behavioral', subject: 'topic' },
    { kind: 'project_deep_dive', subject: 'claim' },
    { kind: 'design_extension', subject: 'claim' },
    { kind: 'code_walkthrough', subject: 'artifact' },
  ])
  expect(body.levels).toEqual(['junior', 'mid', 'senior', 'staff'])
})

test('the topic catalog never carries the interviewer’s side of the table', async () => {
  const { app } = await testApi()

  const response = await app.inject({ method: 'GET', url: '/topics' })
  const body = response.json() as TopicsBody

  expect([...new Set(body.topics.flatMap((topic) => Object.keys(topic)))]).toEqual([
    'id',
    'area',
    'title',
    'minLevel',
    'round',
  ])
  for (const field of ['falsePremise', 'twist', 'expected', 'ask']) {
    expect(response.body).not.toContain(`"${field}"`)
  }
  const leaked = TOPICS.filter(
    (topic) => response.body.includes(topic.falsePremise) || response.body.includes(topic.twist),
  )
  expect(leaked.map((topic) => topic.id)).toEqual([])
})
