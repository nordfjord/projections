import { EventHandler, EventMap, EventPredicate, IEventMap } from './event-map'
import { Type } from './type'
import {
  EntityProjectorMap,
  IEntityProjectorMap,
  ProjectorMap,
} from './projector-map'

export interface IEventMapBuilder<TContext> {
  build(projector: ProjectorMap<TContext>): IEventMap<TContext>
}

export class EventMapBuilder<TContext> implements IEventMapBuilder<TContext> {
  private readonly eventMap = new EventMap<TContext>()
  private projector: ProjectorMap<TContext>

  public where(filter: EventPredicate<TContext>) {
    this.eventMap.addFilter(filter)
    return this
  }

  public withEventTypeFromEvent(fn: (event: any) => string) {
    this.eventMap.withEventTypeFromEvent(fn)
    return this
  }

  public withEventTypeFromConstructor(fn: (constructor: Type) => string) {
    this.eventMap.withEventTypeFromConstructor(fn)
    return this
  }

  public map<TEvent>(...Events: Type<TEvent>[]) {
    return new Action(
      Events,
      () => this.eventMap,
      () => this.projector,
    )
  }

  public build(projector: ProjectorMap<TContext>): IEventMap<TContext> {
    this.projector = projector
    return this.eventMap
  }
}

export interface IEntityEventMapBuilder<TProjection, TKey, TContext> {
  build(
    projector: EntityProjectorMap<TProjection, TKey, TContext>,
  ): IEventMap<TContext>
}

export class EntityEventMapBuilder<TProjection, TKey, TContext>
  implements IEntityEventMapBuilder<TProjection, TKey, TContext> {
  private readonly eventMapBuilder = new EventMapBuilder<TContext>()
  private projector: EntityProjectorMap<TProjection, TKey, TContext>

  public where(
    predicate: EventPredicate<TContext>,
  ): EntityEventMapBuilder<TProjection, TKey, TContext> {
    this.eventMapBuilder.where(predicate)
    return this
  }

  public withEventTypeFromEvent(fn: (event: any) => string) {
    this.eventMapBuilder.withEventTypeFromEvent(fn)
    return this
  }

  public withEventTypeFromConstructor(fn: (constructor: Type) => string) {
    this.eventMapBuilder.withEventTypeFromConstructor(fn)
    return this
  }

  public map<TEvent>(Event: Type<TEvent>) {
    return new CrudAction(
      Event,
      this.eventMapBuilder.map(Event),
      () => this.projector,
    )
  }

  build(
    projector: IEntityProjectorMap<TProjection, TKey, TContext>,
  ): IEventMap<TContext> {
    this.projector = projector
    return this.eventMapBuilder.build({
      custom: (context, projectEvent) => projectEvent(),
    })
  }
}

interface IAction<TEvent, TContext> {
  as(handler: EventHandler<TContext, TEvent>): void

  when(filter: EventPredicate<TContext, TEvent>): IAction<TEvent, TContext>
}

class Action<TEvent, TContext> implements IAction<TEvent, TContext> {
  private readonly predicates: EventPredicate<TContext, TEvent>[] = []

  constructor(
    private readonly Event: Type<TEvent> | Type<TEvent>[],
    private readonly parent: () => EventMap<TContext>,
    private readonly getProjector: () => ProjectorMap<TContext>,
  ) {}

  when(filter: EventPredicate<TContext, TEvent>): IAction<TEvent, TContext> {
    if (filter == null) {
      throw new Error(`filter is null`)
    }

    this.predicates.push(filter)

    return this
  }

  as(action: EventHandler<TContext, TEvent>): void {
    this.add((event, context) =>
      this.getProjector().custom(
        context,
        async () => await action(event, context),
      ),
    )
  }

  private add(action: EventHandler<TContext, TEvent>) {
    this.parent().add(this.Event, async (event, context) => {
      for (const predicate of this.predicates) {
        if (!(await predicate(event, context))) return
      }

      await action(event, context)
    })
  }
}

type GetKey<TEvent, TContext, TKey> = (event: TEvent, context: TContext) => TKey

class CrudAction<TEvent, TProjection, TKey, TContext> {
  constructor(
    private readonly Event: Type<TEvent>,
    private readonly actionBuilder: Action<TEvent, TContext>,
    private readonly getProjector: () => EntityProjectorMap<
      TProjection,
      TKey,
      TContext
    >,
  ) {}

  public asCreateOf(getKey: GetKey<TEvent, TContext, TKey>) {
    return new CreateAction(
      this.Event,
      getKey,
      this.actionBuilder,
      this.getProjector,
    )
  }

