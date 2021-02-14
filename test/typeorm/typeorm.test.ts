import {
  Connection,
  createConnection,
  EntityManager,
  getConnection,
} from 'typeorm'
import { TypeOrmProjector } from '../../src/projector/typeorm/typeorm.projector'
import {
  buildEntityEventMap,
  generateEventsForASingleProduct,
  ProductCatalogEntry,
} from '../utils'
import { Type } from '../../src/type'
import { Dispatcher } from '../../src/dispatcher'
import { Subject } from 'rxjs'
import { EventEnvelope } from '../../src'
import { bufferTime, concatMap, delay, filter, take, tap } from 'rxjs/operators'
import { ProjectionState } from '../../src/projector/typeorm/ProjectionState'

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
  private projector: TypeOrmProjector<ProductCatalogEntry, string>

  constructor(private readonly dispatcher: Dispatcher) {
    this.buildProjector()
  }

  private buildProjector() {
    this.projector = new TypeOrmProjector(
      ProductCatalogEntry,
      <T>(t: Type<T>) =>
        this.tx?.getRepository(t) ?? getConnection().getRepository(t),
      buildEntityEventMap(),
      (p, k) => {
        p.id = k
      },
    )
  }

  public async start() {
    const lastCheckpoint = await this.projector.getLastPosition()
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
    await this.dispatcher.subscribe(lastCheckpoint, async (event) =>
      event$.next(event),
    )
  }
}

let position = -1n
test('It projects entities', async () => {
  const subject = new Subject<EventEnvelope>()
  const handledEventBatch = new Subject<any>()
  const dispatcher = new Dispatcher(async (lastCheckpoint, handler, id) =>
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

  await handledEventBatch.pipe(take(events.length), delay(500)).toPromise()

  await expect(
    getConnection().getRepository(ProductCatalogEntry).findOne('1'),
  ).resolves.toMatchObject({
    id: '1',
    category: 'MyCategory',
    price: 12,
  })
})
