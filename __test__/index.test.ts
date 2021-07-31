import { createConnection, Connection } from 'typeorm'
import Redis from 'ioredis'
import { RedisCache } from '@zcong/node-redis-cache'
import { CacheWrapper, fixOption, Option } from '../src'
import { MultiPrimaryTest, Student } from './model'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'mysql://root:root@localhost:3306/test'
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/0'

let conn: Connection
let redis: Redis.Redis

beforeAll(async () => {
  conn = await createConnection({
    type: 'mysql',
    url: DATABASE_URL,
    entities: [Student, MultiPrimaryTest],
  })

  await conn.synchronize()

  redis = new Redis(REDIS_URL)
})

afterAll(async () => {
  await conn.close()
  redis.disconnect()
}, 10000)

const getRepository = (conn: Connection) => conn.getRepository(Student)

const repeatCall = (n: number, fn: Function) =>
  Promise.all(
    Array(n)
      .fill(null)
      .map(() => fn())
  )

const setupData = async (conn: Connection): Promise<Student> => {
  const cardId = `card-${Date.now()}`
  await getRepository(conn).insert({
    cardId,
    firstName: 'firstName',
    lastName: 'lastName',
    age: 18,
  })

  return getRepository(conn).findOne({ cardId })
}

beforeEach(async () => {
  await getRepository(conn).clear()
  await redis.flushdb()
})

it('invalid primaryColumns length model', () => {
  const cache = new RedisCache({ redis, prefix: 'typeorm' })

  expect(
    () =>
      new CacheWrapper(conn.getRepository(MultiPrimaryTest), cache, {
        expire: 50,
        expiryDeviation: 0.04,
      })
  ).toThrow()
})

it('cacheFindByPk', async () => {
  const cache = new RedisCache({ redis, prefix: 'typeorm' })
  const expectRes = await setupData(conn)
  const cw = new CacheWrapper(getRepository(conn), cache, {
    expire: 50,
    expiryDeviation: 0.04,
  })

  await repeatCall(10, async () => {
    const resp = await cw.cacheFindByPk(expectRes.studentId)
    expect(resp).toMatchObject(expectRes)
  })

  await repeatCall(10, async () => {
    const resp = await cw.cacheFindByPk(expectRes.studentId)
    expect(resp).toMatchObject(expectRes)
  })
})

it('cacheFindByUniqueKey', async () => {
  const cache = new RedisCache({ redis, prefix: 'typeorm' })
  const expectRes = await setupData(conn)
  const cw = new CacheWrapper(getRepository(conn), cache, {
    expire: 60,
    uniqueFields: ['cardId'],
    expiryDeviation: 0.04,
  })

  await repeatCall(10, async () => {
    const resp = await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)
    expect(resp).toMatchObject(expectRes)
  })

  await repeatCall(10, async () => {
    const resp = await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)
    expect(resp).toMatchObject(expectRes)
  })

  await expect(() =>
    cw.cacheFindByUniqueKey('studentId', expectRes.studentId)
  ).rejects.toThrow()
})

it('cacheUpdateByPk', async () => {
  const cache = new RedisCache({ redis, prefix: 'typeorm' })
  const expectRes = await setupData(conn)
  const cw = new CacheWrapper(getRepository(conn), cache, {
    expire: 60,
    uniqueFields: ['cardId'],
    expiryDeviation: 0.04,
  })

  // trigger cache
  await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)
  await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)

  await cw.cacheFindByPk(expectRes.studentId)
  await cw.cacheFindByPk(expectRes.studentId)

  // update column
  expectRes.age = 20
  await cw.cacheUpdateByPk(expectRes)

  expect(
    await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)
  ).toMatchObject(expectRes)
  expect(await cw.cacheFindByPk(expectRes.studentId)).toMatchObject(expectRes)

  // update unique column
  expectRes.cardId = 'update-test'
  await cw.cacheUpdateByPk(expectRes)

  expect(
    await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)
  ).toMatchObject(expectRes)
  expect(await cw.cacheFindByPk(expectRes.studentId)).toMatchObject(expectRes)
})

it('deleteByPk', async () => {
  const cache = new RedisCache({ redis, prefix: 'typeorm' })
  const expectRes = await setupData(conn)
  const cw = new CacheWrapper(getRepository(conn), cache, {
    expire: 60,
    uniqueFields: ['cardId'],
    expiryDeviation: 0.04,
  })

  // trigger cache
  await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)
  await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)

  await cw.cacheFindByPk(expectRes.studentId)
  await cw.cacheFindByPk(expectRes.studentId)

  await cw.deleteByPk(expectRes.studentId)

  expect(await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)).toBeNull()
  expect(await cw.cacheFindByPk(expectRes.studentId)).toBeNull()

  expect(await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)).toBeNull()
  expect(await cw.cacheFindByPk(expectRes.studentId)).toBeNull()

  await cw.deleteByPk(10000)
})

it('deleteCache', async () => {
  const cache = new RedisCache({ redis, prefix: 'typeorm' })
  const expectRes = await setupData(conn)
  const cw = new CacheWrapper(getRepository(conn), cache, {
    expire: 60,
    uniqueFields: ['cardId'],
    expiryDeviation: 0.04,
  })

  expect(await redis.dbsize()).toBe(0)

  await repeatCall(10, async () => {
    await cw.cacheFindByPk(expectRes.studentId)
  })

  expect(await redis.dbsize()).toBe(1)

  await repeatCall(10, async () => {
    await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)
  })
  expect(await redis.dbsize()).toBe(2)

  await cw.deleteCache(expectRes)

  expect(await redis.dbsize()).toBe(0)
})

it('option.disable', async () => {
  const cache = new RedisCache({ redis, prefix: 'typeorm' })
  const expectRes = await setupData(conn)
  const cw = new CacheWrapper(getRepository(conn), cache, {
    expire: 60,
    uniqueFields: ['cardId'],
    expiryDeviation: 0.04,
    disable: true,
  })

  expect(await cw.cacheFindByPk(expectRes.studentId)).toMatchObject(expectRes)
  expect(
    await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)
  ).toMatchObject(expectRes)

  expect(await redis.dbsize()).toBe(0)

  expectRes.age = 20
  await cw.cacheUpdateByPk(expectRes)

  expect(await cw.cacheFindByPk(expectRes.studentId)).toMatchObject(expectRes)
  expect(
    await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)
  ).toMatchObject(expectRes)

  expectRes.cardId = 'update-test-02'
  await cw.cacheUpdateByPk(expectRes)

  expect(await cw.cacheFindByPk(expectRes.studentId)).toMatchObject(expectRes)
  expect(
    await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)
  ).toMatchObject(expectRes)

  await cw.deleteByPk(expectRes.studentId)

  expect(await cw.cacheFindByPk(expectRes.studentId)).toBeUndefined()
  expect(
    await cw.cacheFindByUniqueKey('cardId', expectRes.cardId)
  ).toBeUndefined()

  await cw.deleteCache(expectRes)
})

it('fixOption', () => {
  let o: Option<Student> = {
    expire: 5,
    uniqueFields: ['cardId'],
  }

  fixOption(o)
  expect(o.expiryDeviation).toBe(0.05)

  o.expiryDeviation = -1
  fixOption(o)
  expect(o.expiryDeviation).toBe(0)

  o.expiryDeviation = 2
  fixOption(o)
  expect(o.expiryDeviation).toBe(1)
})
