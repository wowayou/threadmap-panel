import { LocalizedError, message } from '../i18n'
import { cachePolicy, inspectTopic, mergeCachedTopic, type CacheConsent, type CacheIdentity, type CacheScope, type CachedPost, type CachedTopic } from '../core/post-cache'
import { isId } from '../core/post-input'

export const CACHE_DB_NAME = 'threadmap-post-cache-v1'
const META = 'meta', TOPICS = 'topics', CONTROL = 'control'
interface Summary { topicId: number; bytes: number; updatedAt: number; expiresAt: number }
interface Control { consent: CacheConsent | null; topics: Summary[] }
const empty = (): Control => ({ consent: null, topics: [] })
const same = (a: CacheConsent | null, b: CacheConsent) => !!a && a.origin === b.origin && a.accountId === b.accountId && a.token === b.token
const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error ?? new LocalizedError(message('cache.errorRequest'))) })
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0

function control(value: unknown): Control {
  if (value === undefined) return empty()
  const c = value as Control
  if (!c || !Array.isArray(c.topics) || c.topics.length > cachePolicy.maxTopics || (c.consent !== null && (!c.consent || !isId(c.consent.accountId) || typeof c.consent.origin !== 'string' || c.consent.origin.length > 200 || typeof c.consent.token !== 'string' || !/^[a-f0-9-]{16,80}$/.test(c.consent.token)))) throw new LocalizedError(message('cache.errorIndex'))
  if ((!c.consent && c.topics.length) || new Set(c.topics.map(t => t?.topicId)).size !== c.topics.length || c.topics.some(t => !t || !isId(t.topicId) || !integer(t.bytes) || t.bytes > cachePolicy.topicBytes || !integer(t.updatedAt) || !integer(t.expiresAt))) throw new LocalizedError(message('cache.errorIndex'))
  if (c.topics.reduce((sum, t) => sum + t.bytes, 0) > cachePolicy.totalBytes) throw new LocalizedError(message('cache.errorIndexBudget'))
  return { consent: c.consent && { origin: c.consent.origin, accountId: c.consent.accountId, token: c.consent.token }, topics: c.topics.map(t => ({ topicId: t.topicId, bytes: t.bytes, updatedAt: t.updatedAt, expiresAt: t.expiresAt })) }
}
const summarize = (topic: CachedTopic): Summary => ({ topicId: topic.topicId, bytes: topic.bytes, updatedAt: topic.updatedAt, expiresAt: topic.posts.reduce((latest, post) => Math.max(latest, post.seenAt + cachePolicy.ttlMs), 0) })

