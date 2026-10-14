// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createLoader } from '../src/host/loader'

const site = 'https://forum.example'
const posts = Array.from({ length: 45 }, (_, i) => ({ id: 80001 + i, post_number: i + 1, topic_id: 7001, cooked: '<p>普通讨论内容，不参与接龙。</p>', username: 'reader', created_at: '2026-09-17T00:00:00Z', reply_to_post_number: null }))
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const topic = (stream = posts) => response({ id: 7001, posts_count: stream.length, post_stream: { posts: stream.slice(0, 4), stream: stream.map(p => p.id) } })

describe('验收：Discourse 只读加载', () => {
  it('仅同源 GET，按数据库 ID 数组串行分批', async () => {
    let active = 0, peak = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      active++; peak = Math.max(peak, active)
      expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin' })
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
    await createLoader(dirty, site).load(7001)
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

  it.each([403, 429])('HTTP %i 明确失败且不自动重试', async status => {
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
