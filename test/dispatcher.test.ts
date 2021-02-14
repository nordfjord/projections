import { Dispatcher, NoSuchPositionException } from '../src/dispatcher'
import { Subject, Subscription } from 'rxjs'
import { concatMap } from 'rxjs/operators'
import { EventEnvelope } from '../src'

test('dispatcher restarts when ahead', async () => {
  const subject = new Subject<EventEnvelope>()
  const createSubscription = jest.fn(
    async (
      lastCheckpoint: bigint,
      handler: (eb: EventEnvelope) => Promise<void>,
      id: string,
    ) => {
      if (lastCheckpoint > 0n) {
        throw new NoSuchPositionException(`No position ${lastCheckpoint}`)
      }
      return subject.pipe(concatMap(handler)).subscribe()
    },
  )
  const dispatcher = new Dispatcher(createSubscription)
  await dispatcher.subscribe(1n, jest.fn())

  expect(createSubscription).toHaveBeenCalledTimes(2)
  expect(createSubscription).toHaveBeenCalledWith(
    1n,
    expect.anything(),
    expect.anything(),
  )
  expect(createSubscription).toHaveBeenCalledWith(
    -1n,
    expect.anything(),
    expect.anything(),
  )
})

test('dispatcher follows the exception policy', async (done) => {
  const subject = new Subject<EventEnvelope>()
  const createSubscription = async (
    lastCheckpoint: bigint,
    handler: (event: EventEnvelope) => Promise<void>,
    id: string,
  ) => subject.pipe(concatMap(handler)).subscribe()
  const dispatcher = new Dispatcher(createSubscription)
  const handler = jest.fn().mockRejectedValueOnce(new Error('failure'))
  const subscription = (await dispatcher.subscribe(
    -1n,
    handler,
  )) as Subscription
  spyOn(subscription, 'unsubscribe').and.callThrough()

  subscription.add(() => {
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1)
    done()
  })

  subject.next({
    streamId: '1',
    position: 0n,
    version: 0,
    metadata: {},
    body: { something: 'happened' },
    timestampUtc: new Date(),
  })
})
