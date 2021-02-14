import {
  EntityEventMapBuilder,
  EntityProjectorMap,
  EventMapBuilder,
} from '../src'
import { plainToClass } from 'class-transformer'
import {
  buildEntityEventMap,
  ProductAddedToCatalog,
  ProductCatalogEntry,
  ProductPriceSet,
  ProductRemovedFromCatalog,
  SomethingHappened,
  UnhandledEvent,
} from './utils'

type Action<T> = (t: T) => Promise<void> | void
type Predicate<T> = (t: T) => boolean

test('it handles events', async () => {
  const builder = new EventMapBuilder<any>()
  let what = ''
  builder.map(SomethingHappened).as((event) => {
    what += event.what
  })

  const map = builder.build({
    async custom(context: any, projector: () => Promise<void>) {
      await projector()
    },
  })

  await map.handle(new SomethingHappened('something'), {})
  await map.handle(new UnhandledEvent(), {})
  await map.handle(new UnhandledEvent(), {})
  await map.handle(new UnhandledEvent(), {})
  await map.handle(new UnhandledEvent(), {})
  expect(what).toBe('something')
})

test('Creation', async () => {
  // Given
  let projection: ProductCatalogEntry
  const builder = new EntityEventMapBuilder<ProductCatalogEntry, string, any>()
  builder
    .map(ProductAddedToCatalog)
    .asCreateOf((event) => event.productKey)
    .using((p, e) => {
      p.category = e.category
    })

  const map = builder.build(
    new (class extends EntityProjectorMap<ProductCatalogEntry, string, any> {
      async create(
        key: string,
        ctx: any,
        projector: Action<ProductCatalogEntry>,
        shouldOverwrite: (p: ProductCatalogEntry) => boolean,
      ): Promise<void> {
        projection = new ProductCatalogEntry()
        projection.id = key
        await projector(projection)
      }
    })(),
  )

  // When
  await map.handle(
    plainToClass(ProductAddedToCatalog, {
      category: 'Hybrid',
      productKey: 'key1',
    }),
    {},
  )

  // Then
  // noinspection JSUnusedAssignment
  expect(projection!).toMatchObject({
    category: 'Hybrid',
    id: 'key1',
    deleted: false,
  })
})

test('Creation from context', async () => {
  // Given
  let projection: ProductCatalogEntry

  interface Context {
    metadata: { productId: string }
  }

  const builder = new EntityEventMapBuilder<
    ProductCatalogEntry,
    string,
    Context
  >()
  builder
    .map(ProductAddedToCatalog)
    .asCreateOf((_, ctx) => ctx.metadata.productId)
    .using((p, e) => {
      p.category = e.category
    })

  const map = builder.build(
    new (class extends EntityProjectorMap<
      ProductCatalogEntry,
      string,
      Context
    > {
      async create(
        key: string,
        context: any,
        projector: Action<ProductCatalogEntry>,
        shouldOverwrite: Predicate<ProductCatalogEntry>,
      ): Promise<void> {
        projection = new ProductCatalogEntry()
        projection.id = key
        await projector(projection)
      }
    })(),
  )
  await map.handle(
    plainToClass(ProductAddedToCatalog, {
      category: 'Hybrid',
    }),
    { metadata: { productId: 'key1' } },
  )

  // noinspection JSUnusedAssignment
  expect(projection!).toMatchObject({
    category: 'Hybrid',
    id: 'key1',
    deleted: false,
  })
})

