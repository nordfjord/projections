import { IEntityEventMapBuilder } from '../../event-map-builder'
import { IEventMap } from '../../event-map'
import { Action, Predicate } from '../../projector-map'
import { ITypeOrmChildProjector, TypeOrmContext } from './interfaces'
import { Type } from '../../type'
import { IProjectionCache } from '../../cache/projection-cache.interface'
import { PassThroughCache } from '../../cache/passthrough.cache'

export class TypeOrmEventMapConfigurator<TProjection, TKey> {
  private readonly map: IEventMap<TypeOrmContext>
  private _cache: IProjectionCache<TKey, TProjection> = new PassThroughCache()

  constructor(
    private readonly Projection: Type<TProjection>,
    mapBuilder: IEntityEventMapBuilder<TProjection, TKey, TypeOrmContext>,
    private readonly setKey: (projection: TProjection, key: TKey) => void,
    private readonly childProjectors: ITypeOrmChildProjector[],
  ) {
    this.map = this.buildMap(mapBuilder)
  }

  public get cache() {
    return this._cache
  }

  public set cache(cache: IProjectionCache<TKey, TProjection>) {
    this._cache = cache
  }

  private buildMap(
    builder: IEntityEventMapBuilder<TProjection, TKey, TypeOrmContext>,
  ) {
    return builder.build(this)
  }

  async custom(ctx: TypeOrmContext, projector: () => Promise<void>) {
    return projector()
  }

  async create(
    key: TKey,
    context: TypeOrmContext,
    projector: Action<TProjection>,
    shouldOverwrite: Predicate<TProjection>,
  ) {
    const repo = context.getRepository(this.Projection)
    let projection = await this.cache.get(key, () => repo.findOne(key))
    if (projection == null || shouldOverwrite(projection)) {
      if (projection == null) {
        projection = repo.create()
        this.setKey(projection, key)
        await projector(projection)
      } else {
        await projector(projection)
      }
      await repo.save(projection)
      this.cache.add(key, projection)
    }
  }

  async update(
    key: TKey,
    context: TypeOrmContext,
    projector: Action<TProjection>,
    createIfMissing: () => boolean,
  ): Promise<void> {
    const repo = await context.getRepository(this.Projection)
    let projection = await this.cache.get(key, () => repo.findOne(key))
    if (projection == null && createIfMissing()) {
      projection = repo.create()
      this.setKey(projection, key)
    }

    if (projection != null) {
      await projector(projection)
      await repo.save(projection)
      this.cache.add(key, projection)
    }
  }

  async delete(key: TKey, context: TypeOrmContext) {
    const repo = context.getRepository(this.Projection)
    const results = await repo.delete(key)
    this.cache.remove(key)
    return (results.affected ?? 0) > 0
  }

  async projectEvent(event: any, context: TypeOrmContext) {
    for (const projector of this.childProjectors) {
      await projector.projectEvent(event, context)
    }
    await this.map.handle(event, context)
  }
}
