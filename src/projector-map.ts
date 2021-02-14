export class ProjectorMap<TContext> {
  custom(context: TContext, projector: () => Promise<void> | void): Promise<void> | void {
    throw new Error ('No handler has been set up for custom actions')
  }
}

export type Predicate<T> = (projection: T) => boolean
export type Action<T> = (projection: T) => Promise<void> | void

export interface IEntityProjectorMap<TProjection, TKey, TContext> extends ProjectorMap<TContext> {
  create(key: TKey, context: TContext,
         projector: Action<TProjection>, shouldOverwrite: Predicate<TProjection>): Promise<void>

  update(key: TKey, context: TContext,
         projector: Action<TProjection>, createIfMissing: () => boolean): Promise<void>

  delete(key: TKey, context: TContext): Promise<boolean>
}

export class EntityProjectorMap<TProjection, TKey, TContext>
  extends ProjectorMap<TContext>
  implements IEntityProjectorMap<TProjection, TKey, TContext> {

  create(key: TKey, context: TContext, projector: Action<TProjection>, shouldOverwrite: Predicate<TProjection>): Promise<void> {
    throw new Error ('No handler has been set up for creations')
  }

  custom(context: TContext, projector: () => (Promise<void> | void)): Promise<void> | void {
    throw new Error ('No handler has been set up for custom actions')
  }

  delete(key: TKey, context: TContext): Promise<boolean> {
    throw new Error ('No handler has been set up for deletions')
  }

  update(key: TKey, context: TContext, projector: Action<TProjection>, createIfMissing: () => boolean): Promise<void> {
    throw new Error ('No handler has been set up for updates')
  }
}