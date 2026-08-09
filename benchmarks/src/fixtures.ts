import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  FixtureAnswer,
  FixtureChunk,
  FixtureItem,
  FixtureResume,
  FixtureSet,
} from './contract.ts'

// One file, not a tree: the fixture set is the unit that gets an id and a version.
export const FIXTURE_FILE = 'fixtures.json'

export interface LoadedFixtures {
  fixtures: FixtureSet | null
  // Listed rather than thrown one at a time - a human assembling this set wants every complaint at once.
  errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAnswers(raw: unknown, where: string, errors: string[]): FixtureAnswer[] {
  if (!Array.isArray(raw)) {
    errors.push(`${where}: answers must be an array`)
    return []
  }
  return raw.flatMap((entry, at) => {
    if (!isRecord(entry) || typeof entry['text'] !== 'string') {
      errors.push(`${where}.answers[${at}]: needs a text string`)
      return []
    }
    return [
      {
        text: entry['text'],
        // Defaults to false: a fixture author opts in to the seeded set rather than out of it.
        insufficientEvidence: entry['insufficientEvidence'] === true,
      },
    ]
  })
}

function readChunks(raw: unknown, where: string, errors: string[]): FixtureChunk[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    errors.push(`${where}: repoChunks must be an array`)
    return []
  }
  return raw.flatMap((entry, at) => {
    if (
      !isRecord(entry) ||
      typeof entry['path'] !== 'string' ||
      typeof entry['text'] !== 'string'
    ) {
      errors.push(`${where}.repoChunks[${at}]: needs path and text strings`)
      return []
    }
    return [{ path: entry['path'], text: entry['text'] }]
  })
}

function readItem(
  raw: unknown,
  at: number,
  resumeIds: Set<string>,
  errors: string[],
): FixtureItem[] {
  const where = `items[${at}]`
  if (!isRecord(raw)) {
    errors.push(`${where}: expected an object`)
    return []
  }
  const id = raw['id']
  const resumeId = raw['resumeId']
  const claim = raw['claim']
  if (typeof id !== 'string' || typeof resumeId !== 'string') {
    errors.push(`${where}: needs id and resumeId strings`)
    return []
  }
  if (!resumeIds.has(resumeId)) {
    errors.push(`${where}: resumeId ${resumeId} is not in this set`)
    return []
  }
  if (
    !isRecord(claim) ||
    typeof claim['quote'] !== 'string' ||
    typeof claim['type'] !== 'string' ||
    typeof claim['assertion'] !== 'string'
  ) {
    errors.push(`${where}.claim: needs quote, type and assertion`)
    return []
  }

  const injection = raw['injection']
  return [
    {
      id,
      resumeId,
      claim: {
        quote: claim['quote'],
        type: claim['type'] as FixtureItem['claim']['type'],
        assertion: claim['assertion'],
        technologies: Array.isArray(claim['technologies'])
          ? claim['technologies'].filter((one): one is string => typeof one === 'string')
          : [],
        metrics: Array.isArray(claim['metrics'])
          ? claim['metrics'].filter((one): one is string => typeof one === 'string')
          : [],
      },
      answers: readAnswers(raw['answers'], where, errors),
      repoChunks: readChunks(raw['repoChunks'], where, errors),
      injection:
        isRecord(injection) && typeof injection['canary'] === 'string'
          ? {
              canary: injection['canary'],
              where:
                injection['where'] === 'resume' || injection['where'] === 'repository'
                  ? injection['where']
                  : 'answer',
            }
          : null,
    },
  ]
}

export function parseFixtures(raw: unknown): LoadedFixtures {
  const errors: string[] = []
  if (!isRecord(raw)) return { fixtures: null, errors: ['the fixture file must contain an object'] }

  const id = raw['id']
  const version = raw['version']
  if (typeof id !== 'string' || typeof version !== 'number') {
    errors.push('the fixture set needs a string id and a numeric version')
  }
  if (typeof raw['synthetic'] !== 'boolean') {
    // Required, never inferred - a set that doesn't say whether it's constructed can't be published.
    errors.push('the fixture set must declare `synthetic` explicitly')
  }

  const resumes: FixtureResume[] = Array.isArray(raw['resumes'])
    ? raw['resumes'].flatMap((entry, at) => {
        if (
          !isRecord(entry) ||
          typeof entry['id'] !== 'string' ||
          typeof entry['text'] !== 'string'
        ) {
          errors.push(`resumes[${at}]: needs id and text strings`)
          return []
        }
        return [{ id: entry['id'], text: entry['text'] }]
      })
    : []
  if (resumes.length === 0) errors.push('the fixture set needs at least one resume')

  const resumeIds = new Set(resumes.map((resume) => resume.id))
  const items: FixtureItem[] = Array.isArray(raw['items'])
    ? raw['items'].flatMap((entry, at) => readItem(entry, at, resumeIds, errors))
    : []
  if (items.length === 0) errors.push('the fixture set needs at least one item')

  if (errors.length > 0) return { fixtures: null, errors }
  return {
    fixtures: {
      id: id as string,
      version: version as number,
      synthetic: raw['synthetic'] === true,
      resumes,
      items,
    },
    errors,
  }
}

export async function loadFixtures(dir: string): Promise<LoadedFixtures> {
  try {
    return parseFixtures(JSON.parse(await readFile(join(dir, FIXTURE_FILE), 'utf8')))
  } catch (error) {
    return { fixtures: null, errors: [`${join(dir, FIXTURE_FILE)}: ${String(error)}`] }
  }
}
