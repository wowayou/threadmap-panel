// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createLoader as guardedLoader, type LoadProgress } from '../src/host/loader'
import { MAX_TEXT } from '../src/core/phrases'
import { loadPolicy } from '../src/core/load-policy'
import { MAX_STREAM } from '../src/core/post-input'

// 此文件隔离验证传输契约；真实防过频策略由 load-guard.test.ts 和浏览器场景覆盖。
const createLoader = (fetcher: typeof fetch, origin: string) => guardedLoader(fetcher, origin, { run: (_signal, work) => work(async () => {}) })

const site = 'https://forum.example'
const posts = Array.from({ length: 45 }, (_, i) => ({ id: 80001 + i, post_number: i + 1, topic_id: 7001, cooked: '<p>普通讨论内容，不参与接龙。</p>', username: 'reader', created_at: '2026-09-17T00:00:00Z', reply_to_post_number: null }))
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const topic = (stream = posts) => response({ id: 7001, posts_count: stream.length, post_stream: { posts: stream.slice(0, 4), stream: stream.map(p => p.id) } })

describe('验收：Discourse 只读加载', () => {
  it('仅同源 GET，按数据库 ID 数组串行分批', async () => {
    let active = 0, peak = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      active++; peak = Math.max(peak, active)
      expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', redirect: 'error' })
      expect(init?.body).toBeUndefined()
      expect(String(input)).toMatch(/^https:\/\/forum\.example\/t\/7001/)
      await new Promise(resolve => setTimeout(resolve, 2)); active--
      if (String(input).endsWith('/7001.json')) return topic()
      const ids = new URL(String(input), site).searchParams.getAll('post_ids[]').map(Number)
      expect(ids.length).toBeGreaterThan(0)
      expect(ids.length).toBeLessThanOrEqual(20)
      return response({ post_stream: { posts: posts.filter(p => ids.includes(p.id)) } })
    })
    const result = await createLoader(fetcher, site).load(7001)
    expect(result.posts).toHaveLength(45)
    expect(result.stream).toHaveLength(45)
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(peak).toBe(1)
    expect(result.posts[0]).toMatchObject({ id: 80001, postNumber: 1, origin: site, topicId: 7001, replyToPostNumber: null })
  })

  it('安全：页面的 <base> 或重定向都不能把请求带到其他站点；非法主题编号直接拒绝', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => response({ id: 7001, post_stream: { posts: [], stream: [] } }))
    await createLoader(fetcher, site).load(7001)
    expect(new URL(String(fetcher.mock.calls[0][0])).origin).toBe(site)
    const redirected = Object.defineProperty(response({}), 'url', { value: 'https://evil.example/t/7001.json' })
    await expect(createLoader(vi.fn(async () => redirected), site).load(7001)).rejects.toThrow('重定向')
    for (const bad of [0, -1, 1.5, Number.NaN, 2 ** 60]) await expect(createLoader(fetcher, site).load(bad)).rejects.toThrow('无效')
    const dirty = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('7001.json') ? response({ id: 7001, post_stream: { posts: [], stream: [1, '2;x', -3, 1.5, 4] } }) : response({ post_stream: { posts: [] } }))
    await expect(createLoader(dirty, site).load(7001)).rejects.toThrow('不完整')
    const ids = new URL(String(dirty.mock.calls[1][0])).searchParams.getAll('post_ids[]')
    expect(ids).toEqual(['1', '4'])
  })

  it('已知 stream 与已有帖子时，不请求主题 JSON，只补缺失的 ID', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const ids = new URL(String(input), site).searchParams.getAll('post_ids[]').map(Number)
      return response({ post_stream: { posts: posts.filter(p => ids.includes(p.id)) } })
    })
    const result = await createLoader(fetcher, site).load(7001, { stream: posts.map(p => p.id), knownIds: posts.slice(0, 30).map(p => p.id) })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0][0])).toContain('/t/7001/posts.json')
    expect(result.posts).toHaveLength(15)
  })

  it('取消阻止后续分批请求', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async () => topic())
    await expect(createLoader(fetcher, site).load(7001, { onProgress: () => controller.abort(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([403, 404, 429])('HTTP %i 明确失败且不自动重试', async status => {
    const fetcher = vi.fn(async () => response({}, status))
    await expect(createLoader(fetcher, site).load(7001)).rejects.toThrow(String(status))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('429 带 Retry-After 时告诉用户等多久', async () => {
    const fetcher = vi.fn(async () => response({}, 429, { 'Retry-After': '30' }))
    await expect(createLoader(fetcher, site).load(7001)).rejects.toMatchObject({ status: 429, retryAfter: 30, message: expect.stringContaining('30 秒') })
  })

  it('Cloudflare 人机验证页给出可操作的说明，而不是“没有权限”', async () => {
    const html = (status: number, headers: Record<string, string> = {}) => new Response('<!doctype html><title>Just a moment...</title>', { status, headers: { 'Content-Type': 'text/html; charset=UTF-8', ...headers } })
    for (const res of [html(403), html(503), html(403, { 'cf-mitigated': 'challenge' })]) {
      const error = await createLoader(vi.fn(async () => res.clone()), site).load(7001).catch(e => e)
      expect(error).toMatchObject({ challenge: true, message: expect.stringContaining('人机验证') })
    }
    const plain = await createLoader(vi.fn(async () => response({ errors: ['forbidden'] }, 403)), site).load(7001).catch(e => e)
    expect(plain).toMatchObject({ challenge: false, message: expect.stringContaining('没有权限') })
    const parse = await createLoader(vi.fn(async () => html(200)), site).load(7001).catch(e => e)
    expect(parse).toMatchObject({ challenge: true })
  })

  it('中途失败前的批次已经通过进度回调交出', async () => {
    let calls = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      calls++
      if (calls === 1) return topic()
      if (calls === 2) { const ids = new URL(String(input), site).searchParams.getAll('post_ids[]').map(Number); return response({ post_stream: { posts: posts.filter(p => ids.includes(p.id)) } }) }
      return response({}, 429)
    })
    const seen: number[] = []
    await expect(createLoader(fetcher, site).load(7001, { onProgress: p => seen.push(p.posts.length) })).rejects.toThrow('429')
    expect(seen.at(-1)).toBe(24)
  })

  it('首批已包含全部帖子时不再请求', async () => {
    const fetcher = vi.fn(async () => topic(posts.slice(0, 4)))
    const result = await createLoader(fetcher, site).load(7001)
    expect(result.posts).toHaveLength(4)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('验收：新增数量目标与受控间隔', () => {
  const echo = async (input: RequestInfo | URL) => {
    const url = new URL(String(input)), ids = url.searchParams.getAll('post_ids[]').map(Number)
    return url.pathname.endsWith('/7001.json') ? topic() : response({ posts: posts.filter(p => ids.includes(p.id)) })
  }

  it('已知列表精确请求所选新增数量，已有楼层不消耗新增目标', async () => {
    const fetcher = vi.fn(echo)
    const result = await createLoader(fetcher, site).load(7001, { stream: posts.map(p => p.id), knownIds: [posts[0].id], maxPosts: 7 })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.getAll('post_ids[]').map(Number)).toEqual(posts.slice(1, 8).map(p => p.id))
    expect(result).toMatchObject({ added: 7, target: 7, requests: 1, reason: 'target' })
  })

  it('主题首批超过新增目标时只接纳所选数量，不再补取', async () => {
    const fetcher = vi.fn(echo)
    const result = await createLoader(fetcher, site).load(7001, { maxPosts: 2 })
    expect(result.posts).toHaveLength(2)
    expect(result).toMatchObject({ added: 2, requests: 1, reason: 'target' })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('主题首批已有帖子更新不扣新增额度，随后只补所需数量', async () => {
    const fetcher = vi.fn(echo)
    const result = await createLoader(fetcher, site).load(7001, { knownIds: posts.slice(0, 4).map(p => p.id), maxPosts: 3 })
    expect(result).toMatchObject({ added: 3, requests: 2, reason: 'target' })
    expect(result.posts).toHaveLength(7)
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.getAll('post_ids[]')).toHaveLength(3)
  })

  it.each([0, -1, 1.5, 101, Number.NaN, Infinity])('无效数量 %s 在记账与请求之前拒绝', async maxPosts => {
    const fetcher = vi.fn(echo)
    await expect(createLoader(fetcher, site).load(7001, { maxPosts })).rejects.toThrow('数量或间隔无效')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('间隔约束同样覆盖主题请求到首个补取批次', async () => {
    vi.useFakeTimers()
    const times: number[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL) => { times.push(Date.now()); return echo(input) })
    const task = createLoader(fetcher, site).load(7001, { maxPosts: 25, delayMs: loadPolicy.minIntervalMs })
    await vi.runAllTimersAsync()
    expect((await task).added).toBe(25)
    expect(times).toHaveLength(3)
    expect(times.slice(1).every((time, index) => time - times[index] >= loadPolicy.minIntervalMs)).toBe(true)
  })

  it('数量目标不能扩大5次请求预算；后台冻结后过期不会继续发下一请求', async () => {
    const large = Array.from({ length: 200 }, (_, i) => ({ ...posts[0], id: 90001 + i, post_number: i + 1 }))
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input)), ids = url.searchParams.getAll('post_ids[]').map(Number)
      return url.pathname.endsWith('/7001.json') ? response({ id: 7001, post_stream: { posts: [], stream: large.map(p => p.id) } }) : response({ posts: large.filter(p => ids.includes(p.id)) })
    })
    const result = await createLoader(fetcher, site).load(7001, { maxPosts: 100 })
    expect(result).toMatchObject({ added: 80, target: 100, requests: 5, reason: 'budget' })
    vi.useFakeTimers()
    const delayed = vi.fn(async () => { vi.setSystemTime(Date.now() + loadPolicy.actionTimeoutMs); return topic() })
    await expect(createLoader(delayed, site).load(7001)).rejects.toThrow('时间上限')
    expect(delayed).toHaveBeenCalledOnce()
  })
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('验收：输入归属、真实进度与取消边界', () => {
  const stream = posts.map(p => p.id)
  const echo = async (input: RequestInfo | URL) => {
    const ids = new URL(String(input), site).searchParams.getAll('post_ids[]').map(Number)
    return response({ posts: posts.filter(p => ids.includes(p.id)) })
  }

  it.each([null, [], {}, { id: 7002, post_stream: { posts: [], stream: [] } }, { post_stream: null }, { post_stream: { stream: {}, posts: [] } }, { post_stream: { stream: [] } }, { post_stream: { stream: [], posts: {} } }])('主题 JSON 结构/归属错误不是成功空结果 %#', async body => {
    const fetcher = vi.fn(async () => response(body))
    await expect(createLoader(fetcher, site).load(7001)).rejects.toMatchObject({ name: 'LoadError', status: 200 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([null, [], {}, { posts: {} }, { post_stream: {}, posts: [] }, { post_stream: [] }, { topic_id: 7002, posts: [] }])('分批 JSON 结构/归属错误停止加载 %#', async body => {
    const fetcher = vi.fn(async () => response(body))
    await expect(createLoader(fetcher, site).load(7001, { stream })).rejects.toMatchObject({ name: 'LoadError', status: 200 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('已知空 stream 或全已知不发请求；重复和 stream 外已有 ID 不撑大进度', async () => {
    const fetcher = vi.fn(echo), seen: LoadProgress[] = []
    for (const ids of [[], [stream[0], stream[0]]]) {
      const result = await createLoader(fetcher, site).load(7001, { stream: ids, knownIds: [stream[0], 999], onProgress: p => seen.push(p) })
      expect(result.stream).toEqual([...new Set(ids)])
    }
    expect(fetcher).not.toHaveBeenCalled()
    expect(seen.map(p => [p.loaded, p.total])).toEqual([[0, 0], [1, 1]])
  })

  it('稳定去重，只接受本批 ID；同源但无关/跨主题的额外帖子也不计入进度', async () => {
    const fetcher = vi.fn(async () => response({ posts: [posts[1], posts[1], posts[2], { ...posts[3], topic_id: 7002 }] }))
    const seen: LoadProgress[] = []
    const result = await createLoader(fetcher, site).load(7001, { stream: [stream[1], stream[0], stream[1], stream[2]], knownIds: [stream[0], 999], onProgress: p => seen.push(p) })
    expect(result.stream).toEqual([stream[1], stream[0], stream[2]])
    expect(result.posts.map(p => p.id)).toEqual([stream[1], stream[2]])
    expect(seen.map(p => [p.loaded, p.total])).toEqual([[1, 3], [3, 3]])
  })

  it('漏返一楼：交出合法部分，不能报满或继续请求后续批次', async () => {
    const fetcher = vi.fn(async () => response({ posts: posts.slice(0, 19) }))
    const seen: LoadProgress[] = []
    await expect(createLoader(fetcher, site).load(7001, { stream, onProgress: p => seen.push(p) })).rejects.toThrow('不完整')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(seen.map(p => [p.loaded, p.total, p.posts.length])).toEqual([[0, 45, 0], [19, 45, 19]])
    expect(seen[1].stream).toEqual(stream)
  })

  it.each([
    ['主题冲突', { topic_id: 7002 }], ['非法楼层', { post_number: '2' }],
    ['正文类型', { cooked: {} }], ['正文超限', { cooked: '甲'.repeat(MAX_TEXT + 1) }], ['非法回复', { reply_to_post_number: 0 }],
  ])('单楼%s不污染合法部分', async (_label, patch) => {
    const seen: LoadProgress[] = []
    const fetcher = vi.fn(async () => response({ posts: [posts[0], { ...posts[1], ...patch }] }))
    await expect(createLoader(fetcher, site).load(7001, { stream: stream.slice(0, 2), onProgress: p => seen.push(p) })).rejects.toThrow('已载入的楼层会保留')
    expect(seen[1]).toMatchObject({ loaded: 1, total: 2, posts: [{ id: stream[0] }] })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([{ post_number: 44 }, { topic_id: 7002 }])('同 ID 身份冲突不能最后写入者胜出 %#', async patch => {
    const seen: LoadProgress[] = []
    const fetcher = vi.fn(async () => response({ posts: [posts[0], posts[1], { ...posts[0], ...patch }] }))
    await expect(createLoader(fetcher, site).load(7001, { stream: stream.slice(0, 2), onProgress: p => seen.push(p) })).rejects.toThrow('异常')
    expect(seen[1]).toMatchObject({ loaded: 1, total: 2, posts: [{ id: stream[1] }] })
  })

  it('主题首批已发现超限时直接停下，保留合法部分和 stream，不把异常 ID 当分页再次请求', async () => {
    const seen: LoadProgress[] = []
    const fetcher = vi.fn(async () => response({ id: 7001, post_stream: { stream: stream.slice(0, 2), posts: [posts[0], { ...posts[1], cooked: '甲'.repeat(MAX_TEXT + 1) }] } }))
    await expect(createLoader(fetcher, site).load(7001, { onProgress: p => seen.push(p) })).rejects.toThrow('处理上限')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(seen[0]).toMatchObject({ loaded: 1, total: 2, stream: stream.slice(0, 2), posts: [{ id: stream[0] }] })
  })

  it('整份响应按实际读取字节限制：声明或实际超限都停止，不读完整份，也不自动重试', async () => {
    const limit = loadPolicy.maxResponseBytes, chunk = new Uint8Array(1024 * 1024).fill(32)
    let sent = 0
    const endless = () => new Response(new ReadableStream<Uint8Array>({ pull(c) { sent += chunk.byteLength; c.enqueue(chunk) } }), { headers: { 'Content-Type': 'application/json' } })
    const seen: LoadProgress[] = []
    const fetcher = vi.fn(async () => endless())
    await expect(createLoader(fetcher, site).load(7001, { onProgress: p => seen.push(p) })).rejects.toMatchObject({ name: 'LoadError', message: expect.stringContaining('超过本地处理上限') })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(sent).toBeLessThanOrEqual(limit + 2 * chunk.byteLength)
    expect(seen).toEqual([])
    const declared = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(limit + 1) } }))
    await expect(createLoader(declared, site).load(7001)).rejects.toThrow('超过本地处理上限')
    // 补取批次超限同样停止，已交出的首批保留
    const big = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/posts.json') ? endless() : topic())
    const partial: LoadProgress[] = []
    await expect(createLoader(big, site).load(7001, { onProgress: p => partial.push(p) })).rejects.toThrow('超过本地处理上限')
    expect(big).toHaveBeenCalledTimes(2)
    expect(partial.at(-1)?.posts).toHaveLength(4)
  })

  it('上限内的大响应照常处理；stream 总数超出上限在所有入口都视为异常', async () => {
    const padded = response({ id: 7001, padding: 'x'.repeat(4 * 1024 * 1024), post_stream: { posts: posts.slice(0, 1), stream: [posts[0].id] } })
    const result = await createLoader(vi.fn(async () => padded), site).load(7001, { maxPosts: 1 })
    expect(result.posts.map(p => p.id)).toEqual([posts[0].id])
    const ids = Array.from({ length: MAX_STREAM + 1 }, (_, i) => i + 1)
    const huge = response({ id: 7001, post_stream: { posts: [], stream: ids } })
    await expect(createLoader(vi.fn(async () => huge), site).load(7001)).rejects.toThrow('超过本地处理上限')
    // 调用方传入的已知 stream 超限：发请求前拒绝
    const fetcher = vi.fn(echo)
    await expect(createLoader(fetcher, site).load(7001, { stream: ids, maxPosts: 1 })).rejects.toThrow('超过本地处理上限')
    expect(fetcher).not.toHaveBeenCalled()
    // 恰好等于上限仍可用
    const exact = vi.fn(async () => response({ posts: [posts[0]] }))
    await expect(createLoader(exact, site).load(7001, { stream: [posts[0].id, ...ids.slice(0, MAX_STREAM - 1).map(i => i + 900000)], maxPosts: 1 })).resolves.toMatchObject({ added: 1 })
  })

  it('首批按目标裁剪不改变冲突判定：已选 ID 在目标之外的冲突记录仍被发现', async () => {
    const conflict = () => response({ id: 7001, post_stream: { stream: [posts[0].id, posts[1].id], posts: [posts[0], posts[1], { ...posts[0], post_number: 99 }] } })
    for (const maxPosts of [1, 2, 3]) {
      const seen: LoadProgress[] = []
      await expect(createLoader(vi.fn(async () => conflict()), site).load(7001, { maxPosts, onProgress: p => seen.push(p) }), `maxPosts=${maxPosts}`).rejects.toThrow('异常')
      expect(seen[0].posts.map(p => p.id)).not.toContain(posts[0].id)
    }
    // 目标外、未选中的 ID 即使是坏记录也不解析，不影响已选楼层
    const tail = response({ id: 7001, post_stream: { stream: [posts[0].id, posts[1].id], posts: [posts[0], { ...posts[1], cooked: {} }] } })
    await expect(createLoader(vi.fn(async () => tail), site).load(7001, { maxPosts: 1 })).resolves.toMatchObject({ added: 1, reason: 'target' })
  })

  it('首批很大时只标准化本次可能接纳的条目，不解析用不到的正文', async () => {
    let reads = 0
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: 90001 + i, post_number: i + 1, get cooked() { reads++; return '<p>普通讨论。</p>' } }))
    const res = { ok: true, status: 200, url: '', headers: new Headers(), body: null, text: async () => JSON.stringify({}), json: async () => ({}) } as unknown as Response
    // 用访问器计数只是探针：直接替换解析结果，不声称 HTTP JSON 可以携带访问器
    const parse = vi.spyOn(JSON, 'parse').mockReturnValueOnce({ id: 7001, post_stream: { stream: many.map(p => p.id), posts: many } })
    const result = await createLoader(vi.fn(async () => res), site).load(7001, { maxPosts: 1 })
    parse.mockRestore()
    expect(result.posts).toHaveLength(1)
    expect(reads).toBeLessThanOrEqual(3)
    // 已有楼层的更新仍处理（有界），不占新增额度
    reads = 0
    vi.spyOn(JSON, 'parse').mockReturnValueOnce({ id: 7001, post_stream: { stream: many.map(p => p.id), posts: many } })
    const known = await createLoader(vi.fn(async () => res), site).load(7001, { maxPosts: 1, knownIds: many.slice(0, 500).map(p => p.id) })
    vi.restoreAllMocks()
    expect(known.added).toBe(1)
    expect(known.posts).toHaveLength(loadPolicy.maxPosts + 1)
    expect(reads).toBeLessThanOrEqual((loadPolicy.maxPosts + 1) * 3)
  })

  it('无效 JSON 和网络错误有明确错误而非静默空结果', async () => {
    await expect(createLoader(async () => new Response('{invalid'), site).load(7001)).rejects.toThrow('无法解析')
    const fetcher = vi.fn(async () => { throw new TypeError('fetch failed') })
    await expect(createLoader(fetcher, site).load(7001)).rejects.toThrow('网络异常或重定向被阻止')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('开始前取消，不发请求也不调用进度', async () => {
    const controller = new AbortController(); controller.abort()
    const fetcher = vi.fn(echo), onProgress = vi.fn()
    for (const ids of [undefined, stream]) await expect(createLoader(fetcher, site).load(7001, { stream: ids, signal: controller.signal, onProgress })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled(); expect(onProgress).not.toHaveBeenCalled()
  })

  it('JSON 读取期间取消，迟到的数据不进入进度或后续批次', async () => {
    const controller = new AbortController(), onProgress = vi.fn()
    let push!: ReadableStreamDefaultController<Uint8Array>, pulled = false
    const res = new Response(new ReadableStream<Uint8Array>({ start(c) { push = c }, pull() { pulled = true } }), { headers: { 'Content-Type': 'application/json' } })
    const fetcher = vi.fn(async () => res)
    const task = createLoader(fetcher, site).load(7001, { stream, signal: controller.signal, onProgress })
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(pulled).toBe(true))
    // 响应流本身不随信号结束：读取也必须被取消打断，迟到字节不能入列
    controller.abort()
    try { push.enqueue(new TextEncoder().encode(JSON.stringify({ posts: posts.slice(0, 20) }))); push.close() } catch { /* 已被取消 */ }
    await rejected
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress.mock.calls[0][0].posts).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('批间等待可取消，并移除定时器/监听，合法首批仍已交出', async () => {
    vi.useFakeTimers()
    const controller = new AbortController(), add = vi.spyOn(controller.signal, 'addEventListener'), remove = vi.spyOn(controller.signal, 'removeEventListener')
    const fetcher = vi.fn(echo), seen: LoadProgress[] = []
    const task = createLoader(fetcher, site).load(7001, { stream, signal: controller.signal, delayMs: 500, onProgress: p => seen.push(p) })
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => { expect(seen[1]?.posts).toHaveLength(20); expect(add).toHaveBeenCalledTimes(2) })
    controller.abort()
    await rejected
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(seen[1].posts).toHaveLength(20)
    for (const [, listener] of add.mock.calls) expect(remove).toHaveBeenCalledWith('abort', listener)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('正常等待结束同样移除 abort 监听，串行顺序保持', async () => {
    vi.useFakeTimers()
    const controller = new AbortController(), add = vi.spyOn(controller.signal, 'addEventListener'), remove = vi.spyOn(controller.signal, 'removeEventListener')
    const fetcher = vi.fn(echo)
    const task = createLoader(fetcher, site).load(7001, { stream, signal: controller.signal, delayMs: 500 })
    await vi.runAllTimersAsync()
    expect((await task).posts).toHaveLength(45)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(add).toHaveBeenCalledTimes(5) // 三次请求的取消桥接 + 两次批间等待
    expect(remove).toHaveBeenCalledTimes(5)
    for (const [, listener] of add.mock.calls) expect(remove).toHaveBeenCalledWith('abort', listener)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['headers', 'body'])('超时覆盖 %s，停止且不自动重试', async phase => {
    vi.useFakeTimers()
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const pending = () => new Promise<never>((_resolve, reject) => init!.signal!.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error) }, { once: true }))
      if (phase === 'headers') return pending()
      // 正文流永不结束，也不随请求信号报错：只能靠加载器自己的超时取消读取
      return new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }), { headers: { 'Content-Type': 'application/json' } })
    })
    const task = createLoader(fetcher, site).load(7001)
    const rejected = expect(task).rejects.toThrow('请求超时')
    await vi.advanceTimersByTimeAsync(loadPolicy.requestTimeoutMs)
    await rejected
    await vi.advanceTimersByTimeAsync(loadPolicy.requestTimeoutMs)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('Retry-After 支持 HTTP 日期，非法值不成为负等待时间', async () => {
    const now = Date.now(), date = new Date(now + 3600_000).toUTCString()
    await expect(createLoader(async () => response({}, 429, { 'Retry-After': date }), site).load(7001)).rejects.toMatchObject({ retryAfter: expect.any(Number) })
    const error = await createLoader(async () => response({}, 429, { 'Retry-After': date }), site).load(7001).catch(e => e)
    expect(error.retryAfter).toBeGreaterThanOrEqual(3598)
    for (const value of ['-1', 'bad-date']) await expect(createLoader(async () => response({}, 429, { 'Retry-After': value }), site).load(7001)).rejects.toMatchObject({ retryAfter: undefined })
  })
})

describe('验收：真实 fetch 的重定向边界（仅本机回环）', () => {
  it('来源 A 跳到不同端口的 B 时，B 必须实际收到零次请求', async () => {
    let hits = 0, sourceHits = 0
    const destination = createServer((_req, res) => { hits++; res.end('{}') })
    const source = createServer((_req, res) => { sourceHits++; res.writeHead(302, { Location: `http://127.0.0.1:${(destination.address() as { port: number }).port}/t/7001.json` }); res.end() })
    try {
      destination.listen(0, '127.0.0.1'); await once(destination, 'listening')
      source.listen(0, '127.0.0.1'); await once(source, 'listening')
      const origin = `http://127.0.0.1:${(source.address() as { port: number }).port}`
      await expect(createLoader(fetch, origin).load(7001)).rejects.toThrow('重定向被阻止')
      expect(sourceHits).toBe(1)
      expect(hits).toBe(0)
    } finally {
      await Promise.all([source, destination].map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    }
  })
})