test('Creation when exists is ignored', async () => {
  // Given
  let projection = new ProductCatalogEntry()
  projection.id = 'key1'
  projection.category = 'Category'

  const builder = new EntityEventMapBuilder<ProductCatalogEntry, string, any>()
  builder
    .map(ProductAddedToCatalog)
    .asCreateOf((e) => e.productKey)
    .ignoringDuplicates()
    .using((p, e) => {
      p.category = e.category
    })

  // noinspection DuplicatedCode
  const map = builder.build(
    new (class extends EntityProjectorMap<ProductCatalogEntry, string, any> {
      async create(
        key: string,
        context: any,
        projector: Action<ProductCatalogEntry>,
        shouldOverwrite: Predicate<ProductCatalogEntry>,
      ): Promise<void> {
        if (shouldOverwrite(projection)) {
          projection = new ProductCatalogEntry()
          projection.id = key
          await projector(projection)
        }
      }
    })(),
  )

  // When
  await map.handle(
    plainToClass(ProductAddedToCatalog, {
      productKey: 'key1',
      category: 'Hybrid',
    }),
    {},
  )

  expect(projection).toMatchObject({
    category: 'Category',
    id: 'key1',
    deleted: false,
  })
})
test('Creation with overwrite', async () => {
  // Given
  let projection = new ProductCatalogEntry()
  projection.id = 'key1'
  projection.category = 'Category'

  const builder = new EntityEventMapBuilder<ProductCatalogEntry, string, any>()
  builder
    .map(ProductAddedToCatalog)
    .asCreateOf((e) => e.productKey)
    .overwritingDuplicates()
    .using((p, e) => {
      p.category = e.category
    })

  const map = builder.build(
    new (class extends EntityProjectorMap<ProductCatalogEntry, string, any> {
      async create(
        key: string,
        context: any,
        projector: Action<ProductCatalogEntry>,
        shouldOverwrite: Predicate<ProductCatalogEntry>,
      ): Promise<void> {
        if (shouldOverwrite(projection)) {
          projection = new ProductCatalogEntry()
          projection.id = key
          await projector(projection)
        }
      }
    })(),
  )

  // When
  await map.handle(
    plainToClass(ProductAddedToCatalog, {
      productKey: 'key1',
      category: 'Hybrid',
    }),
    {},
  )

  expect(projection).toMatchObject({
    category: 'Hybrid',
    id: 'key1',
    deleted: false,
  })
})

let db: Record<string, ProductCatalogEntry> = {}
const projector = new (class extends EntityProjectorMap<
  ProductCatalogEntry,
  string,
  any
> {
  async create(
    key: string,
    context: any,
    projector: Action<ProductCatalogEntry>,
    shouldOverwrite: Predicate<ProductCatalogEntry>,
  ): Promise<void> {
    let projection: ProductCatalogEntry
    if (!db[key] || shouldOverwrite(db[key])) {
      projection = new ProductCatalogEntry()
      projection.id = key
      db[key] = projection
    } else {
      return
    }

    await projector(projection)
  }

  async update(
    key: string,
    context: any,
    projector: Action<ProductCatalogEntry>,
    createIfMissing: () => boolean,
  ): Promise<void> {
    let projection = db[key]
    if (!projection && createIfMissing()) {
      projection = new ProductCatalogEntry()
      projection.id = key
      db[key] = projection
    } else if (!projection) {
      return
    }

    await projector(projection)
  }

  async delete(key: string, context: any): Promise<boolean> {
    if (db[key]) {
      delete db[key]
      return true
    }
    return false
  }

  async custom(
    context: any,
    projector: () => Promise<void> | void,
  ): Promise<void> {
    await projector()
  }
})()

describe('Complete handling with defaults', () => {
  const builder = new EntityEventMapBuilder<ProductCatalogEntry, string, any>()

  builder
    .map(ProductAddedToCatalog)
    .asCreateOf((x) => x.productKey)
    .using((p, e) => {
      p.category = e.category
    })

  builder.map(ProductRemovedFromCatalog).asDeleteOf((x) => x.productKey)

  builder
    .map(ProductPriceSet)
    .asUpdateOf((x) => x.productKey)
    .using((p, e) => {
      p.price = e.price
    })

  const map = builder.build(projector)

  test('It creates an entry', async () => {
    await map.handle(
      plainToClass(ProductAddedToCatalog, {
        category: 'Category',
        productKey: '1',
      }),
      {},
    )

    expect(db['1']).toMatchObject({ id: '1', category: 'Category' })
  })

  test('it throws creating the same entry', async () => {
    await expect(
      map.handle(
        plainToClass(ProductAddedToCatalog, {
          category: 'Category',
          productKey: '1',
        }),
        {},
      ),
    ).rejects.toThrow('already exists')
  })

  test('it updates an entry', async () => {
    await map.handle(
      plainToClass(ProductPriceSet, { productKey: '1', price: 12 }),
      {},
    )
    expect(db['1']).toMatchObject({ id: '1', category: 'Category', price: 12 })
  })

  test('it throws when updating a non existent entry', async () => {
    await expect(
      map.handle(
        plainToClass(ProductPriceSet, {
          productKey: '2',
          price: 12,
        }),
        {},
      ),
    ).rejects.toThrow('Failed to find')
  })

  test('it deletes an entry', async () => {
    await map.handle(
      plainToClass(ProductRemovedFromCatalog, { productKey: '1' }),
      {},
    )
    expect(db['1']).toBeUndefined()
  })

  test('it throws when deleting a non-existent entry', async () => {
    await expect(
      map.handle(
        plainToClass(ProductRemovedFromCatalog, { productKey: '2' }),
        {},
      ),
    ).rejects.toThrow('does not exist')
  })
})

