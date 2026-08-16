const cache = new Map<string, boolean>()

export async function getFlag(store: Store, key: string): Promise<boolean> {
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const value = await store.read(key)
  cache.set(key, value)
  return value
}

export async function refresh(store: Store, key: string): Promise<void> {
  try {
    cache.set(key, await store.read(key))
  } catch {
    // keep serving what we have
  }
}
