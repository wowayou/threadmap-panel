// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPhraseCache, extractPhrases, htmlToText, MAX_COOKED, MAX_NODES, MAX_TEXT, mergePost, PHRASE_CACHE, phraseCacheSize } from '../src/core/phrases'
import { parsePost } from '../src/core/post-input'

afterEach(() => vi.unstubAllGlobals())

describe('有界正文提取', () => {
  it('保留块级和行内边界、空白语义，排除引用/代码/预览/投票', () => {
    const input = '<p> 一心<span>一意</span>\t <b>意气风发</b> </p><div>发奋<br>图强</div><aside class="quote">引用</aside><blockquote>引用</blockquote><pre>代码</pre><code>代码</code><aside class="onebox">预览</aside><div class="poll">投票</div><div class="lightbox-wrapper"><span class="meta">元信息</span></div><script>danger()</script><style>body{}</style>'
    expect(htmlToText(input)).toBe('一心一意 意气风发 \n发奋\n图强')
    expect(htmlToText('<span class="threadmap-badge">一心一意</span>')).toBe('一心一意')
    expect(htmlToText(' \r\n <span>甲</span>\r\n \n<span>乙</span> \r\n')).toBe('甲\n \n乙')
  })

  it('HTML 上限在 DOMParser 之前检查，等于上限仍处理', () => {
    const parse = vi.fn()
    vi.stubGlobal('DOMParser', class { parseFromString = parse })
    expect(() => htmlToText('甲'.repeat(MAX_COOKED + 1))).toThrow('HTML')
    expect(parse).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    expect(htmlToText(`<!--${'x'.repeat(MAX_COOKED - 7)}-->`)).toBe('')
  })

  it('输出上限拒绝而非截断；块级包裹与首尾空白不消耗有效文本预算', () => {
    const text = '甲'.repeat(MAX_TEXT)
    expect(htmlToText(`<p> \n${text} \n</p>`)).toBe(text)
    expect(() => htmlToText(`<p>${text}乙</p>`)).toThrow('文本')
    expect(htmlToText(`<p>${text}</p>${' \n'.repeat(20000)}`)).toBe(text)
    expect(() => htmlToText(`<p>${text}</p>${' \n'.repeat(20000)}乙`)).toThrow('文本')
    expect(htmlToText('')).toBe('')
  })

  it('数千层嵌套无需递归，未闭合 HTML 仍保留可解析内容', () => {
    expect(htmlToText('<span>'.repeat(3000) + '一心一意' + '</span>'.repeat(3000))).toBe('一心一意')
    expect(htmlToText('<p>一心一意<p>意气风发')).toBe('一心一意\n意气风发')
  })

  it('宽树按实际访问节点计预算，不因一次收集所有子节点而绕过上限', () => {
    // HTML parser 会隐式闭合前一个 p；HTML 仍远小于 MAX_COOKED。
    expect(htmlToText('<p>'.repeat(MAX_NODES))).toBe('')
    expect(() => htmlToText('<p>'.repeat(MAX_NODES + 1))).toThrow('节点')
  })

  it('无 DOMParser 时输入和文本上限同样生效', () => {
    vi.stubGlobal('DOMParser', undefined)
    expect(htmlToText('<p>一心一意</p><pre>代码</pre><p>意气风发</p>')).toBe('一心一意\n意气风发')
    expect(htmlToText(`<p>${'甲'.repeat(MAX_TEXT)}</p>`)).toHaveLength(MAX_TEXT)
    expect(() => htmlToText('甲'.repeat(MAX_TEXT + 1))).toThrow('文本')
    expect(() => htmlToText('甲'.repeat(MAX_COOKED + 1))).toThrow('HTML')
  })
})

describe('词组缓存与合并', () => {
  it('词组缓存同时受条数与字符预算限制，可整体释放；命中仍返回同一结果', () => {
    clearPhraseCache()
    const first = extractPhrases('一心一意')
    expect(extractPhrases('一心一意')).toBe(first)
    const long = (i: number) => `${String(i).padStart(6, '0')}${'a'.repeat(19_990)}`
    for (let i = 0; i < 300; i++) extractPhrases(long(i))
    const size = phraseCacheSize()
    expect(size.chars).toBeLessThanOrEqual(PHRASE_CACHE.chars)
    expect(size.entries).toBeLessThan(300)
    // 先进先出：最新的长文本仍命中，最早的短文本已被淘汰
    expect(extractPhrases(long(299))).toBe(extractPhrases(long(299)))
    expect(extractPhrases('一心一意')).not.toBe(first)
    expect(extractPhrases('x'.repeat(PHRASE_CACHE.chars + 1))).toEqual([])
    expect(phraseCacheSize().chars).toBeLessThanOrEqual(PHRASE_CACHE.chars)
    clearPhraseCache()
    expect(phraseCacheSize()).toEqual({ entries: 0, chars: 0 })
  })

  it('只有“本次没看到正文”才沿用旧正文；平台明确给出的空正文替换旧正文', () => {
    const ctx = { topicId: 1, origin: 'https://forum.example' }
    const before = parsePost({ id: 1, post_number: 1, cooked: '<p>旧正文</p>', reply_to_post_number: null }, ctx)!
    const missing = parsePost({ id: 1, post_number: 1 }, ctx)!
    const cleared = parsePost({ id: 1, post_number: 1, cooked: '' }, ctx)!
    expect(mergePost(before, missing)).toMatchObject({ raw: '<p>旧正文</p>', text: '旧正文', replyToPostNumber: null })
    expect(mergePost(before, missing).bodyMissing).toBeUndefined()
    expect(mergePost(before, cleared)).toMatchObject({ raw: '', text: '' })
    expect(mergePost(missing, missing).bodyMissing).toBe(true)
    // 占位之后看到真实正文：缺失标记必须清除，否则无法保存/恢复判断错误
    const real = mergePost(missing, before)
    expect(real).toMatchObject({ raw: '<p>旧正文</p>', text: '旧正文' })
    expect(real).not.toHaveProperty('bodyMissing')
    expect(mergePost(missing, cleared)).not.toHaveProperty('bodyMissing')
  })
})
