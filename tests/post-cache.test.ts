// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cachePolicy, cachePost, inspectTopic, mergeCachedTopic, restoreCachedPosts, type CacheConsent, type CachedTopic } from '../src/core/post-cache'
import { parsePost } from '../src/core/post-input'
import { createSession } from '../src/core/session'
import { readCurrentAccount } from '../src/host/discourse'
import { createTopicCache } from '../src/host/topic-cache'
import type { CacheStore } from '../src/host/cache-store'

const now = 1_800_000_000_000
const scope = { origin: 'https://forum.example', accountId: 7, topicId: 41 }
const consent: CacheConsent = { origin: scope.origin, accountId: scope.accountId, token: 'abcde12345abcde12345' }
const post = (n: number, raw = `<p>第 ${n} 楼正文</p>`) => parsePost({ id: 1000 + n, post_number: n, username: `reader${n}`, cooked: raw, reply_to_post_number: n === 3 ? 2 : null }, scope)!
const entry = (n: number, at = now, raw?: string) => cachePost(post(n, raw), scope, at)!
const topic = (numbers: number[], at = now): CachedTopic => mergeCachedTopic(scope, undefined, numbers.map(n => entry(n, at)), now).topic

class Channel {
  static all = new Set<Channel>()
  onmessage?: (event: { data: unknown }) => void
  constructor() { Channel.all.add(this) }
  postMessage(data: unknown) { for (const c of Channel.all) if (c !== this) c.onmessage?.({ data }) }
  close() { Channel.all.delete(this) }
}
const cleanups: (() => void)[] = []
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubGlobal('BroadcastChannel', Channel) })
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); Channel.all.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
const tick = () => vi.advanceTimersByTimeAsync(0)
function delayedStatus() {
  let resolve!: (value: Awaited<ReturnType<CacheStore['status']>>) => void
  const result = new Promise<Awaited<ReturnType<CacheStore['status']>>>(r => { resolve = r })
  return { status: () => result, resolve }
}
function setup(options: { enabled?: boolean; cached?: CachedTopic; account?: number | null | 'unknown'; status?: CacheStore['status'] } = {}) {
  let account = options.account === 'unknown' ? undefined : options.account === undefined ? 7 : options.account
  let permitted = options.enabled ?? false
  const store: CacheStore = {
    status: vi.fn(options.status ?? (async () => ({ consent: permitted ? consent : null, revoked: false }))),
    enable: vi.fn(async () => { permitted = true; return consent }),
    disable: vi.fn(async () => { permitted = false }),
    read: vi.fn(async () => ({ active: permitted, topic: inspectTopic(options.cached, scope, Date.now()), discarded: false })),
    write: vi.fn(async (_scope, _consent, posts) => ({ active: permitted, saved: posts.length, limited: false, discarded: false })),
  }
  const session = createSession({ origin: scope.origin, topicId: scope.topicId, posts: [], source: 'store', scheme: 'light' })
  const cache = createTopicCache(session, () => account, store)
  cleanups.push(() => cache.destroy())
  return { store, session, cache, account: (value: number | null | undefined) => { account = value } }
}

