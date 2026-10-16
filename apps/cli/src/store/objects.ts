import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Buffer } from 'node:buffer'
import type { ObjectStorePort, StoredObject } from '@levelhead/core'

// ADR-017: the domain talks to an object store, the deployment decides what backs it. This is the
// development adapter — the local filesystem, rooted at one directory. Swapping in S3-compatible
// storage later changes this file and nothing above it.
export class LocalObjectStore implements ObjectStorePort {
  readonly #root: string

  constructor(root: string) {
    this.#root = resolve(root)
  }

  async put(key: string, content: string): Promise<StoredObject> {
    const path = this.#pathFor(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
    return {
      key,
      bytes: Buffer.byteLength(content, 'utf8'),
      contentHash: createHash('sha256').update(content).digest('hex'),
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(this.#pathFor(key), 'utf8')
    } catch {
      return null
    }
  }

  async remove(prefix: string): Promise<number> {
    const keys = await this.list(prefix)
    for (const key of keys) await rm(this.#pathFor(key), { force: true })
    return keys.length
  }

  async list(prefix: string): Promise<string[]> {
    const found: string[] = []
    const walk = async (directory: string): Promise<void> => {
      let entries: string[]
      try {
        entries = await readdir(directory)
      } catch {
        return
      }
      for (const entry of entries) {
        const path = join(directory, entry)
        if ((await stat(path)).isDirectory()) await walk(path)
        else {
          const key = relative(this.#root, path).split(sep).join('/')
          if (key.startsWith(prefix)) found.push(key)
        }
      }
    }
    await walk(this.#root)
    return found.sort()
  }

  // A key is a path fragment supplied by a caller, so it is resolved and then checked to still be
  // inside the root — `..` in a key must not become a write outside the store.
  #pathFor(key: string): string {
    const path = resolve(this.#root, key)
    if (path !== this.#root && !path.startsWith(this.#root + sep)) {
      throw new Error(`object key ${JSON.stringify(key)} escapes the object store root`)
    }
    return path
  }
}
