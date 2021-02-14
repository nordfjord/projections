import { ITypeOrmChildProjector, TypeOrmContext } from './interfaces'
import { TypeOrmEventMapConfigurator } from './eventMapConfigurator'
import { IEntityEventMapBuilder } from '../../event-map-builder'
import { Type } from '../../type'
import { ProjectionException } from '../common'

export class TypeOrmChildProjector<TProjection, TKey>
  implements ITypeOrmChildProjector {
  private readonly mapConfigurator: TypeOrmEventMapConfigurator<
    TProjection,
    TKey
  >

  constructor(
    private readonly Projection: Type<TProjection>,
    mapBuilder: IEntityEventMapBuilder<TProjection, TKey, TypeOrmContext>,
    setKey: (projection: TProjection, key: TKey) => void,
    ...children: ITypeOrmChildProjector[]
  ) {
    this.mapConfigurator = new TypeOrmEventMapConfigurator<TProjection, TKey>(
      Projection,
      mapBuilder,
      setKey,
      children,
    )
  }

  async projectEvent(event: any, context: TypeOrmContext): Promise<void> {
    try {
      await this.mapConfigurator.projectEvent(event, context)
    } catch (err) {
      if (err instanceof ProjectionException) {
        err.childProjector = this.Projection.name
        throw err
      }
      const exception = new ProjectionException(
        'Projector failed to project an event',
        err,
      )
      exception.childProjector = this.Projection.name
    }
  }
}