describe('缓存输入、保留期与容量', () => {
  it('只保存白名单字段，归属不符不能落盘，不保存派生文本或任意额外字段', () => {
    const value = cachePost({ ...post(2), text: '不额外保存派生文本', query: '未发送的输入', cookie: 'not-a-real-cookie' } as ReturnType<typeof post>, scope, now)!
    expect(Object.keys(value).sort()).toEqual(['createdAt', 'id', 'postNumber', 'raw', 'replyToPostNumber', 'seenAt', 'username'])
    expect(JSON.stringify(value)).not.toContain('未发送的输入')
    expect(cachePost({ ...post(1), origin: 'https://other.example' }, scope, now)).toBeNull()
    expect(cachePost({ ...post(1), topicId: 42 }, scope, now)).toBeNull()
    expect(cachePost(parsePost({ id: 1001, post_number: 1 }, scope)!, scope, now)).toBeNull()
  })

  it('不同站点、账号、主题、错误结构或冲突楼号的缓存不恢复', () => {
    const good = topic([1, 2])
    for (const bad of [{ ...good, accountId: 8 }, { ...good, topicId: 42 }, { ...good, origin: 'https://other.example' }, { ...good, posts: {} }, { ...good, posts: [entry(1), entry(1)] }]) expect(() => inspectTopic(bad, scope, now)).toThrow()
    expect(() => inspectTopic({ ...good, posts: Array(cachePolicy.maxPosts + 1).fill(entry(1)) }, scope, now)).toThrow()
  })

  it('过期/未来/非法单楼拒绝；恢复和再次写入不延长未重新观测的楼层时间', () => {
    const good = topic([1, 2])
    const inspected = inspectTopic({ ...good, posts: [entry(1, now - cachePolicy.ttlMs), entry(2, now + 1), entry(3), { ...entry(4), raw: {} }] }, scope, now)!
    expect(inspected.posts.map(p => p.id)).toEqual([1003])
    const old = topic([2], now - 1000)
    const next = mergeCachedTopic(scope, old, [entry(1)], now + 10_000).topic
    expect(next.posts.find(p => p.id === 1002)?.seenAt).toBe(now - 1000)
    expect(inspectTopic(next, scope, now - 1000 + cachePolicy.ttlMs)?.posts.map(p => p.id)).toEqual([1001])
  })

  it('新鲜楼层（含空正文）优先，新 stream 排除已移除的缓存，恢复仍经过正文处理预算', () => {
    const saved = topic([1, 2, 3, 4])
    const restored = restoreCachedPosts(saved, [post(2, '')], [1002, 1003])
    expect(restored.map(p => p.id)).toEqual([1003])
    expect(restored[0]).toMatchObject({ text: '第 3 楼正文', replyToPostNumber: 2, origin: scope.origin, topicId: 41 })
    const invalidBody = { ...saved, posts: [{ ...entry(2), raw: '<p>' + '甲'.repeat(20_001) + '</p>' }] }
    expect(restoreCachedPosts(invalidBody, [])).toEqual([])
  })

  it('较新的明确清空覆盖旧记录后从副本删除；无内容记录不作为缓存恢复', () => {
    const saved = topic([1, 2, 3])
    const cleared = mergeCachedTopic(scope, saved, [entry(2, now + 1, ''), entry(3, now + 1, '<p></p>')], now + 1).topic
    expect(cleared.posts.map(p => p.id)).toEqual([1001])
    // 较旧的清空不能覆盖较新的正文
    expect(mergeCachedTopic(scope, saved, [entry(1, now - 1, '')], now).topic.posts.map(p => p.id)).toEqual([1001, 1002, 1003])
    // 旧版本留下的空壳不恢复
    expect(restoreCachedPosts({ ...saved, posts: [entry(1, now, ''), entry(2)] }, []).map(p => p.id)).toEqual([1002])
  })

  it('数量与估算容量都有上限，优先较新的完整楼层，不截断正文', () => {
    const base = entry(1)
    const many = mergeCachedTopic(scope, undefined, Array.from({ length: cachePolicy.maxPosts + 1 }, (_, i) => ({ ...base, id: 1001 + i, postNumber: i + 1 })), now)
    expect(many.limited).toBe(true); expect(many.topic.posts).toHaveLength(cachePolicy.maxPosts)
    expect(many.topic.posts[0].postNumber).toBe(2)
    const raw = `<aside class="quote">${'甲'.repeat(100_000)}</aside><p>正文</p>`
    const large = mergeCachedTopic(scope, undefined, Array.from({ length: 50 }, (_, i) => entry(i + 1, now, raw)), now)
    expect(large.limited).toBe(true); expect(large.topic.bytes).toBeLessThanOrEqual(cachePolicy.topicBytes)
    expect(large.topic.posts.length).toBeGreaterThan(0); expect(large.topic.posts.length).toBeLessThan(50)
    expect(large.topic.posts.every(p => p.raw === raw)).toBe(true)
  })

  it('明确登录、匿名和适配不可用不能混淆，不从头像或用户名猜账号', () => {
    const win = (user: unknown) => ({ Discourse: { __container__: { lookup: (name: string) => name === 'service:current-user' ? user : undefined } } }) as unknown as Window
    expect(readCurrentAccount(win({ id: 7 }))).toBe(7)
    expect(readCurrentAccount(win(null))).toBeNull()
    for (const value of [undefined, { username: 'reader' }, { id: '7' }, { id: -1 }]) expect(readCurrentAccount(win(value))).toBeUndefined()
    expect(readCurrentAccount({} as Window)).toBeUndefined()
  })
})

