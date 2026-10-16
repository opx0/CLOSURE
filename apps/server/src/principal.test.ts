import { expect, test } from 'bun:test'
import { LOCAL_OWNER_ID } from '@levelhead/contracts'
import { Principals, parseTokens } from './principal.ts'

test('with no tokens configured the server is single-owner and local', () => {
  const principals = new Principals('')

  expect(principals.open).toBe(true)
  expect(principals.resolve(undefined)?.ownerId).toBe(LOCAL_OWNER_ID)
})

// A showcase instance is deployed with no tokens and open to the internet; the local operator's
// reach (pinning a path on the server's disk) must not come with an empty Authorization header.
test('a showcase instance with no tokens configured makes every caller a visitor', () => {
  const principals = new Principals('', { showcase: true })

  expect(principals.resolve(undefined)?.role).toBe('showcase')
  expect(principals.resolve('Bearer anything')?.role).toBe('showcase')
})

// An unrecognised token must be nobody. Falling back to the local owner would hand a stranger the
// developer's own gap ledger.
test('with tokens configured an unrecognised one is nobody, never the local owner', () => {
  const principals = new Principals('abhisek:secret')

  expect(principals.resolve(undefined)).toBeNull()
  expect(principals.resolve('Bearer wrong')).toBeNull()
  expect(principals.resolve('secret')).toBeNull()
  expect(principals.resolve('Bearer secret')?.ownerId).toBe('abhisek')
})

test('a role may be named between the owner and the token', () => {
  const principals = new Principals('friend:candidate:tok, ops:operator:other')

  expect(principals.resolve('Bearer tok')).toEqual({
    ownerId: 'friend',
    role: 'candidate',
    label: 'friend',
  })
  expect(principals.resolve('Bearer other')?.role).toBe('operator')
})

test('a token containing colons survives parsing intact', () => {
  const grants = parseTokens('owner:a:b:c')

  expect(grants).toHaveLength(1)
  expect(new Principals('owner:a:b:c').resolve('Bearer a:b:c')?.ownerId).toBe('owner')
})

test('a malformed entry is refused at boot rather than ignored at request time', () => {
  expect(() => parseTokens('justanowner')).toThrow(/owner:token/)
})
