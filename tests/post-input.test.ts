// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { hasBody, hasContent, MAX_COOKED, MAX_STREAM, parsePost, parseStream } from '../src/core/post-input'
import { MAX_TEXT, mergePosts } from '../src/core/phrases'

const ctx = { topicId: 7, origin: 'https://forum.example' }
const raw = (extra: Record<string, unknown> = {}) => ({ id: 101, post_number: 2, username: 'reader', cooked: '<p>一心一意</p>', ...extra })

describe('外部帖子信任边界', () => {
  it('只接收白名单字段，身份、HTML 与展示文本分开', () => {
    const post = parsePost(raw({ topic_id: 7, origin: 'https://other.example', text: '伪造文本', raw: '伪造原文', postNumber: 99, replyToPostNumber: 99 }), ctx)
    expect(post).toMatchObject({ id: 101, postNumber: 2, topicId: 7, origin: ctx.origin, raw: '<p>一心一意</p>', text: '一心一意' })
    expect(post?.replyToPostNumber).toBeUndefined()
  })

  it.each([null, undefined, false, 1, 'post', []])('拒绝非记录输入 %j', value => {
    expect(parsePost(value, ctx)).toBeNull()
  })

  it.each([0, -1, 1.5, Number.NaN, Infinity, 2 ** 53, '101', true])('拒绝非正安全整数 ID/楼层 %s', value => {
    expect(parsePost(raw({ id: value }), ctx)).toBeNull()
    expect(parsePost(raw({ post_number: value }), ctx)).toBeNull()
  })

  it('不猜测缺失的楼层号，不接受主题冲突或非允许 ID', () => {
    expect(parsePost({ id: 101, cooked: '' }, ctx)).toBeNull()
    for (const topic_id of [8, '7', null]) expect(parsePost(raw({ topic_id }), ctx)).toBeNull()
    expect(parsePost(raw(), { ...ctx, topicId: 0 })).toBeNull()
    expect(parsePost(raw(), { ...ctx, allowIds: new Set([102]) })).toBeNull()
    expect(parsePost(raw(), { ...ctx, allowIds: new Set([101]) })?.id).toBe(101)
  })

  it('回复字段严格区分未知、null 和已知楼层', () => {
    expect(parsePost(raw(), ctx)).not.toHaveProperty('replyToPostNumber')
    expect(parsePost(raw({ reply_to_post_number: undefined }), ctx)).not.toHaveProperty('replyToPostNumber')
    expect(parsePost(raw({ reply_to_post_number: null }), ctx)?.replyToPostNumber).toBeNull()
    expect(parsePost(raw({ reply_to_post_number: 1 }), ctx)?.replyToPostNumber).toBe(1)
    for (const value of [0, -1, 1.5, '1', false]) expect(parsePost(raw({ reply_to_post_number: value }), ctx)).toBeNull()
  })

  it('空正文是空观测，非字符串拒绝；不猜造用户名、时间和点赞事实', () => {
    for (const cooked of ['', null, undefined]) expect(parsePost(raw({ cooked }), ctx)).toMatchObject({ raw: '', text: '' })
    for (const cooked of [3, {}, []]) expect(parsePost(raw({ cooked }), ctx)).toBeNull()
    expect(parsePost(raw({ username: '  ', created_at: 'not-a-date', like_count: -1 }), ctx)).toMatchObject({ username: '未知用户', createdAt: '' })
    expect(parsePost(raw({ like_count: '9' }), ctx)).not.toHaveProperty('likeCount')
    expect(parsePost(raw({ username: '  reader  ', created_at: '2026-10-01T00:00:00Z', like_count: 0 }), ctx)).toMatchObject({ username: 'reader', createdAt: '2026-10-01T00:00:00Z', likeCount: 0 })
    expect(parsePost(raw({ username: '甲'.repeat(150) }), ctx)?.username).toHaveLength(100)
  })

  it('异常字段访问只拒绝该楼，不抛异常', () => {
    const hostile = { get id() { throw new Error('bad field') } }
    expect([raw(), hostile, raw({ id: 102 })].map(p => parsePost(p, ctx)?.id ?? null)).toEqual([101, null, 102])
  })

  it('超限不返回截断帖子，临界完整文本可以接受', () => {
    expect(parsePost(raw({ cooked: '甲'.repeat(MAX_COOKED + 1) }), ctx)).toBeNull()
    expect(parsePost(raw({ cooked: `<p>${'甲'.repeat(MAX_TEXT + 1)}</p>` }), ctx)).toBeNull()
    expect(parsePost(raw({ cooked: `<p>${'甲'.repeat(MAX_TEXT)}</p>` }), ctx)?.text).toHaveLength(MAX_TEXT)
    // 最后一词决定链头：即使前缀可用，也不能悄悄丢掉真正的帖内末词。
    expect(parsePost(raw({ cooked: `<p>一心一意</p><p>${'甲'.repeat(MAX_TEXT)}</p><p>意气风发</p>` }), ctx)).toBeNull()
  })

  it('stream 过滤且稳定去重，结构错误不伪装为已知空数组', () => {
    expect(parseStream([102, '101', true, 101, 102, -1, 0, 1.5, Infinity])).toEqual([102, 101])
    expect(parseStream([])).toEqual([])
    for (const value of [null, undefined, {}, '101']) expect(parseStream(value)).toBeNull()
    // 所有入口共用的条目上限：超出不截断，整体拒绝
    expect(parseStream(Array.from({ length: MAX_STREAM }, (_, i) => i + 1))).toHaveLength(MAX_STREAM)
    expect(parseStream(Array.from({ length: MAX_STREAM + 1 }, (_, i) => i + 1))).toBeNull()
  })

  it('正文是否有内容：空结构、注释、空白与 &nbsp; 不算；文字、图片、代码、引用算', () => {
    for (const empty of ['', '   ', '<p></p>', '<p> </p>\n<div><br></div>', '<!-- x --><p></p>', '<p>&nbsp;</p>', '<p><span></span></p>', '<script>x</script>', '<style>p{}</style>'])
      expect(hasContent(empty), JSON.stringify(empty)).toBe(false)
    for (const full of ['<p>一心一意</p>', '纯文字', '<p><img src="/x.png" alt=""></p>', '<pre><code>npm i</code></pre>', '<aside class="quote"><blockquote>引用</blockquote></aside>', '<p>&amp;</p>', '<p><svg></svg></p>'])
      expect(hasContent(full), full).toBe(true)
    expect(hasBody(parsePost(raw({ cooked: '<p></p>' }), ctx)!)).toBe(false)
    expect(hasBody(parsePost(raw({ cooked: '<p><img src="/x.png"></p>' }), ctx)!)).toBe(true)
    expect(hasBody(parsePost(raw({ cooked: undefined }), ctx)!)).toBe(false)
  })
})

describe('合法观察的合并', () => {
  it('后来的未知回复不抹掉已经取得的回复事实', () => {
    const api = parsePost(raw({ reply_to_post_number: 1 }), ctx)!
    const store = parsePost(raw(), ctx)!
    expect(mergePosts([api], [store])[0].replyToPostNumber).toBe(1)
  })

  it('纯文本相同但引用 HTML 或上下文变化，仍更新记录', () => {
    const before = parsePost(raw(), ctx)!
    for (const update of [{ raw: '<aside class="quote" data-post="1"></aside><p>一心一意</p>' }, { topicId: 8 }, { origin: 'https://other.example' }]) {
      const incoming = { ...before, ...update }
      expect(mergePosts([before], [incoming])[0]).toEqual(incoming)
    }
    const current = [before]
    expect(mergePosts(current, [{ ...before }])).toBe(current)
  })
})
