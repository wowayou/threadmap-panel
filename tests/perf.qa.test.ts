// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildQa } from '../src/core/questions'
import type { Post } from '../src/core/types'

/**
 * 高重复/多引用的合成长帖：jsdom 的 DOMParser 明显慢于浏览器，作为保守上界。
 * 预算与原 1 万楼问答一致，不为通过测试放宽；不代表实站网络或渲染耗时。
 */
const post = (n: number, text: string, extra: Partial<Post> = {}): Post => ({ id: 500000 + n, postNumber: n, username: `u${n % 300}`, createdAt: '', raw: '', text, topicId: 5, origin: 'x', ...extra })
const time = (label: string, f: () => void) => {
  const start = performance.now(); f(); const ms = performance.now() - start
  console.info(`[perf] ${label}: ${ms.toFixed(2)} ms`)
  return ms
}

describe('问答高重复负载', () => {
  it('1 万楼：3000 个高频改写问题、3000 条回复、1000 条引用：构建 < 2 秒，查询 < 50 毫秒', () => {
    const asks = ['脚本怎么安装？', '大佬们，脚本要怎么安装啊', '脚本安装方法是什么？']
    const posts = Array.from({ length: 10000 }, (_, i) => {
      const n = i + 2
      if (i % 10 < 3) return post(n, asks[i % asks.length])
      if (i % 10 < 6) return post(n, '先装扩展，再安装脚本。', { replyToPostNumber: n - 3 })
      if (i % 10 === 6) return post(n, '看说明。', { raw: `<aside class="quote" data-post="${n - 4}" data-topic="5"><blockquote>脚本怎么安装？</blockquote></aside><p>看说明。</p>` })
      return post(n, '感谢分享')
    })
    let qa!: ReturnType<typeof buildQa>
    expect(time('qa-10000-high-repeat-build', () => { qa = buildQa(posts) })).toBeLessThan(2000)
    expect(qa.repeated).toHaveLength(1)
    expect(qa.repeated[0].questionIds).toHaveLength(3000)
    expect(qa.repeated[0].answerIds.length).toBeGreaterThan(3000)
    expect(time('qa-10000-high-repeat-search', () => qa.search('脚本如何安装'))).toBeLessThan(50)
  })
})
