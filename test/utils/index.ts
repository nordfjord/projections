import { EntityEventMapBuilder } from '../../src'
import { plainToClass } from 'class-transformer'
import { Column, Entity, PrimaryColumn } from 'typeorm'

export class SomethingHappened {
  type = 'SomethingHappened'

  constructor(public readonly what: string) {}
}

export class UnhandledEvent {
  type = 'UnhandledEvent'
}

export class ProductAddedToCatalog {
  type = 'ProductAddedToCatalog'
  category: string
  productKey: string
}

export class ProductRemovedFromCatalog {
  type = 'ProductRemovedFromCatalog'
  productKey: string
}

export class ProductPriceSet {
  type = 'ProductPriceSet'
  productKey: string
  price: number
}

@Entity()
export class ProductCatalogEntry {
  @PrimaryColumn()
  id: string
  @Column({ nullable: true })
  category?: string
  @Column({ nullable: true })
  deleted?: boolean = false
  @Column({ nullable: true })
  price: number
}

export function generateEventsForASingleProduct() {
  return [
    plainToClass(ProductAddedToCatalog, {
      category: 'MyCategory',
      productKey: '1',
    }),
    plainToClass(ProductPriceSet, { price: 12, productKey: '1' }),
    new UnhandledEvent(),
  ]
}

export function buildEntityEventMap() {
  const builder = new EntityEventMapBuilder<ProductCatalogEntry, string, any>()

  builder
    .map(ProductAddedToCatalog)
    .asCreateOf((x) => x.productKey)
    .overwritingDuplicates()
    .using((p, e) => {
      p.category = e.category
    })

  builder.map(ProductRemovedFromCatalog).asDeleteOf((x) => x.productKey)

  builder
    .map(ProductPriceSet)
    .asUpdateOf((x) => x.productKey)
    .creatingIfMissing()
    .using((p, e) => {
      p.price = e.price
    })

  return builder
}
