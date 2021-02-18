/**
 MIT License

 Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

 Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

export interface QuickLruOptions<TKey, TValue> {
  /**
   The maximum number of milliseconds an item should remain in the cache.
   @default Infinity
   By default, `maxAge` will be `Infinity`, which means that items will never expire.
   Lazy expiration upon the next write or read call.
   Individual expiration of an item can be specified by the `set(key, value, maxAge)` method.
   */
  readonly maxAge?: number

  /**
   The maximum number of items before evicting the least recently used items.
   */
  readonly maxSize: number

  /**
   Called right before an item is evicted from the cache.
   Useful for side effects or for items like object URLs that need explicit cleanup (`revokeObjectURL`).
   */
  onEviction?: (key: TKey, value: TValue) => void
}

export class QuickLRU<TKey, TValue> {
  private maxSize: number
  private maxAge: number
  private readonly onEviction: QuickLruOptions<TKey, TValue>['onEviction']
  private cache: Map<TKey, CacheItem<TValue>>
  private oldCache: Map<TKey, CacheItem<TValue>>
  private _size: number

  constructor(options: QuickLruOptions<TKey, TValue>) {
    if (options.maxSize <= 0) {
      throw new TypeError('`maxSize` must be a number greater than 0')
    }

    if (options.maxAge === 0) {
      throw new TypeError('`maxAge` must be a number greater than 0')
    }

    // TODO: Use private class fields when ESLint supports them.
    this.maxSize = options.maxSize
    this.maxAge = options.maxAge || Number.POSITIVE_INFINITY
    this.onEviction = options.onEviction
    this.cache = new Map()
    this.oldCache = new Map()
    this._size = 0
  }

  // TODO: Use private class methods when targeting Node.js 16.
  private _emitEvictions(cache: Iterable<[TKey, CacheItem<TValue>]>) {
    if (typeof this.onEviction !== 'function') {
      return
    }

    for (const [key, item] of cache) {
      this.onEviction(key, item.value)
    }
  }

  private _deleteIfExpired(key: TKey, item: CacheItem<TValue>) {
    if (typeof item.expiry === 'number' && item.expiry <= Date.now()) {
      if (typeof this.onEviction === 'function') {
        this.onEviction(key, item.value)
      }

      return this.delete(key)
    }

    return false
  }

  private _getOrDeleteIfExpired(key: TKey, item: CacheItem<TValue>) {
    const deleted = this._deleteIfExpired(key, item)
    if (!deleted) {
      return item.value
    }
  }

  private _getItemValue(key: TKey, item: CacheItem<TValue>) {
    return item.expiry ? this._getOrDeleteIfExpired(key, item) : item.value
  }

  private _peek(key: TKey, cache: Map<TKey, CacheItem<TValue>>) {
    const item = cache.get(key)!

    return this._getItemValue(key, item)
  }

  private _set(key: TKey, value: CacheItem<TValue>) {
    this.cache.set(key, value)
    this._size++

    if (this._size >= this.maxSize) {
      this._size = 0
      this._emitEvictions(this.oldCache)
      this.oldCache = this.cache
      this.cache = new Map()
    }
  }

  private _moveToRecent(key: TKey, item: CacheItem<TValue>) {
    this.oldCache.delete(key)
    this._set(key, item)
  }

  private *_entriesAscending() {
    for (const item of this.oldCache) {
      const [key, value] = item
      if (!this.cache.has(key)) {
        const deleted = this._deleteIfExpired(key, value)
        if (!deleted) {
          yield item
        }
      }
    }

    for (const item of this.cache) {
      const [key, value] = item
      const deleted = this._deleteIfExpired(key, value)
      if (!deleted) {
        yield item
      }
    }
  }

  get(key: TKey) {
    if (this.cache.has(key)) {
      const item = this.cache.get(key)!

      return this._getItemValue(key, item)
    }

    if (this.oldCache.has(key)) {
      const item = this.oldCache.get(key)!
      if (!this._deleteIfExpired(key, item)) {
        this._moveToRecent(key, item)
        return item.value
      }
    }
  }

  set(
    key: TKey,
    value: TValue,
    {
      maxAge = this.maxAge === Number.POSITIVE_INFINITY
        ? undefined
        : Date.now() + this.maxAge,
    } = {},
  ) {
    if (this.cache.has(key)) {
      this.cache.set(key, {
        value,
        maxAge,
      })
    } else {
      this._set(key, { value, expiry: maxAge })
    }
  }

  has(key: TKey) {
    if (this.cache.has(key)) {
      return !this._deleteIfExpired(key, this.cache.get(key)!)
    }

    if (this.oldCache.has(key)) {
      return !this._deleteIfExpired(key, this.oldCache.get(key)!)
    }

    return false
  }

  peek(key: TKey) {
    if (this.cache.has(key)) {
      return this._peek(key, this.cache)
    }

    if (this.oldCache.has(key)) {
      return this._peek(key, this.oldCache)
    }
  }

  delete(key: TKey) {
    const deleted = this.cache.delete(key)
    if (deleted) {
      this._size--
    }

    return this.oldCache.delete(key) || deleted
  }

  clear() {
    this.cache.clear()
    this.oldCache.clear()
    this._size = 0
  }

  resize(newSize: number) {
    if (!(newSize && newSize > 0)) {
      throw new TypeError('`maxSize` must be a number greater than 0')
    }

    const items = [...this._entriesAscending()]
    const removeCount = items.length - newSize
    if (removeCount < 0) {
      this.cache = new Map(items)
      this.oldCache = new Map()
      this._size = items.length
    } else {
      if (removeCount > 0) {
        this._emitEvictions(items.slice(0, removeCount))
      }

      this.oldCache = new Map(items.slice(removeCount))
      this.cache = new Map()
      this._size = 0
    }

    this.maxSize = newSize
  }

  *keys() {
    for (const [key] of this) {
      yield key
    }
  }

  *values() {
    for (const [, value] of this) {
      yield value
    }
  }

  *[Symbol.iterator]() {
    for (const item of this.cache) {
      const [key, value] = item
      const deleted = this._deleteIfExpired(key, value)
      if (!deleted) {
        yield [key, value.value]
      }
    }

    for (const item of this.oldCache) {
      const [key, value] = item
      if (!this.cache.has(key)) {
        const deleted = this._deleteIfExpired(key, value)
        if (!deleted) {
          yield [key, value.value]
        }
      }
    }
  }

  *entriesDescending() {
    let items = [...this.cache]
    for (let i = items.length - 1; i >= 0; --i) {
      const item = items[i]
      const [key, value] = item
      const deleted = this._deleteIfExpired(key, value)
      if (deleted) {
        yield [key, value.value]
      }
    }

    items = [...this.oldCache]
    for (let i = items.length - 1; i >= 0; --i) {
      const item = items[i]
      const [key, value] = item
      if (!this.cache.has(key)) {
        const deleted = this._deleteIfExpired(key, value)
        if (!deleted) {
          yield [key, value.value]
        }
      }
    }
  }

  *entriesAscending() {
    for (const [key, value] of this._entriesAscending()) {
      yield [key, value.value]
    }
  }

  get size() {
    if (!this._size) {
      return this.oldCache.size
    }

    let oldCacheSize = 0
    for (const key of this.oldCache.keys()) {
      if (!this.cache.has(key)) {
        oldCacheSize++
      }
    }

    return Math.min(this._size + oldCacheSize, this.maxSize)
  }
}

interface CacheItem<T> {
  expiry?: number
  maxAge?: number
  value: T
}
