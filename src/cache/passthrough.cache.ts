import { IProjectionCache } from './projection-cache.interface'

export class PassThroughCache<TKey, TProjection>
  implements IProjectionCache<TKey, TProjection> {
  add(key: TKey, value: TProjection): void {}

  clear(): void {}

  remove(key: TKey): void {}

  get(
    key: TKey,
    create: () => Promise<TProjection | undefined>,
  ): Promise<TProjection | undefined> {
    return create()
  }
}
