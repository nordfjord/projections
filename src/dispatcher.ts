import { EventEnvelope } from './interfaces'

export enum ExceptionResolution {
  Ignore,
  Abort,
  Retry,
}

export class NoSuchPositionException extends Error {}

interface Subscription {
  unsubscribe(): void
}

export type HandleException = (
  subscription: Subscription | undefined,
  error: Error,
  attempts: number,
) => Promise<ExceptionResolution>
export type HandleSuccess = (subscription: Subscription) => Promise<void>
export type CreateSubscription = (
  lastCheckpoint: bigint,
  handler: Handler,
  subscriptionId: string,
) => Promise<Subscription>

export interface SubscriptionOptions {
  id: string
  restartWhenAhead: boolean
  beforeRestarting: () => Promise<void>
}

const defaultOptions = () => ({
  id: 'subscription',
  restartWhenAhead: true,
  beforeRestarting: () => Promise.resolve(),
})

type Handler = (event: EventEnvelope) => Promise<void>

export class Dispatcher {
  private static readonly abortExceptionResolutionPromise = Promise.resolve(
    ExceptionResolution.Abort,
  )

  constructor(private readonly createSubscription: CreateSubscription) {}

  async subscribe(
    lastProcessedCheckpoint: bigint,
    handler: Handler,
    options: Partial<SubscriptionOptions> = defaultOptions(),
  ): Promise<Subscription> {
    const subscriptionOptions: SubscriptionOptions = {
      ...defaultOptions(),
      ...options,
    }

    try {
      const subscription: Subscription = await this.createSubscription(
        lastProcessedCheckpoint,
        (eventBatch) => this.handleEvent(eventBatch, handler, subscription),
        subscriptionOptions.id,
      )
      return subscription
    } catch (err) {
      if (err instanceof NoSuchPositionException) {
        const result = await this.handleUnknownCheckpoint(
          handler,
          subscriptionOptions,
        )
        if (result == undefined)
          throw new Error(
            'Unable to restart subscription after unknown checkpoint',
          )
        return result
      }
      throw err
    }
  }

  public exceptionHandler: HandleException = () =>
    Dispatcher.abortExceptionResolutionPromise
  public successHandler: HandleSuccess = () => Promise.resolve()

  private async handleEvent(
    event: EventEnvelope,
    handler: Handler,
    subscription: Subscription,
  ) {
    await this.executeWithPolicy(
      async () => {
        await handler(event)
        await this.successHandler(subscription)
      },
      (error) => {
        console.error(
          'Projection exception was not handled. Event subscription has been cancelled',
          error,
        )
        subscription.unsubscribe()
      },
      subscription,
    )
  }

  private async handleUnknownCheckpoint(
    handler: Handler,
    options: SubscriptionOptions,
  ) {
    if (options.restartWhenAhead) {
      return await this.executeWithPolicy(
        async () => {
          await options.beforeRestarting()
          return await this.subscribe(-1n, handler, options)
        },
        (error) => {
          console.error('Failed to restart projection', error)
        },
        undefined,
        () => this.subscribe(-1n, handler, options),
      )
    }
    throw new Error('Unknown checkpoint. Not restarting')
  }

  private async executeWithPolicy<T>(
    action: () => Promise<T>,
    abort: (err: Error) => void,
    subscription?: Subscription,
    ignore?: () => T | Promise<T>,
  ): Promise<T | undefined> {
    let attempts = 0
    let retry = true
    while (retry) {
      try {
        ++attempts
        const result = await action()
        retry = false
        return result
      } catch (err) {
        const resolution = await this.exceptionHandler(
          subscription,
          err,
          attempts,
        )
        switch (resolution) {
          case ExceptionResolution.Ignore:
            retry = false
            // @ts-ignore
            return ignore?.()
          case ExceptionResolution.Abort:
            abort(err)
            retry = false
            break
          case ExceptionResolution.Retry:
            break
        }
      }
    }
  }
}