describe('会话中的缓存不是实时事实', () => {
  it('晚到恢复不覆盖新的楼层；实时空正文和新 stream 可以删除缓存内容', () => {
    const session = createSession({ origin: scope.origin, topicId: scope.topicId, posts: [post(1)], source: 'store', scheme: 'light' })
    session.restorePosts([post(1, '<p>旧正文</p>'), post(2), post(3)])
    expect(session.get().cachedCount).toBe(2)
    session.mergePosts([post(2, '')], { stream: [1001, 1002] })
    expect(session.get().posts.map(p => p.id)).toEqual([1001, 1002])
    expect(session.get().posts[1].text).toBe('')
    expect(session.get().cachedCount).toBe(0)
  })

  it('清缓存只移除缓存补入的楼层，真实已载入内容继续可用', () => {
    const session = createSession({ origin: scope.origin, topicId: scope.topicId, posts: [post(1)], source: 'store', scheme: 'light' })
    session.restorePosts([post(2), post(3)])
    session.mergePosts([post(2)])
    session.dropCached()
    expect(session.get().posts.map(p => p.id)).toEqual([1001, 1002])
  })
})

describe('缓存生命周期与撤销', () => {
  it('默认不读/写正文，开启后保存真正观察到的楼层', async () => {
    const { cache, store } = setup()
    cache.observe([post(1), post(2)], {}, true); await tick()
    expect(store.read).not.toHaveBeenCalled(); expect(store.write).not.toHaveBeenCalled()
    expect(cache.get().enabled).toBe(false)
    expect(Channel.all.size).toBe(0)
    await cache.enable()
    expect(store.write).toHaveBeenCalledOnce()
    expect(cache.get()).toMatchObject({ enabled: true, busy: false, saved: 2, error: false })
    expect(vi.mocked(store.write).mock.calls[0][2].map(p => p.id)).toEqual([1001, 1002])
  })

  it('账号未知或页面无可读正文时不恢复，也不以开启代替权限检查', async () => {
    const unknown = setup({ account: 'unknown', enabled: true, cached: topic([1, 2]) })
    unknown.cache.observe([post(1)], {}, true); await tick(); await unknown.cache.enable()
    expect(unknown.store.read).not.toHaveBeenCalled(); expect(unknown.store.write).not.toHaveBeenCalled(); expect(unknown.store.enable).not.toHaveBeenCalled()
    const empty = setup({ enabled: true, cached: topic([1, 2]) })
    empty.cache.observe([], {}, true); await tick()
    expect(empty.store.read).not.toHaveBeenCalled()
    expect(empty.session.get().posts).toHaveLength(0)
  })

  it('同账号有可读正文才恢复，缓存旧楼不回写成新时间', async () => {
    const { cache, session, store } = setup({ enabled: true, cached: topic([1, 2, 3]) })
    cache.observe([post(1)], { stream: [1001, 1002, 1003] }, true); await tick()
    expect(session.get().posts).toHaveLength(3); expect(session.get().cachedCount).toBe(2)
    await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs)
    expect(vi.mocked(store.write).mock.calls[0][2].map(p => p.id)).toEqual([1001])
  })

  it('关闭先使本页失效，晚到的数据库读取不能恢复正文', async () => {
    const { cache, session, store } = setup({ enabled: true })
    let release!: (value: Awaited<ReturnType<CacheStore['read']>>) => void
    vi.mocked(store.read).mockImplementation(() => new Promise(resolve => { release = resolve }))
    cache.observe([post(1)], {}, true); await tick()
    expect(store.read).toHaveBeenCalledOnce()
    await cache.disable(); release({ active: true, topic: topic([1, 2, 3]), discarded: false }); await tick()
    expect(session.get().posts.map(p => p.id)).toEqual([1001])
    expect(store.write).not.toHaveBeenCalled()
    expect(cache.get().enabled).toBe(false)
  })

  it('跨页清空同步停止，换账号也清空且不能把旧观测写给新账号', async () => {
    const a = setup({ enabled: true, cached: topic([1, 2]) }), b = setup({ enabled: true, cached: topic([1, 2]) })
    for (const item of [a, b]) item.cache.observe([post(1)], {}, true)
    await tick(); expect(b.session.get().cachedCount).toBe(1)
    await a.cache.disable(); await tick()
    expect(b.cache.get().enabled).toBe(false); expect(b.session.get().cachedCount).toBe(0)
    await b.cache.enable(); b.account(8); b.cache.observe([post(1)], {}, true); await tick(); await b.cache.enable()
    expect(b.cache.get().enabled).toBe(false)
    expect(b.store.disable).toHaveBeenCalled()
    expect(vi.mocked(b.store.enable).mock.calls.every(([identity]) => identity.accountId === 7)).toBe(true)
  })

  it('写入失败可见且不自动反复重试，真实内存数据不丢失', async () => {
    const { cache, session, store } = setup()
    cache.observe([post(1)], {}, true); await tick()
    vi.mocked(store.write).mockRejectedValue(new DOMException('fixture quota', 'QuotaExceededError'))
    await cache.enable()
    expect(cache.get()).toMatchObject({ enabled: true, error: true, busy: false })
    cache.observe([post(2)], {}, true); await vi.advanceTimersByTimeAsync(5000)
    expect(store.write).toHaveBeenCalledOnce(); expect(session.get().posts).toHaveLength(2)
  })

  it('同会话先保存的正文被明确清空后，缓存写入空正文；缺失正文的观测不覆盖、不刷新旧记录', async () => {
    const { cache, session, store } = setup()
    cache.observe([post(1), post(2)], {}, true); await tick()
    await cache.enable()
    expect(vi.mocked(store.write).mock.calls[0][2].find(p => p.id === 1002)?.raw).toBe('<p>第 2 楼正文</p>')
    // 字段缺失（store 占位）：不是新事实，正文和缓存都不变
    const placeholder = parsePost({ id: 1002, post_number: 2, username: 'reader2', reply_to_post_number: null }, scope)!
    expect(placeholder.bodyMissing).toBe(true)
    cache.observe([post(1), placeholder], {}, true); await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(store.write).toHaveBeenCalledOnce()
    expect(session.get().posts.find(p => p.id === 1002)?.text).toBe('第 2 楼正文')
    // 平台明确给出空正文：替换会话与缓存中的旧正文
    cache.observe([post(1), post(2, '')], {}, true); await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(store.write).toHaveBeenCalledTimes(2)
    expect(vi.mocked(store.write).mock.calls[1][2].map(p => [p.id, p.raw])).toEqual([[1002, '']])
    expect(session.get().posts.find(p => p.id === 1002)).toMatchObject({ raw: '', text: '' })
  })

  it('当前页只有空正文占位时不恢复历史楼层；只有图片等非文字正文仍算可读', async () => {
    for (const shown of [post(1, ''), parsePost({ id: 1001, post_number: 1 }, scope)!, post(1, '   ')]) {
      const { cache, session, store } = setup({ enabled: true, cached: topic([1, 2, 3]) })
      cache.observe([shown], { stream: [1001, 1002, 1003] }, true); await tick()
      expect(store.read).not.toHaveBeenCalled()
      expect(session.get().cachedCount ?? 0).toBe(0)
      expect(session.get().posts.map(p => p.id)).toEqual([1001])
      // 后续非页面观测（如加载器）仍然没有正文时也不能打开恢复
      cache.observe([parsePost({ id: 1002, post_number: 2 }, scope)!]); await tick()
      expect(store.read).not.toHaveBeenCalled()
    }
    const image = setup({ enabled: true, cached: topic([1, 2, 3]) })
    image.cache.observe([post(1, '<p><img src="/uploads/x.png" alt=""></p>')], { stream: [1001, 1002, 1003] }, true); await tick()
    expect(image.store.read).toHaveBeenCalledOnce()
    expect(image.session.get().cachedCount).toBe(2)
  })

  it('全部当前正文都被明确清空：清空照常落盘（不被可读门槛挡住），且不恢复、不写新正文', async () => {
    const { cache, session, store } = setup()
    cache.observe([post(1), post(2)], { stream: [1001, 1002] }, true); await tick()
    await cache.enable()
    expect(store.write).toHaveBeenCalledOnce()
    for (const empty of ['', '<p></p>']) {
      vi.mocked(store.write).mockClear()
      cache.observe([post(1, empty), post(2, empty)], {}, true); await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
      expect(store.write, JSON.stringify(empty)).toHaveBeenCalledOnce()
      const [, , records, stream] = vi.mocked(store.write).mock.calls[0]
      expect(records.map(p => [p.id, p.raw])).toEqual([[1001, empty], [1002, empty]])
      expect(stream).toBeUndefined() // 不可读时不按 stream 删减
      cache.observe([post(1), post(2)], {}, true); await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    }
    expect(session.get().cachedCount ?? 0).toBe(0)
  })

  it('不可读时只写清空记录；新正文等页面重新可读后才保存', async () => {
    const { cache, store } = setup()
    cache.observe([post(1), post(2), post(3)], {}, true); await tick()
    await cache.enable(); vi.mocked(store.write).mockClear()
    // 写入窗口内：先观察到第 3 楼被编辑，随后页面所有当前正文都为空
    cache.observe([post(1), post(2), post(3, '<p>编辑后</p>')], {}, true)
    cache.observe([post(1, ''), post(2, ''), post(3, '')].slice(0, 2), {}, true)
    await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(vi.mocked(store.write).mock.calls.flatMap(c => c[2].map(p => p.id)).sort()).toEqual([1001, 1002])
    // 页面重新可读后，保留的编辑才落盘
    vi.mocked(store.write).mockClear()
    cache.observe([post(4)], {}, true); await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(vi.mocked(store.write).mock.calls.flatMap(c => c[2]).find(p => p.id === 1003)?.raw).toBe('<p>编辑后</p>')
  })

  it('占位后才看到真实正文：可以开启并保存；只有元数据变化不刷新正文保留时间', async () => {
    const { cache, store } = setup()
    cache.observe([parsePost({ id: 1001, post_number: 1 }, scope)!], {}, true); await tick()
    cache.observe([post(1)], {}, true); await tick()
    await cache.enable()
    const writes = () => vi.mocked(store.write).mock.calls.flatMap(c => c[2]).filter(p => p.id === 1001)
    expect(writes()).toHaveLength(1)
    expect(writes()[0].seenAt).toBe(now)
    // 一分钟后只有点赞变化、没带正文：元数据更新，正文与 seenAt 不变
    vi.setSystemTime(now + 60_000)
    cache.observe([post(2), parsePost({ id: 1001, post_number: 1, like_count: 9 }, scope)!], {}, true)
    await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(writes().at(-1)).toMatchObject({ raw: '<p>第 1 楼正文</p>', likeCount: 9, seenAt: now })
    // 真正重新看到（编辑后的）正文才刷新 seenAt
    vi.setSystemTime(now + 120_000)
    cache.observe([post(1, '<p>编辑后</p>')], {}, true)
    await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(writes().at(-1)).toMatchObject({ raw: '<p>编辑后</p>', seenAt: now + 120_000 })
  })

  it('从未看到正文的楼不能凭元数据开始保存', async () => {
    const { cache, store } = setup()
    cache.observe([post(1)], {}, true); await tick(); await cache.enable(); vi.mocked(store.write).mockClear()
    cache.observe([post(1), parsePost({ id: 1005, post_number: 5, like_count: 3 }, scope)!], {}, true)
    await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(vi.mocked(store.write).mock.calls.flatMap(c => c[2]).map(p => p.id)).not.toContain(1005)
  })

  it('卸载时排在在途写入之后的清空也会落盘', async () => {
    const { cache, store } = setup()
    cache.observe([post(1), post(2)], {}, true); await tick(); await cache.enable()
    let release!: () => void
    vi.mocked(store.write).mockClear().mockImplementationOnce(async (_scope, _consent, posts) => { await new Promise<void>(r => { release = r }); return { active: true, saved: posts.length, limited: false, discarded: false } })
    cache.observe([post(1, '<p>编辑后</p>'), post(2)], {}, true)
    const first = cache.flush()
    await vi.waitFor(() => expect(store.write).toHaveBeenCalledOnce())
    cache.observe([post(1, ''), post(2)], {}, true)
    cache.destroy()
    release(); await first; await tick(); await tick()
    expect(store.write).toHaveBeenCalledTimes(2)
    expect(vi.mocked(store.write).mock.calls[1][2].map(p => [p.id, p.raw])).toEqual([[1001, '']])
  })

  it.each(['', '<p></p>'])('R7：启动首次快照全是明确清空 %j，不靠后续观察也会落盘', async empty => {
    const { cache, session, store } = setup({ enabled: true, cached: topic([1, 2]) })
    cache.observe([post(1, empty), post(2, empty)], { stream: [1001, 1002] }, true)
    await tick()
    expect(store.read).not.toHaveBeenCalled()
    expect(cache.get().message).toMatchObject({ key: 'cache.unreadable' })
    await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(store.write).toHaveBeenCalledOnce()
    const [identity, token, records, stream] = vi.mocked(store.write).mock.calls[0]
    expect(identity).toEqual(scope); expect(token).toEqual(consent)
    expect(records.map(p => [p.id, p.raw])).toEqual([[1001, empty], [1002, empty]])
    expect(stream).toBeUndefined()
    expect(session.get().cachedCount ?? 0).toBe(0)
    expect(cache.get()).toMatchObject({ enabled: true, busy: false, error: false })
    expect(cache.get().message).toMatchObject({ key: 'cache.unreadable' })
    expect(store.read).not.toHaveBeenCalled(); expect(store.enable).not.toHaveBeenCalled()
  })

  it('R7：延迟许可只补处理会话最新的明确清空，不把留存正文或缺失观测当成新写入', async () => {
    const gate = delayedStatus()
    const { cache, store } = setup({ enabled: true, status: gate.status })
    cache.observe([post(1), post(2), post(3)], { stream: [1001, 1002, 1003, 1004] }, true)
    const missing = (n: number) => parsePost({ id: 1000 + n, post_number: n }, scope)!
    cache.observe([post(1, ''), post(2, '<p></p>'), missing(3), missing(4)], {}, true)
    await vi.advanceTimersByTimeAsync(1000)
    await cache.flush()
    expect(store.read).not.toHaveBeenCalled(); expect(store.write).not.toHaveBeenCalled()
    gate.resolve({ consent, revoked: false })
    await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(store.write).toHaveBeenCalledOnce()
    const [, , records, stream] = vi.mocked(store.write).mock.calls[0]
    expect(records.map(p => [p.id, p.raw])).toEqual([[1001, ''], [1002, '<p></p>']])
    expect(stream).toBeUndefined(); expect(store.read).not.toHaveBeenCalled()
  })

  it.each(['disable', 'destroy', 'account', 'unknown', 'anonymous', 'revoked'] as const)('R7：许可返回前 %s，不得复活启动撤销写入', async boundary => {
    const gate = delayedStatus()
    const { cache, store, account } = setup({ enabled: true, status: gate.status })
    cache.observe([post(1, '')], {}, true)
    if (boundary === 'disable') await cache.disable()
    if (boundary === 'destroy') cache.destroy()
    if (boundary === 'account') account(8)
    if (boundary === 'unknown') account(undefined)
    if (boundary === 'anonymous') account(null)
    gate.resolve({ consent: boundary === 'revoked' ? null : consent, revoked: boundary === 'revoked' })
    await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(store.read).not.toHaveBeenCalled(); expect(store.write).not.toHaveBeenCalled()
    expect(store.enable).not.toHaveBeenCalled(); expect(cache.get().enabled).toBe(false)
  })

  it.each([
    { enabled: false },
    { enabled: true, account: 'unknown' as const },
    { enabled: true, account: null },
  ])('R7：启动清空不能绕过原有授权/账号门槛 %j', async options => {
    const { cache, store } = setup(options)
    cache.observe([post(1, '')], {}, true)
    await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(store.read).not.toHaveBeenCalled(); expect(store.write).not.toHaveBeenCalled()
    expect(store.enable).not.toHaveBeenCalled(); expect(cache.get().enabled).toBe(false)
  })

  it('R7：启动首次只有缺失正文，不当成明确清空写入', async () => {
    const { cache, store } = setup({ enabled: true })
    cache.observe([parsePost({ id: 1001, post_number: 1 }, scope)!], {}, true)
    await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(store.read).not.toHaveBeenCalled(); expect(store.write).not.toHaveBeenCalled()
  })

  it('R7：启动撤销写入失败保持错误可见，不自动重试', async () => {
    const { cache, store } = setup({ enabled: true })
    vi.mocked(store.write).mockRejectedValue(new Error('fixture startup write failure'))
    cache.observe([post(1, '')], {}, true)
    await vi.advanceTimersByTimeAsync(cachePolicy.writeDelayMs + 10)
    expect(cache.get()).toMatchObject({ enabled: true, busy: false, error: true })
    expect(cache.get().message).toMatchObject({ key: 'cache.failed' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.write).toHaveBeenCalledOnce(); expect(store.read).not.toHaveBeenCalled()
  })

  it('R7：启动撤销已入队但延迟写入尚未开始，卸载仍提交撤销', async () => {
    const { cache, store } = setup({ enabled: true })
    cache.observe([post(1, '')], {}, true); await tick()
    expect(store.write).not.toHaveBeenCalled()
    cache.destroy(); await tick()
    expect(store.write).toHaveBeenCalledOnce()
    expect(vi.mocked(store.write).mock.calls[0][2].map(p => [p.id, p.raw])).toEqual([[1001, '']])
    expect(vi.mocked(store.write).mock.calls[0][3]).toBeUndefined()
    expect(store.read).not.toHaveBeenCalled()
  })

  it('保存新楼不会推迟已经恢复的旧缓存到期时间', async () => {
    const { cache, session } = setup({ enabled: true, cached: topic([2], now - cachePolicy.ttlMs + 2000) })
    cache.observe([post(1)], {}, true); await tick()
    expect(session.get().cachedCount).toBe(1)
    await vi.advanceTimersByTimeAsync(2001)
    expect(session.get().cachedCount).toBe(0)
    expect(session.get().posts.map(p => p.id)).toEqual([1001])
  })
})
