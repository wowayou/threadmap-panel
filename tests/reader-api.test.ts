import { describe, expect, it } from 'vitest'
import { buildChain } from '../src/core/chain'
import { buildQa } from '../src/core/questions'
import { createReaderApi, readerLimits, type ReaderSource } from '../src/core/reader-api'
import { createSession } from '../src/core/session'
import type { Post } from '../src/core/types'

const origin = 'https://forum.example'
const post = (n: number, text: string, reply?: number): Post => ({ id: 1000 + n, postNumber: n, origin, topicId: 7, username: `private-user-${n}`, raw: '<b>private raw HTML</b>', text, createdAt: '', replyToPostNumber: reply })
function fixture() {
  const posts = [post(1, 'Topic'), post(2, 'How do I install the script?'), post(3, 'Install the browser extension.', 2), post(4, 'How do I install the script?'), post(5, 'Then install the userscript.', 4)]
  const session = createSession({ origin, topicId: 7, posts, stream: [...posts.map(p => p.id), 9999], scheme: 'light', source: 'store', cachedCount: 1 })
  let analysis: ReaderSource['analysis'] = { mode: 'qa', result: buildQa(posts) }, analyzedPosts = posts, live = true
  const api = createReaderApi(() => live ? { state: session.get(), analysis, analyzedPosts } : undefined)
  return { api, session, setAnalysis: (next: ReaderSource['analysis']) => { analysis = next; analyzedPosts = session.get().posts }, unavailable: () => { live = false } }
}
const status = { version: 1, topicId: 7, op: 'status' }