  public asUpdateOf(getKey: GetKey<TEvent, TContext, TKey>) {
    return new UpdateAction(
      this.Event,
      getKey,
      this.actionBuilder,
      this.getProjector,
    )
  }

  public asDeleteOf(getKey: GetKey<TEvent, TContext, TKey>) {
    return new DeleteAction(
      this.Event,
      getKey,
      this.actionBuilder,
      this.getProjector,
    )
  }

  public as(
    action: (event: TEvent, context: TContext) => Promise<void> | void,
  ) {
    this.actionBuilder.as((event, context) =>
      this.getProjector().custom(context, () => action(event, context)),
    )
  }
}

class CreateAction<TEvent, TProjection, TKey, TContext> {
  private shouldOverwrite: (
    projection: TProjection,
    event: TEvent,
    context: TContext,
  ) => boolean = (projection, event, context) => {
    throw new Error(
      `Projection with key ${this.getKey(event, context)} already exists`,
    )
  }

  constructor(
    private readonly Event: Type<TEvent>,
    private readonly getKey: GetKey<TEvent, TContext, TKey>,
    private readonly actionBuilder: Action<TEvent, TContext>,
    private readonly getProjector: () => EntityProjectorMap<
      TProjection,
      TKey,
      TContext
    >,
  ) {}

  public using(
    projector: (
      projection: TProjection,
      event: TEvent,
      context: TContext,
    ) => Promise<void> | void,
  ) {
    this.actionBuilder.as((event, context) =>
      this.getProjector().create(
        this.getKey(event, context),
        context,
        (projection) => projector(projection, event, context),
        (existingProjection) =>
          this.shouldOverwrite(existingProjection, event, context),
      ),
    )

    return this
  }

  public ignoringDuplicates() {
    this.shouldOverwrite = () => false
    return this
  }

  public overwritingDuplicates() {
    this.shouldOverwrite = () => true
    return this
  }

  public handlingDuplicatesUsing(
    shouldOverwrite: (
      projection: TProjection,
      event: TEvent,
      context: TContext,
    ) => boolean,
  ) {
    this.shouldOverwrite = shouldOverwrite
    return this
  }
}

class UpdateAction<TEvent, TProjection, TKey, TContext> {
  private handleMissesUsing: (key: TKey, context: TContext) => boolean = (
    key: TKey,
    context: TContext,
  ) => {
    throw new Error(`Failed to find projection with key ${key}`)
  }

  constructor(
    private readonly Event: Type<TEvent>,
    private readonly getKey: GetKey<TEvent, TContext, TKey>,
    private readonly actionBuilder: Action<TEvent, TContext>,
    private readonly getProjector: () => EntityProjectorMap<
      TProjection,
      TKey,
      TContext
    >,
  ) {}

  public using(
    projector: (
      projection: TProjection,
      event: TEvent,
      context: TContext,
    ) => Promise<void> | void,
  ) {
    this.actionBuilder.as((event, context) => {
      const key = this.getKey(event, context)
      return this.getProjector().update(
        key,
        context,
        (projection) => projector(projection, event, context),
        () => this.handleMissesUsing(key, context),
      )
    })

    return this
  }

  public ignoringMisses() {
    this.handleMissesUsing = () => false
    return this
  }

  public creatingIfMissing() {
    this.handleMissesUsing = () => true
    return this
  }

  public handlingMissesUsing(
    handler: (key: TKey, context: TContext) => boolean,
  ) {
    this.handleMissesUsing = handler
    return this
  }
}

class DeleteAction<TEvent, TKey, TContext> {
  private handleMissing: (
    key: TKey,
    context: TContext,
  ) => void | Promise<void> = (key: TKey, context: TContext) => {
    throw new Error(
      `Failed to delete projection with key ${key} because it does not exist`,
    )
  }

  constructor(
    private readonly Event: Type<TEvent>,
    private readonly getKey: GetKey<TEvent, TContext, TKey>,
    private readonly actionBuilder: Action<TEvent, TContext>,
    private readonly getProjector: () => EntityProjectorMap<
      any,
      TKey,
      TContext
    >,
  ) {
    actionBuilder.as(async (event, context) => {
      const key = getKey(event, context)
      const deleted = await this.getProjector().delete(key, context)
      if (!deleted) {
        this.handleMissing(key, context)
      }
    })
  }

  public ignoringMisses() {
    this.handleMissing = () => {}
    return this
  }

  public handlingMissesUsing(
    handler: (key: TKey, context: TContext) => void | Promise<void>,
  ) {
    this.handleMissing = handler
    return this
  }
}
