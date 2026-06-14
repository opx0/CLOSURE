export interface StoredObject {
  key: string
  bytes: number
  contentHash: string
}

export interface ObjectStorePort {
  put(key: string, content: string): Promise<StoredObject>
  get(key: string): Promise<string | null>
  remove(prefix: string): Promise<number>
  list(prefix: string): Promise<string[]>
}
