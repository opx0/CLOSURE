import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalObjectStore } from './objects.ts'

async function withStore(run: (store: LocalObjectStore, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'closer-objects-'))
  try {
    await run(new LocalObjectStore(root), root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('an object round-trips with its size and content hash', async () => {
  await withStore(async (store) => {
    const written = await store.put('local/bundle.json', '{"a":1}\n')

    expect(written.bytes).toBe(8)
    expect(written.contentHash).toHaveLength(64)
    expect(await store.get('local/bundle.json')).toBe('{"a":1}\n')
  })
})

test('a missing object is null rather than a throw', async () => {
  await withStore(async (store) => {
    expect(await store.get('nothing/here.json')).toBeNull()
  })
})

test('listing and removal are scoped to a prefix', async () => {
  await withStore(async (store) => {
    await store.put('alice/one.json', 'a')
    await store.put('alice/two.json', 'b')
    await store.put('bob/one.json', 'c')

    expect(await store.list('alice/')).toEqual(['alice/one.json', 'alice/two.json'])
    expect(await store.remove('alice/')).toBe(2)
    expect(await store.list('')).toEqual(['bob/one.json'])
  })
})

// A key is a caller-supplied path fragment. Resolving it and then checking it is still inside the
// root is what stops `..` from becoming a write somewhere else on the disk.
test('a key that escapes the root is refused', async () => {
  await withStore(async (store) => {
    await expect(store.put('../escaped.json', 'x')).rejects.toThrow(/escapes the object store root/)
  })
})