/** 原生 IndexedDB；许可核对、正文写入、淘汰与清除都在同一事务内，不使用设置/冷却存储。 */
export function createCacheStore(factory: () => IDBFactory = () => indexedDB, now = () => Date.now()) {
  let connection: Promise<IDBDatabase> | undefined
  const open = () => {
    if (connection) return connection
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      let done = false
      const fail = (error: unknown) => { if (!done) { done = true; clearTimeout(timer); reject(error) } }
      const timer = setTimeout(() => fail(new LocalizedError(message('cache.errorOpenTimeout'))), cachePolicy.storageTimeoutMs)
      try {
        const req = factory().open(CACHE_DB_NAME, 1)
        req.onupgradeneeded = () => { req.result.createObjectStore(META); req.result.createObjectStore(TOPICS) }
        req.onblocked = () => fail(new LocalizedError(message('cache.errorBlocked')))
        req.onerror = () => fail(req.error ?? new LocalizedError(message('cache.errorUnavailable')))
        req.onsuccess = () => {
          if (done) { req.result.close(); return }
          done = true; clearTimeout(timer)
          req.result.onversionchange = () => { req.result.close(); connection = undefined }
          resolve(req.result)
        }
      } catch (error) { fail(error) }
    })
    connection = pending
    void pending.catch(() => { if (connection === pending) connection = undefined })
    return pending
  }
  const transaction = async <T>(work: (tx: IDBTransaction, clock: number) => Promise<T>): Promise<T> => {
    const db = await open(), clock = now()
    if (!integer(clock)) throw new LocalizedError(message('cache.errorClock'))
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction([META, TOPICS], 'readwrite')
      let result: T, failure: unknown
      const abort = (error: unknown) => { failure = error; try { tx.abort() } catch { reject(error) } }
      const timer = setTimeout(() => abort(new LocalizedError(message('cache.errorTransactionTimeout'))), cachePolicy.storageTimeoutMs)
      tx.oncomplete = () => { clearTimeout(timer); resolve(result) }
      tx.onabort = () => { clearTimeout(timer); reject(failure ?? tx.error ?? new LocalizedError(message('cache.errorTransaction'))) }
      void work(tx, clock).then(value => { result = value }, abort)
    })
  }
  const readControl = async (tx: IDBTransaction) => control(await request(tx.objectStore(META).get(CONTROL)))
  const putControl = (tx: IDBTransaction, value: Control) => tx.objectStore(META).put(value, CONTROL)
  const clear = (tx: IDBTransaction) => { tx.objectStore(TOPICS).clear(); putControl(tx, empty()) }
  const prune = (tx: IDBTransaction, c: Control, clock: number) => {
    c.topics = c.topics.filter(t => {
      if (t.updatedAt <= clock && t.expiresAt > clock) return true
      tx.objectStore(TOPICS).delete(t.topicId); return false
    })
  }
  return {
    async status(origin: string, accountId: number | null) {
      return transaction(async (tx, clock) => {
        const c = await readControl(tx)
        if (c.consent && (c.consent.origin !== origin || c.consent.accountId !== accountId)) { clear(tx); return { consent: null, revoked: true } }
        prune(tx, c, clock)
        if (c.consent) putControl(tx, c)
        return { consent: c.consent, revoked: false }
      })
    },
    async enable(identity: CacheIdentity): Promise<CacheConsent> {
      if (!isId(identity.accountId)) throw new LocalizedError(message('cache.errorAccount'))
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      const consent = { origin: identity.origin, accountId: identity.accountId, token: [...bytes].map(n => n.toString(16).padStart(2, '0')).join('') }
      return transaction(async tx => {
        const c = await readControl(tx)
        if (c.consent?.origin === identity.origin && c.consent.accountId === identity.accountId) return c.consent
        clear(tx); putControl(tx, { consent, topics: [] }); return consent
      })
    },
    async disable() { await transaction(async tx => { clear(tx) }) },
    async read(scope: CacheScope, consent: CacheConsent, stream?: readonly number[]) {
      return transaction(async (tx, clock) => {
        const c = await readControl(tx)
        if (!same(c.consent, consent)) return { active: false, topic: undefined, discarded: false }
        prune(tx, c, clock)
        let topic: CachedTopic | undefined, discarded = false
        const raw = await request(tx.objectStore(TOPICS).get(scope.topicId))
        try {
          topic = inspectTopic(raw, scope, clock)
          discarded = !!raw && topic?.posts.length !== (raw as CachedTopic).posts.length
          if (topic && stream) {
            const allowed = new Set(stream)
            topic = mergeCachedTopic(scope, undefined, topic.posts.filter(p => allowed.has(p.id)), topic.updatedAt).topic
          }
        } catch { discarded = true }
        c.topics = c.topics.filter(t => t.topicId !== scope.topicId)
        if (topic?.posts.length) { tx.objectStore(TOPICS).put(topic, scope.topicId); c.topics.push(summarize(topic)) }
        else tx.objectStore(TOPICS).delete(scope.topicId)
        putControl(tx, c)
        return { active: true, topic, discarded }
      })
    },
    async write(scope: CacheScope, consent: CacheConsent, incoming: readonly CachedPost[], stream?: readonly number[]) {
      return transaction(async (tx, clock) => {
        const c = await readControl(tx)
        if (!same(c.consent, consent)) return { active: false, saved: 0, limited: false, discarded: false }
        prune(tx, c, clock)
        let previous: CachedTopic | undefined, discarded = false
        const raw = await request(tx.objectStore(TOPICS).get(scope.topicId))
        try { previous = inspectTopic(raw, scope, clock) } catch { discarded = true }
        if (previous && stream) { const allowed = new Set(stream); previous.posts = previous.posts.filter(p => allowed.has(p.id)) }
        const { topic, limited } = mergeCachedTopic(scope, previous, incoming, clock)
        c.topics = c.topics.filter(t => t.topicId !== scope.topicId)
        if (topic.posts.length) { tx.objectStore(TOPICS).put(topic, scope.topicId); c.topics.push(summarize(topic)) }
        else tx.objectStore(TOPICS).delete(scope.topicId)
        c.topics.sort((a, b) => a.updatedAt - b.updatedAt || (a.topicId === scope.topicId ? 1 : b.topicId === scope.topicId ? -1 : a.topicId - b.topicId))
        while (c.topics.length > cachePolicy.maxTopics || c.topics.reduce((sum, t) => sum + t.bytes, 0) > cachePolicy.totalBytes) tx.objectStore(TOPICS).delete(c.topics.shift()!.topicId)
        putControl(tx, c)
        return { active: true, saved: topic.posts.length, limited, discarded }
      })
    },
  }
}
export type CacheStore = ReturnType<typeof createCacheStore>