describe('Complete handling with ignores', () => {
  beforeAll(() => {
    db = {}
  })
  const builder = new EntityEventMapBuilder<ProductCatalogEntry, string, any>()

  builder.withEventTypeFromConstructor((constructor) => constructor.name)
  builder.withEventTypeFromEvent((event) => event.type)

  builder
    .map(ProductAddedToCatalog)
    .asCreateOf((x) => x.productKey)
    .ignoringDuplicates()
    .using((p, e) => {
      p.category = e.category
    })

  builder
    .map(ProductRemovedFromCatalog)
    .asDeleteOf((x) => x.productKey)
    .ignoringMisses()

  builder
    .map(ProductPriceSet)
    .asUpdateOf((x) => x.productKey)
    .ignoringMisses()
    .using((p, e) => {
      p.price = e.price
    })

  const map = builder.build(projector)

  test('It creates an entry', async () => {
    await map.handle(
      plainToClass(ProductAddedToCatalog, {
        category: 'Category',
        productKey: '1',
      }),
      {},
    )
    expect(db['1']).toMatchObject({ id: '1', category: 'Category' })
  })

  test('it does nothing when creating the same entry', async () => {
    await map.handle(
      plainToClass(ProductAddedToCatalog, {
        category: 'OtherCategory',
        productKey: '1',
      }),
      {},
    )
    expect(db['1']).toMatchObject({ id: '1', category: 'Category' })
  })

  test('it updates an entry', async () => {
    await map.handle(
      plainToClass(ProductPriceSet, { productKey: '1', price: 12 }),
      {},
    )
    expect(db['1']).toMatchObject({ id: '1', category: 'Category', price: 12 })
  })

  test('it does nothing when updating a non-existent entry', async () => {
    await map.handle(
      plainToClass(ProductPriceSet, {
        productKey: '2',
        price: 12,
      }),
      {},
    )
    expect(db['2']).toBeUndefined()
  })

  test('it deletes an entry', async () => {
    await map.handle(
      plainToClass(ProductRemovedFromCatalog, { productKey: '1' }),
      {},
    )
    expect(db['1']).toBeUndefined()
  })

  test('it does nothing when deleting a non-existent entry', async () => {
    await map.handle(
      plainToClass(ProductRemovedFromCatalog, { productKey: '2' }),
      {},
    )
    expect(db['2']).toBeUndefined()
  })
})
describe('Complete handling with overwrites', () => {
  beforeAll(() => {
    db = {}
  })
  const builder = buildEntityEventMap()
  const map = builder.build(projector)

  test('It creates an entry', async () => {
    await map.handle(
      plainToClass(ProductAddedToCatalog, {
        category: 'Category',
        productKey: '1',
      }),
      {},
    )
    expect(db['1']).toMatchObject({ id: '1', category: 'Category' })
  })

  test('it does updates when creating the same entry', async () => {
    await map.handle(
      plainToClass(ProductAddedToCatalog, {
        category: 'OtherCategory',
        productKey: '1',
      }),
      {},
    )
    expect(db['1']).toMatchObject({ id: '1', category: 'OtherCategory' })
  })

  test('it updates an entry', async () => {
    await map.handle(
      plainToClass(ProductPriceSet, { productKey: '1', price: 12 }),
      {},
    )
    expect(db['1']).toMatchObject({
      id: '1',
      category: 'OtherCategory',
      price: 12,
    })
  })

  test('it creates when updating a non-existent entry', async () => {
    await map.handle(
      plainToClass(ProductPriceSet, {
        productKey: '2',
        price: 12,
      }),
      {},
    )
    expect(db['2']).toMatchObject({ id: '2', price: 12 })
  })
})
