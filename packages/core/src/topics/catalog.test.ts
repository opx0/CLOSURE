import { expect, test } from 'bun:test'
import { TopicAreaSchema, TopicSchema } from '@levelhead/contracts'
import { Value } from '@sinclair/typebox/value'
import { TOPICS, topicById } from './index.ts'

const AREAS = TopicAreaSchema.anyOf.map((literal) => literal.const)

test('every topic is a valid topic', () => {
  const invalid = TOPICS.filter((topic) => Value.Errors(TopicSchema, topic).First() !== undefined)

  expect(invalid.map((topic) => topic.id)).toEqual([])
})

test('topic ids are unique and start with their area', () => {
  const ids = TOPICS.map((topic) => topic.id)

  expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
  expect(
    TOPICS.filter((topic) => topic.id.split('.')[0] !== topic.area).map((topic) => topic.id),
  ).toEqual([])
})

test('every area has at least two topics, grouped in area order', () => {
  expect(AREAS.filter((area) => TOPICS.filter((topic) => topic.area === area).length < 2)).toEqual(
    [],
  )
  expect([...new Set(TOPICS.map((topic) => topic.area))]).toEqual(AREAS)
})

test('every topic names two to four expected concepts per competency', () => {
  const offBar = TOPICS.filter((topic) =>
    Object.values(topic.expected).some((concepts) => concepts.length < 2 || concepts.length > 4),
  )

  expect(offBar.map((topic) => topic.id)).toEqual([])
})

test('a topic is found by its id, and an unknown id is an absence', () => {
  expect(topicById('dbms.indexes')?.title).toBe('Database indexes')
  expect(topicById('dbms.does_not_exist')).toBeUndefined()
})
