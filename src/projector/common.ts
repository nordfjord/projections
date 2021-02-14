import { EventEnvelope } from '../interfaces'

export class ProjectionException extends Error {
  constructor(message: string, error?: Error) {
    super(message)
    if (error) {
      this.stack = error.stack
    }
  }

  currentEvent: EventEnvelope
  eventBatch: EventEnvelope[]
  childProjector: string
}

export type ShouldRetry = (
  error: ProjectionException,
  attempts: number,
) => Promise<boolean>
