import { Repository } from 'typeorm'
import { Type } from '../../type'

export interface TypeOrmContext {
  getRepository<T>(Projection: Type<T>): Repository<T>
  streamId: string
  timestampUtc: Date
  position: bigint
  metadata: Record<string, any>
}

export interface ITypeOrmChildProjector {
  projectEvent(event: any, context: TypeOrmContext): Promise<void>
}
