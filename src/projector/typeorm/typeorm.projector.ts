import { IEntityEventMapBuilder } from '../../event-map-builder'
import { ITypeOrmChildProjector, TypeOrmContext } from './interfaces'
import { TypeOrmEventMapConfigurator } from './eventMapConfigurator'
import { Type } from '../../type'
import { Repository } from 'typeorm'
import { ProjectionState } from './ProjectionState'
import { ProjectionException, ShouldRetry } from '../common'
import { EventEnvelope } from '../../interfaces'

export class TypeOrmProjector<TProjection, TKey> {
  private readonly mapConfigurator: TypeOrmEventMapConfigurator<
    TProjection,
    TKey
  >
  private readonly children: ITypeOrmChildProjector[]
  public shouldRetry: ShouldRetry = () => Promise.resolve(false)

  constructor(
    private readonly Projection: Type<TProjection>,
    private readonly repositoryFactory: <T>(Entity: Type<T>) => Repository<T>,
    mapBuilder: IEntityEventMapBuilder<TProjection, TKey, TypeOrmContext>,
    setKey: (projection: TProjection, key: TKey) => void,
    ...children: ITypeOrmChildProjector[]
  ) {
    this.mapConfigurator = new TypeOrmEventMapConfigurator(
      Projection,
      mapBuilder,
      setKey,
      children,
    )
    this.children = children
  }

  public async handle(events: EventEnvelope[]) {
    if (events.length === 0) return
    const lastPosition = await this.getLastPosition()
    const eventsToHandle = events.filter((e) => e.position > lastPosition)

    await this.executeWithRetry(() => this.projectEventBatch(eventsToHandle))

    const stateRepo = await this.repositoryFactory(ProjectionState)
    await stateRepo.save({
      position: events[events.length - 1].position,
      lastUpdateUtc: new Date(),
      id: this.Projection.name,
    })
  }

  private async executeWithRetry(action: () => Promise<void>) {
    let i = 1
    while (true) {
      try {
        await action()
        break
      } catch (err) {
        if (!(err instanceof ProjectionException)) throw err
        if (!(await this.shouldRetry(err, i))) {
          throw err
        }
        ++i
      }
    }
  }

  private async projectEventBatch(events: EventEnvelope[]) {
    for (const envelope of events) {
      try {
        await this.projectEvent(envelope.body, {
          getRepository: this.repositoryFactory,
        })
      } catch (err) {
        const exception =
          err instanceof ProjectionException
            ? err
            : new ProjectionException(
                'Projector failed to project an event.',
                err,
              )
        exception.currentEvent = envelope
        exception.eventBatch = events
        throw exception
      }
    }
  }

  private async projectEvent(event: any, context: TypeOrmContext) {
    for (const projector of this.children) {
      await projector.projectEvent(event, context)
    }

    await this.mapConfigurator.projectEvent(event, context)
  }

  public async getLastPosition() {
    const stateRepo = await this.repositoryFactory(ProjectionState)
    const state = await stateRepo.findOne(this.Projection.name)
    return state?.position ?? -1n
  }
}
