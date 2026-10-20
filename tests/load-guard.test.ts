// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLoadGuard, LOAD_GUARD_KEY, type GuardEnvironment } from '../src/host/load-guard'
import { loadPolicy } from '../src/core/load-policy'
import { createLoader, LoadError } from '../src/host/loader'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T00:00:00Z')) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function environment() {
  const values = new Map<string, string>()
  const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value) }) }
  let busy = false
  const request = vi.fn(async (_name: string, options: { ifAvailable: boolean }, callback: (lock: object | null) => Promise<unknown>) => {
    expect(options.ifAvailable).toBe(true)
    if (busy) return callback(null)
    busy = true
    try { return await callback({}) } finally { busy = false }
  })
  const env: GuardEnvironment = { locks: { request } as unknown as LockManager, storage: () => storage, now: () => Date.now() }
  return { env, storage, values, state: () => JSON.parse(values.get(LOAD_GUARD_KEY)!) as { requests: number[]; pausedUntil: number } }
}

const oneRequest = async (claim: () => Promise<void>) => { await claim(); return 'done' }

describe('防过频：同源协调与持久预算', () => {
  it('实际加载器：主题请求也计账，至少间隔 5 秒，达到 5 个请求即停而不自动续跑', async () => {
    const fixture = environment(), start = Date.now(), times: number[] = []
    const posts = Array.from({ length: 180 }, (_, i) => ({ id: 101 + i, post_number: i + 1, topic_id: 7, cooked: '<p>一心一意</p>' }))
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      times.push(Date.now())
      const url = new URL(String(input))
      const ids = url.searchParams.getAll('post_ids[]').map(Number)
      return new Response(JSON.stringify(url.pathname === '/t/7.json' ? { id: 7, post_stream: { posts: [], stream: posts.map(p => p.id) } } : { posts: posts.filter(p => ids.includes(p.id)) }), { headers: { 'Content-Type': 'application/json' } })
    })
    const task = createLoader(fetcher, 'https://forum.example', createLoadGuard(fixture.env)).load(7)
    await vi.runAllTimersAsync()
    const result = await task
    expect(times.map(time => time - start)).toEqual([0, 5000, 10000, 15000, 20000])
    expect(result.posts).toHaveLength(80)
    expect(result.stream).toHaveLength(180)
    expect(fixture.state().requests).toEqual(times)
    expect(fixture.state().pausedUntil).toBe(Date.now() + loadPolicy.actionCooldownMs)
    await vi.advanceTimersByTimeAsync(2 * loadPolicy.windowMs)
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it('跨实例不并发、不排队；完成后换实例/主题也不能绕过冷却', async () => {
    const fixture = environment(), guard = createLoadGuard(fixture.env)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const first = guard.run(undefined, async claim => { await claim(); await gate })
    await vi.waitFor(() => expect(fixture.state().requests).toHaveLength(1))
    const otherWork = vi.fn(oneRequest)
    await expect(createLoadGuard(fixture.env).run(undefined, otherWork)).rejects.toThrow('另一个标签页')
    expect(otherWork).not.toHaveBeenCalled()
    release(); await first
    await expect(createLoadGuard(fixture.env).run(undefined, otherWork)).rejects.toThrow('冷却')
    await vi.advanceTimersByTimeAsync(loadPolicy.actionCooldownMs)
    expect(otherWork).not.toHaveBeenCalled()
    await createLoadGuard(fixture.env).run(undefined, otherWork)
    expect(otherWork).toHaveBeenCalledOnce()
    expect(fixture.state().requests).toHaveLength(2)
  })

  it('取消仍计入额度，等待可中止且不会在后台自动开始下一个请求', async () => {
    const fixture = environment(), controller = new AbortController()
    let attempted = 0
    const task = createLoadGuard(fixture.env).run(controller.signal, async claim => { await claim(); attempted++; await claim(); attempted++ })
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(attempted).toBe(1))
    controller.abort(); await rejected
    await vi.advanceTimersByTimeAsync(loadPolicy.minIntervalMs * 2)
    expect(attempted).toBe(1)
    expect(fixture.state().requests).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    await expect(createLoadGuard(fixture.env).run(undefined, oneRequest)).rejects.toThrow('冷却')
  })

  it('滚动一小时预算在不同实例间共享，不能按固定整点突发翻倍', async () => {
    const fixture = environment(), now = Date.now()
    fixture.values.set(LOAD_GUARD_KEY, JSON.stringify({ requests: Array.from({ length: 60 }, (_, i) => now - (60 - i) * 3000), pausedUntil: 0 }))
    const work = vi.fn(oneRequest)
    await expect(createLoadGuard(fixture.env).run(undefined, work)).rejects.toThrow('本小时')
    expect(work).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(loadPolicy.windowMs)
    await createLoadGuard(fixture.env).run(undefined, work)
    expect(fixture.state().requests).toHaveLength(1)
  })

  it('即使调用方要求更多，单次许可也不会超过 5 个', async () => {
    const fixture = environment()
    const task = createLoadGuard(fixture.env).run(undefined, async claim => { for (let i = 0; i < 6; i++) await claim() })
    const rejected = expect(task).rejects.toThrow('本次请求预算')
    await vi.runAllTimersAsync(); await rejected
    expect(fixture.state().requests).toHaveLength(5)
  })

  it.each([
    [new LoadError('429', 429, 7200), 7200_000],
    [new LoadError('403', 403), loadPolicy.blockedCooldownMs],
    [new LoadError('401', 401), loadPolicy.blockedCooldownMs],
    [new LoadError('challenge', 503, undefined, true), loadPolicy.blockedCooldownMs],
    [new LoadError('404', 404), loadPolicy.errorCooldownMs],
    [new Error('network'), loadPolicy.errorCooldownMs],
  ])('错误/挑战冷却和 Retry-After 按更长者执行 %#', async (error, duration) => {
    const fixture = environment(), start = Date.now()
    await expect(createLoadGuard(fixture.env).run(undefined, async claim => { await claim(); throw error })).rejects.toBe(error)
    expect(fixture.state().pausedUntil).toBe(start + duration)
    await expect(createLoadGuard(fixture.env).run(undefined, oneRequest)).rejects.toThrow('冷却')
    expect(fixture.state().requests).toHaveLength(1)
  })

  it.each([
    [403, 'text/html', 'challenge'], [503, 'text/html', ''],
    [503, 'application/json', ''], [200, 'text/html', ''], [200, 'application/json', 'challenge'],
  ])('实际加载器：%i %s 的较长 Retry-After 不能被验证/错误分支丢掉', async (status, contentType, mitigated) => {
    const fixture = environment(), start = Date.now()
    const fetcher = vi.fn(async () => new Response(contentType === 'text/html' ? '<html>验证</html>' : '{}', {
      status, headers: { 'Content-Type': contentType, 'Retry-After': '7200', ...(mitigated ? { 'cf-mitigated': mitigated } : {}) },
    }))
    await expect(createLoader(fetcher, 'https://forum.example', createLoadGuard(fixture.env)).load(7)).rejects.toBeInstanceOf(LoadError)
    expect(fixture.state().pausedUntil).toBe(start + 7200_000)
    expect(fetcher).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(loadPolicy.windowMs)
    await expect(createLoadGuard(fixture.env).run(undefined, oneRequest)).rejects.toThrow('冷却')
  })

  it('锁已取得但首个请求前时钟倒退，也不得发放请求许可', async () => {
    const fixture = environment(), sent = vi.fn()
    await expect(createLoadGuard(fixture.env).run(undefined, async claim => {
      vi.setSystemTime(Date.now() - 1000)
      await claim(); sent()
    })).rejects.toThrow('时间')
    expect(sent).not.toHaveBeenCalled()
    expect(fixture.state().requests).toEqual([])
  })

  it('关闭/崩溃前已有保守占位；最后写入失败不能把历史清空重试', async () => {
    const fixture = environment(), start = Date.now()
    fixture.storage.setItem.mockImplementationOnce((key, value) => { fixture.values.set(key, value) })
      .mockImplementationOnce((key, value) => { fixture.values.set(key, value) })
      .mockImplementationOnce(() => { throw new Error('quota') })
    await expect(createLoadGuard(fixture.env).run(undefined, async claim => {
      await claim()
      expect(fixture.state().pausedUntil).toBe(start + loadPolicy.windowMs)
      throw new LoadError('429', 429)
    })).rejects.toThrow('无法可靠保存')
    expect(fixture.state().pausedUntil).toBe(start + loadPolicy.windowMs)
    await expect(createLoadGuard(fixture.env).run(undefined, oneRequest)).rejects.toThrow('冷却')
  })

  it('不支持锁、读写失败、写入无效时不运行请求任务', async () => {
    const fixture = environment(), work = vi.fn(oneRequest)
    await expect(createLoadGuard({ ...fixture.env, locks: undefined }).run(undefined, work)).rejects.toThrow('无法协调')
    await expect(createLoadGuard({ ...fixture.env, storage: () => { throw new Error('denied') } }).run(undefined, work)).rejects.toThrow('无法可靠保存')
    fixture.storage.setItem.mockImplementation(() => {})
    await expect(createLoadGuard(fixture.env).run(undefined, work)).rejects.toThrow('无法可靠保存')
    expect(work).not.toHaveBeenCalled()
  })

  it.each(['{broken', '{}', JSON.stringify({ requests: [Date.parse('2026-10-15T00:00:10Z')], pausedUntil: 0 }), JSON.stringify({ requests: [2, 1], pausedUntil: 0 }), JSON.stringify({ requests: [], pausedUntil: -1 })])('损坏记录或时钟倒退不重置为可请求 %#', async raw => {
    const fixture = environment(), work = vi.fn(oneRequest)
    fixture.values.set(LOAD_GUARD_KEY, raw)
    await expect(createLoadGuard(fixture.env).run(undefined, work)).rejects.toThrow()
    expect(work).not.toHaveBeenCalled()
    expect(fixture.values.get(LOAD_GUARD_KEY)).toBe(raw)
  })

  it('只存时间戳和冷却，不存帖子、站点路径或账号', async () => {
    const fixture = environment()
    await createLoadGuard(fixture.env).run(undefined, oneRequest)
    expect([...fixture.values.keys()]).toEqual([LOAD_GUARD_KEY])
    expect(Object.keys(fixture.state()).sort()).toEqual(['pausedUntil', 'requests'])
  })
})
