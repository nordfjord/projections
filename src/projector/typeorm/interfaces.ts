import { Repository } from 'typeorm'
import { Type } from '../../type'

export interface TypeOrmContext {
  getRepository<T>(Projection: Type<T>): Repository<T>
}

export interface ITypeOrmChildProjector {
  projectEvent(event: any, context: TypeOrmContext): Promise<void>
}
