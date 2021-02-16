import {
  Connection,
  createConnection,
  EntityManager,
  getConnection,
} from 'typeorm'
import { EventEnvelope, ProjectionState, TypeOrmProjector } from '../../src'
import {
  buildEntityEventMap,
  generateEventsForASingleProduct,
  ProductCatalogEntry,
} from '../utils'
import { Type } from '../../src/type'
import { Dispatcher } from '../../src/dispatcher'
import { Subject } from 'rxjs'
import { bufferTime, concatMap, filter, take, tap } from 'rxjs/operators'
import { LruCache } from '../../src/cache/lru.cache'

let connection: Connection
beforeAll(async () => {
  connection = await createConnection({
    type: 'sqlite',
    database: ':memory:',
    name: 'default',
    entities: [ProjectionState, ProductCatalogEntry],
  })
  await connection.synchronize()
})

afterAll(async () => {
  await connection.close()
})

class MyProjector {
  private tx: EntityManager
  public projector: TypeOrmProjector<ProductCatalogEntry, string>

  public getRepo<T>(t: Type<T>) {
    return this.tx?.getRepository(t) ?? getConnection().getRepository(t)
  }

  constructor(private readonly dispatcher: Dispatcher) {
    this.buildProjector()
  }

  private buildProjector() {
    this.projector = new TypeOrmProjector(
      ProductCatalogEntry,
      <T>(t: Type<T>) => this.getRepo(t),
      buildEntityEventMap(),
      (p, k) => {
        p.id = k
      },
    )
  }

  public async start() {
    const lastCheckpoint = await this.projector.getLastPosition(
      getConnection().getRepository(ProjectionState),
    )
    const event$ = new Subject<EventEnvelope>()
    const processed$ = new Subject<EventEnvelope>()
    event$
      .pipe(
        bufferTime(10),
        concatMap(async (events) => {
          if (events.length === 0) return events
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
          return events
        }),
        tap((events) => events.forEach((event) => processed$.next(event))),
      )
      .subscribe()
    await this.dispatcher.subscribe(lastCheckpoint, async (event) => {
      event$.next(event)
      await processed$
        .pipe(
          filter((e) => e === event),
          take(1),
        )
        .toPromise()
    })
  }
}

let position = -1n
test('It projects entities', async () => {
  const subject = new Subject<EventEnvelope>()
  const handledEventBatch = new Subject<any>()
  const dispatcher = new Dispatcher(async (lastCheckpoint, handler) =>
    subject
      .pipe(
        filter((x) => x.position > lastCheckpoint),
        concatMap(handler),
        tap(() => handledEventBatch.next(true)),
      )
      .subscribe(),
  )

  const projector = new MyProjector(dispatcher)
  await projector.start()

  const events = generateEventsForASingleProduct().map(
    (event, i): EventEnvelope => ({
      position: ++position,
      version: i,
      timestampUtc: new Date(),
      body: event,
      metadata: {},
      streamId: `Product-1`,
    }),
  )
  events.forEach((e) => subject.next(e))

  await handledEventBatch.pipe(take(events.length)).toPromise()

  await expect(
    getConnection().getRepository(ProductCatalogEntry).findOne('1'),
  ).resolves.toMatchObject({
    id: '1',
    category: 'MyCategory',
    price: 12,
  })
})

test('Using an LRU cache', async () => {
  const subject = new Subject<EventEnvelope>()
  const handledEventBatch = new Subject<any>()
  const dispatcher = new Dispatcher(async (lastCheckpoint, handler) =>
    subject
      .pipe(
        filter((x) => x.position > lastCheckpoint),
        concatMap(handler),
        tap(() => {
          handledEventBatch.next(true)
        }),
      )
      .subscribe(),
  )

  const repo = getConnection().getRepository(ProductCatalogEntry)

  const projector = new MyProjector(dispatcher)
  projector.projector.cache = new LruCache<string, ProductCatalogEntry>({
    capacity: 3,
    retention: 10000,
  })
  // @ts-ignore
  projector.getRepo = <T>(t: Type<T>) => {
    // @ts-ignore
    if (t === ProductCatalogEntry) {
      return repo
    }
    return getConnection().getRepository(t)
  }
  await projector.start()

  const findSpy = jest.spyOn(repo, 'findOne')

  const events = generateEventsForASingleProduct().map(
    (event, i): EventEnvelope => ({
      position: ++position,
      version: i,
      timestampUtc: new Date(),
      body: event,
      metadata: {},
      streamId: `Product-1`,
    }),
  )
  events.forEach((e) => subject.next(e))

  await handledEventBatch.pipe(take(events.length)).toPromise()

  expect(repo.findOne).toHaveBeenCalledTimes(1)
  findSpy.mockRestore()

  await expect(
    getConnection().getRepository(ProductCatalogEntry).findOne('1'),
  ).resolves.toMatchObject({
    id: '1',
    category: 'MyCategory',
    price: 12,
  })
})
