export interface EventEnvelope {
  position: bigint
  version: number
  timestampUtc: Date
  streamId: string
  body: any
  metadata: Record<string, any>
}
