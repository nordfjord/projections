import { Type } from './type'

export interface IEventMap<TContext> {
  handle(event: any, context: TContext): Promise<boolean>
}

export type EventFunc<TContext, TReturn = void, TEvent = any> = (
  event: any,
  context: TContext,
) => TReturn | Promise<TReturn>
export type EventHandler<TContext, TEvent = any> = EventFunc<
  TContext,
  void,
  TEvent
>
export type EventPredicate<TContext, TEvent = any> = EventFunc<
  TContext,
  boolean,
  TEvent
>

export class EventMap<TContext> implements IEventMap<TContext> {
  private readonly mappings = new Map<string, EventHandler<TContext>[]>()
  private readonly filters: EventPredicate<TContext>[] = []
  private eventTypeFromConstructor = (constructor: Type) => constructor.name
  private eventTypeFromEvent = (event: any) => event.constructor.name

  add<TEvent>(
    Event: Type<TEvent> | Type<TEvent>[],
    action: EventFunc<TContext, void, TEvent>,
  ) {
    const types = Array.isArray(Event) ? Event : [Event]
    for (const type of types) {
      const eventType = this.eventTypeFromConstructor(type)
      if (!this.mappings.has(eventType)) {
        this.mappings.set(eventType, [])
      }
      const handlers = this.mappings.get(eventType)!
      handlers.push(action)
    }
  }

  withEventTypeFromEvent(fn: (event: any) => string) {
    this.eventTypeFromEvent = fn
  }

  withEventTypeFromConstructor(fn: (constructor: Type) => string) {
    this.eventTypeFromConstructor = fn
  }

  addFilter(filter: EventPredicate<TContext>) {
    this.filters.push(filter)
  }

  public async handle(event: any, context: TContext) {
    if (await this.passesFilter(event, context)) {
      const handlers = this.mappings.get(this.eventTypeFromEvent(event)) || []
      for (const handler of handlers) {
        await handler(event, context)
        return true
      }
    }

    return false
  }

  private async passesFilter(event: any, context: TContext) {
    if (!this.filters.length) return true
    const results = await Promise.all(
      this.filters.map((filter) => filter(event, context)),
    )
    return results.every(Boolean)
  }
}
