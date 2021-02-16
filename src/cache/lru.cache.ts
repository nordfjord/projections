import { IProjectionCache } from './projection-cache.interface'
import QuickLRU from 'quick-lru'

interface LruOptions {
  capacity: number
  retention: number
}

export class LruCache<TKey, TProjection>
  implements IProjectionCache<TKey, TProjection> {
  private readonly cache: QuickLRU<TKey, TProjection>

  constructor(options: LruOptions) {
    this.cache = new QuickLRU<TKey, TProjection>({
      maxSize: options.capacity,
      maxAge: options.retention,
    })
  }

  add(key: TKey, value: TProjection): void {
    this.cache.set(key, value)
  }

  clear(): void {
    this.cache.clear()
  }

  async get(
    key: TKey,
    create: () => Promise<TProjection | undefined>,
  ): Promise<TProjection | undefined> {
    if (this.cache.has(key)) return this.cache.get(key)!
    const value = await create()
    if (value == null) return
    this.cache.set(key, value)
    return value
  }

  remove(key: TKey): void {
    this.cache.delete(key)
  }
}
