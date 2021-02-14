import { Column, Entity, PrimaryColumn } from 'typeorm'

const BigIntTransformer = {
  from(value: string) {
    return BigInt (value)
  },
  to(value: bigint) {
    return value.toString ()
  }
}

@Entity ()
export class ProjectionState {
  @PrimaryColumn ()
  id: string

  @Column ({ type: 'text', transformer: BigIntTransformer })
  position: bigint

  @Column ({ name: 'last_update_utc' })
  lastUpdateUtc: Date
}