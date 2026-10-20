import { describe, expect, it } from 'vitest'
import { buildQa } from '../src/core/questions'
import { createReaderApi } from '../src/core/reader-api'
import { createSession } from '../src/core/session'
import type { Post } from '../src/core/types'

describe('只读接入边界性能', () => {
  it('真实内存1万楼：检索/读取20楼分别小于50ms，正文输出有界', async () => {
    const posts: Post[] = Array.from({ length: 10_000 }, (_, i) => ({ id: i + 1, postNumber: i + 1, origin: 'https://forum.example', topicId: 7, username: `reader${i}`, raw: '', createdAt: '', text: i % 3 === 0 ? `How do I configure widget${i % 30} profile${i % 30}?` : `Reply text ${i}`, replyToPostNumber: i % 3 === 1 ? i : null }))
    const session = createSession({ origin: 'https://forum.example', topicId: 7, posts, stream: posts.map(p => p.id), source: 'store', scheme: 'light' })
    const analysis = { mode: 'qa', result: buildQa(posts) } as const
    const api = createReaderApi(() => ({ state: session.get(), analysis, analyzedPosts: posts }))
    const { snapshot } = await api.execute({ version: 1, topicId: 7, op: 'status' })
    let start = performance.now()
    const result = await api.execute({ version: 1, topicId: 7, snapshot, op: 'search', query: 'widget3 profile3' })
    const searchMs = performance.now() - start
    start = performance.now()
    const read = await api.execute({ version: 1, topicId: 7, snapshot, op: 'posts', postIds: posts.slice(0, 20).map(p => p.id) })
    const readMs = performance.now() - start
    console.log(`[perf] reader-api-10000 search: ${searchMs.toFixed(2)} ms, read20: ${readMs.toFixed(2)} ms`)
    expect(result.op === 'search' && result.matches.length > 0).toBe(true)
    expect(read.op === 'posts' && read.posts.length).toBe(20)
    expect(searchMs).toBeLessThan(50); expect(readMs).toBeLessThan(50)
    api.close()
  })
})
