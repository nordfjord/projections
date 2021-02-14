# Projections

This is a library to help write projections in node. It is heavily inspired
by [LiquidProjections](https://liquidprojections.net/).

# Building blocks

You'll need some events in your application.

```ts
class ProductAddedToCatalog {
  productKey: string
  category: string
}

class ProductPriceSet {
  productKey: string
  price: number
}
```

## EventMap

```ts
import { EventMapBuilder } from '@nordfjord/projections'

const builder = new EventMapBuilder<MyContext>()

builder.map(ProductAddedToCatalog).as((ctx) => {
  // Do something, possibly involving your context variable
})

builder.map(ProductPriceSet).as((ctx) => {
  // Do something else, possibly involving your context variable
})
```

You can instruct the event map builder how to get the event types from your events. It defaults to using the constructor
name

```ts
builder.withEventTypeFromConstructor((constructor) => constructor.name)

// use event.type when passed an event
builder.withEventTypeFromEvent((event) => event.type)
```

You can add as many maps as you'd like. There's a special map if you want to map all events.

```ts
builder.map(ProductAddedToCatalog, ProductPriceSet).as((ctx) => {
  // Handles both events
})
```

Conditional maps are also supported

```ts
builder
  .map(SomeEvent)
  .when((event) => event.country == 'IS')
  .as((ctx) => {
    // only events whose country is 'IS' will be handled
  })
```

It is also possible to add a global filter on the event map

```ts
// only handle events whose types are in the allEventTypes array
builder.where((event) => {
  return allEventTypes.includes(event.type)
})
```

## ProjectorMap

Now that you have your event map builder set up you need some way to construct the actual event map.

```ts
const map: IEventMap<MyContext> = builder.build({
  custom: (ctx, projector) => projector(),
})
```

the projector parameter hides the specific projection logic that was mapped and the actual event.

Let's use the map!

```ts
await map.handle(
  {
    type: 'ProductAddedToCatalog',
    productKey: '1',
    category: 'Category',
  },
  new MyContext(),
)
```

# Dispatcher

It's useful to connect your projectors to your event store. The dispatcher assumes that your event store has a sequence
of bigint values to denote position.

```ts
import { Dispatcher } from '@nordfjord/projections'

const dispatcher = new Dispatcher((lastCheckpoint, handler, subscriptionId) => {
  // set up a subscription to the event store that calls handler with a list of events

  // example for eventstore.com

  return client
    .subscribeToAll({
      fromPosition: { commit: lastCheckpoint, prepare: lastCheckpoint },
    })
    .on('data', (event) => handler(convertToEventEnvelope(event)))
})
```

The dispatcher want events in its own `EventEnvelope` format, so you'll have to set up a mapping between your event
store's envelope and the dispatchers.

```ts
interface EventEnvelope {
  position: bigint
  version: number
  timestampUtc: Date
  streamId: string
  body: any
  metadata: Record<string, any>
}

function convertToEventEnvelope(resolvedEvent): EventEnvelope {
  return {
    position: resolvedEvent.commitPosition,
    version: resolvedEvent.event.revision,
    timestampUtc: new Date(resolvedEvent.event.created),
    streamId: resolvedEvent.event.streamId,
    // deserializeEvent would deserialize into the
    // correct class
    body: deserializeEvent(resolvedEvent.data),
    metadata: resolvedEvent.metadata,
  }
}
```

# Mapping CRUD

With these building blocks in place let's add `EntityEventMap` to our repertoire.

```ts
import { ProductAddedToCatalog, ProductPriceSet } from './index'

const builder = new EntityEventMapBuilder<
  ProductCatalogEntry,
  string,
  MyContext
>()

builder
  .map(ProductAddedToCatalog)
  .asCreateOf((event) => event.productKey)
  .using((projection, event) => {
    projection.category = event.category
  })

builder
  .map(ProductPriceSet)
  .asUpdateOf((event) => event.productKey)
  .using((projection, event) => {
    projection.price = event.price
  })
```

this type of event map builder needs an `EntityProjectorMap` to build against

```ts
const map: IEventMap<MyContext> = builder.build({
  create: async (key, context, projector, shouldOverwrite) => {},
  update: async (key, context, projector, createIfMissing) => {},
  delete: async (key, context) => {},
  custom: (context, projector) => {},
})
```

# TypeOrmProjector

With an entity event map we can use TypeORM to project into a database of our choosing.

```ts
import { getConnection } from 'typeorm'

const getRepository = async (e: Type) => getConnection().getRepository(e)
const projector = new TypeOrmProjector(
  ProductCatalogEntry, // The entity we're projecting
  getRepository, // A way to get a repository
  builder, // an EntityEventMapBuilder<TypeOrmContext>
  (projection, key) => {
    // How do we set the key of the projection
    projection.id = key
  },
)
```

The TypeOrmProjector will automatically save the position of the projection.

Let's see the whole shebang in action:

```ts
import {
  EntityEventMapBuilder,
  IEntityEventMapBuilder,
  TypeOrmProjector,
  TypeOrmContext,
} from '@nordfjord/projections'
import { getConnection } from 'typeorm'

class MyProjector {
  private tx: EntityManager

  constructor(private readonly dispatcher: Dispatcher) {
    this.buildProjector()
  }

  private buildEventMap(
    builder: IEntityEventMapBuilder<
      ProductCatalogEntry,
      string,
      TypeOrmContext
    >,
  ) {
    builder
      .map(ProductAddedToCatalog)
      .asCreateOf((e) => e.productKey)
      .overwritingDuplicates()
      .using((p, e) => {
        p.category = e.category
      })

    builder.map(ProductRemovedFromCatalog).asDeleteOf((e) => e.productKey)

    builder
      .map(ProductPriceSet)
      .asUpdateOf((e) => e.productKey)
      .creatingIfMissing()
      .using((p, e) => {
        p.price = e.price
      })
  }

  private buildProjector() {
    const builder = new EntityEventMapBuilder<
      ProductCatalogEntry,
      string,
      TypeOrmContext
    >()
    this.buildEventMap(builder)
    this.projector = new TypeOrmProjector(
      ProductCatalogEntry,
      (e) => this.tx.getRepository(e),
      builder,
      (p, k) => {
        p.id = k
      },
    )
  }

  public async start() {
    const lastPosition = await this.projector.getLastPosition()
    const event$ = new Subject<EventEnvelope>()
    event$
      .pipe(
        bufferTime(100),
        concatMap(async (events) => {
          const qr = await getConnection().createQueryRunner()
          await qr.connect()
          await qr.startTransaction()
          this.tx = qr.manager
          try {
            await this.projector.handle(events)
            await qr.commitTransaction()
          } catch (err) {
            await qr.rollbackTransaction()
          } finally {
            await qr.release()
          }
        }),
      )
      .subscribe()

    const sub = await this.dispatcher.subscribe(lastPosition, async (event) =>
      event$.next(event),
    )

    sub.add(() => event$.complete())

    return sub
  }
}
```

`TypeOrmProjector` makes no assumption about transactions, so you're free to use them or not.
