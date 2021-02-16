export interface IProjectionCache<TKey, TProjection> {
  add(key: TKey, value: TProjection): void

  get(
    key: TKey,
    create: () => Promise<TProjection | undefined>,
  ): Promise<TProjection | undefined>

  remove(key: TKey): void

  clear(): void
}