describe('预留 agent 的内部只读接口', () => {
  it('能力、范围、检索与结构证据可读，不把相似度说成正确答案', async () => {
    const { api } = fixture()
    expect(api.capabilities.operations).toEqual(['status', 'search', 'question', 'posts'])
    expect(Object.isFrozen(api.capabilities)).toBe(true)
    const meta = await api.execute(status)
    expect(meta).toMatchObject({ loaded: 5, total: 6, missing: 1, cachedPosts: 1, trust: 'untrusted-forum-content' })
    const search = await api.execute({ ...status, snapshot: meta.snapshot, op: 'search', query: 'install script', limit: 1 })
    expect(search.op).toBe('search')
    if (search.op !== 'search') throw new Error('wrong response')
    expect(search.matches[0]).toMatchObject({ questionId: 1002, postNumber: 2, replyCount: 2 })
    const question = await api.execute({ ...status, snapshot: meta.snapshot, op: 'question', questionId: 1004, limit: 1 })
    expect(question.op).toBe('question')
    if (question.op !== 'question') throw new Error('wrong response')
    expect(question.hasMore).toBe(true)
    expect(question.replies[0]).toEqual({ postId: 1003, postNumber: 3, evidence: [{ questionId: 1002, kind: 'reply' }], evidenceTruncated: false })
    const next = await api.execute({ ...status, snapshot: meta.snapshot, op: 'question', questionId: 1002, offset: 1, limit: 1 })
    expect(next).toMatchObject({ hasMore: false, replies: [{ postId: 1005 }] })
  })
  it('指定 ID 才返回正文，白名单副本不带用户名/HTML/凭据且不可修改会话', async () => {
    const { api, session } = fixture(), before = session.get()
    const { snapshot } = await api.execute(status)
    const result = await api.execute({ ...status, snapshot, op: 'posts', postIds: [1003, 9999] })
    expect(result.op).toBe('posts')
    if (result.op !== 'posts') throw new Error('wrong response')
    expect(result.posts).toEqual([{ id: 1003, postNumber: 3, text: 'Install the browser extension.', truncated: false }])
    expect(result.missingIds).toEqual([9999])
    expect(JSON.stringify(result)).not.toMatch(/username|private-user|private raw|raw|cookie|token/i)
    result.posts[0].text = 'caller mutation'
    expect(session.get()).toBe(before)
    expect(session.get().posts[2].text).toBe('Install the browser extension.')
  })
  it.each([
    null, [], {}, { ...status, version: 2 }, { ...status, topicId: '7' }, { ...status, op: 'load' }, { ...status, allowLoad: true },
    { ...status, snapshot: 1, op: 'search', query: '' }, { ...status, snapshot: 1, op: 'search', query: 'x'.repeat(121) },
    { ...status, snapshot: 1, op: 'search', query: 'install', limit: 11 }, { ...status, snapshot: 1, op: 'search', query: 'install', endpoint: origin },
    { ...status, snapshot: 1, op: 'posts', postIds: [] }, { ...status, snapshot: 1, op: 'posts', postIds: [1, 1] },
    { ...status, snapshot: 1, op: 'posts', postIds: Array.from({ length: 21 }, (_, i) => i + 1) },
    { ...status, snapshot: 1, op: 'posts', postIds: [true] }, { ...status, snapshot: 1, op: 'question', questionId: 1002, offset: -1 },
    { ...status, snapshot: 1, op: 'question', questionId: 1002, limit: 21 },
  ])('非法/超限请求在本地拒绝：%j', async input => {
    const { api, session } = fixture(), before = session.get()
    await expect(api.execute(input)).rejects.toMatchObject({ name: 'ReaderApiError' })
    expect(session.get()).toBe(before)
  })
  it('主题、数据、分析规则变化使快照失效；语言、阅读位置和配色不影响快照', async () => {
    const { api, session, setAnalysis, unavailable } = fixture()
    const { snapshot } = await api.execute(status)
    session.setReading(2); session.setScheme('dark'); session.setSiteLanguage('en')
    expect((await api.execute(status)).snapshot).toBe(snapshot)
    await expect(api.execute({ ...status, topicId: 8 })).rejects.toMatchObject({ code: 'wrong_topic' })
    session.mergePosts([post(6, 'New content')])
    await expect(api.execute({ ...status, snapshot, op: 'posts', postIds: [1003] })).rejects.toMatchObject({ code: 'stale_snapshot' })
    const updated = (await api.execute(status)).snapshot
    await expect(api.execute({ ...status, snapshot: updated, op: 'search', query: 'install' })).rejects.toMatchObject({ code: 'stale_snapshot' })
    setAnalysis({ mode: 'chain', result: buildChain([]) })
    const now = (await api.execute(status)).snapshot
    await expect(api.execute({ ...status, snapshot: now, op: 'search', query: 'install' })).rejects.toMatchObject({ code: 'mode_unavailable' })
    unavailable(); await expect(api.execute(status)).rejects.toMatchObject({ code: 'unavailable' })
  })
  it('取消与主题销毁后不能继续读取，没有自动重试或恢复', async () => {
    const { api } = fixture(), c = new AbortController()
    const pending = api.execute(status, c.signal); c.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    await expect(api.execute(status, c.signal)).rejects.toMatchObject({ code: 'aborted' })
    api.close(); await expect(api.execute(status)).rejects.toMatchObject({ code: 'unavailable' })
  })
  it('正文的每楼/总量硬上限、缺失/异源 ID 和代理对边界都可观察', async () => {
    const { api, session } = fixture()
    const posts = Array.from({ length: 20 }, (_, i) => post(10 + i, 'x'.repeat(readerLimits.postChars - 1) + '😀'.repeat(200)))
    session.mergePosts([...posts, { ...post(50, 'Must not leak'), origin: 'https://other.example' }])
    const { snapshot } = await api.execute(status)
    const result = await api.execute({ ...status, snapshot, op: 'posts', postIds: posts.map(p => p.id) })
    if (result.op !== 'posts') throw new Error('wrong response')
    expect(result.posts).toHaveLength(20)
    expect(result.posts.reduce((sum, p) => sum + p.text.length, 0)).toBeLessThanOrEqual(readerLimits.totalChars)
    expect(result.posts.every(p => p.truncated && p.text.length <= readerLimits.postChars && !/[\uD800-\uDBFF]$/.test(p.text))).toBe(true)
    expect(await api.execute({ ...status, snapshot, op: 'posts', postIds: [1050] })).toMatchObject({ posts: [], missingIds: [1050] })
  })
})
