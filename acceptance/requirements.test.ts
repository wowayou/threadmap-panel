// @vitest-environment jsdom
/**
 * 验收契约：语义层面的硬性要求。v0.2 起关系推断为链头模型；
 * 早期“与全部历史比对”模型下的条目已按新模型改写，见 docs/implementation-brief.md。
 */
import { describe, expect, it } from 'vitest'
import { formatText } from '../src/i18n'
import { buildChain, defaultChainSettings, siblingsOf } from '../src/core/chain'
import { extractPhrases, htmlToText, mergePosts, normalizePost } from '../src/core/phrases'
import type { Post } from '../src/core/types'

const origin = 'https://forum.example'
const settings = { ...defaultChainSettings, tone: false }
const make = (n: number, text: string, reply?: number): Post => ({
  id: 10000 + n, postNumber: n, username: `reader${n}`, raw: text, text,
  createdAt: new Date(Date.UTC(2026, 8, 17, 8, n)).toISOString(),
  topicId: 7001, origin, replyToPostNumber: reply,
})
const core = [make(21, '川流不息\n息息相关\n关关雎鸠\n咎由自取'), make(22, '讨论积分乐园'), make(23, '取之不尽\n尽力而为\n为所欲为\n为所欲为', 21), make(24, '曲高和寡\n刮目相看\n侃侃而谈\n贪得无厌', 21)]
const full = (posts: Post[]) => ({ stream: posts.map(p => p.id) })
const at = (chain: ReturnType<typeof buildChain>, n: number) => chain.verdicts.get(10000 + n)

describe('验收：文本与短句', () => {
  it('不把普通长句切成四字词', () => {
    expect(extractPhrases('讨论积分乐园')).toHaveLength(0)
    expect(extractPhrases('我们今天讨论这个程序是否可行')).toHaveLength(0)
  })
  it('HTML 保留短句边界，排除引用、代码和链接预览', () => {
    const text = htmlToText('<p>取之不尽</p><p>尽力而为</p><aside class="quote"><p>为所欲为</p></aside><pre>川流不息</pre><code>关关雎鸠</code><aside class="onebox"><p>息息相关</p></aside>')
    expect(extractPhrases(text).map(x => x.value)).toEqual(['取之不尽', '尽力而为'])
  })
  it('未提供 reply 字段为 undefined，明确 null 才是 null', () => {
    expect(normalizePost({ id: 1, post_number: 1, raw: '一心一意' }).replyToPostNumber).toBeUndefined()
    expect(normalizePost({ id: 1, post_number: 1, raw: '一心一意', reply_to_post_number: null }).replyToPostNumber).toBeNull()
  })
  it('DOM 部分观察不能覆盖 API 已知的 Reply 事实', () => {
    const api = normalizePost({ id: 90001, post_number: 24, username: 'api', raw: '曲高和寡', reply_to_post_number: 21, topicId: 7001, origin })
    const dom = normalizePost({ id: 90001, post_number: 24, username: 'api', raw: '曲高和寡', topicId: 7001, origin })
    expect(mergePosts([api], [dom])[0].replyToPostNumber).toBe(21)
  })
})

describe('验收：接龙判断', () => {
  it('#21 末字“取”承接 #23；#22 普通插话不进入接龙', () => {
    const chain = buildChain(core, settings, [], full(core))
    expect(at(chain, 23)).toMatchObject({ parentId: 10021, status: 'continue' })
    expect(at(chain, 22)).toBeUndefined()
  })
  it('#24 同音接 #21，与 #23 构成分叉；平台 Reply 事实保留', () => {
    const chain = buildChain(core, settings, [], full(core))
    expect(at(chain, 24)).toMatchObject({ parentId: 10021, status: 'fork', siblingCount: 1, viaReply: true })
    expect(siblingsOf(at(chain, 24)!, chain)).toEqual([10023])
    expect(core[3].replyToPostNumber).toBe(21)
  })
  it('曲 qǔ 与取 qǔ 同调，要求同调时仍可承接', () => {
    expect(extractPhrases('曲高和寡')[0].entry).toEqual([{ pinyin: 'qu', tone: 3 }])
    expect(at(buildChain(core, { ...settings, tone: true }, [], full(core)), 24)?.parentId).toBe(10021)
  })
  it('只接父帖最后一词，不能偷接帖内中间词', () => {
    const posts = [make(1, '咎由自取\n取之不尽'), make(2, '取之不尽')]
    expect(at(buildChain(posts, settings, [], full(posts)), 2)?.status).toBe('break')
  })
  it('接不上时保留可解释的判断', () => {
    const posts = [make(1, '川流不息'), make(2, '取之不尽')]
    const verdict = at(buildChain(posts, settings, [], full(posts)), 2)!
    expect(verdict).toMatchObject({ parentId: null, status: 'break' })
    expect(formatText('zh-CN', verdict.reason)).toContain('#1')
  })
  it('同音同调的证据强于同音异调', () => {
    const posts = [make(1, '一二三娶'), make(2, '一二三躯'), make(3, '取之不尽')]
    expect(at(buildChain(posts, settings, [], full(posts)), 3)).toMatchObject({ parentId: 10001, evidence: 'same-sound-tone' })
  })
  it('依赖多音字读音的承接不能成为确定关系', () => {
    const posts = [make(1, '一二三重'), make(2, '崇山峻岭')]
    expect(at(buildChain(posts, settings, [], full(posts)), 2)).toMatchObject({ status: 'pending', parentId: 10001 })
  })
  it('无关的首字多音不影响父帖末字的确定读音', () => {
    const posts = [make(1, '重一二辙'), make(2, '哲一二三')]
    expect(at(buildChain(posts, settings, [], full(posts)), 2)?.status).toBe('continue')
  })
  it('帖内接龙遵守当前规则：关闭同音时同音承接算断点', () => {
    const chain = buildChain(core, { ...settings, homophone: false }, [], full(core))
    expect(at(chain, 24)?.innerBreaks).toHaveLength(3)
    expect(at(chain, 24)?.status).toBe('break')
    expect(at(chain, 23)?.parentId).toBe(10021)
  })
  it('帖内多音候选也不能冒充确定承接', () => {
    expect(at(buildChain([make(1, '一二三重\n崇山峻岭')], settings), 1)?.innerBreaks[0].status).toBe('ambiguous')
  })
  it('本帖重复与跨帖复用分别标出', () => {
    expect(at(buildChain(core, settings, [], full(core)), 23)?.repeatOf).toBe(23)
    const posts = [make(1, '咎由自取'), make(2, '咎由自取')]
    expect(at(buildChain(posts, settings, [], full(posts)), 2)?.repeatOf).toBe(1)
  })
  it('数据不完整时不伪称开局或断链', () => {
    const chain = buildChain([make(24, '曲高和寡')], settings)
    expect(at(chain, 24)?.status).toBe('unknown')
  })
})

describe('验收：本地纠正', () => {
  const posts = [make(1, '咎由自取'), make(2, '咎由自取'), make(3, '取之不尽')]
  it('人工指定改变接龙判断', () => {
    expect(at(buildChain(posts, settings, [{ origin, topicId: 7001, childId: 10003, parentId: 10001 }], full(posts)), 3)).toMatchObject({ status: 'manual', parentId: 10001 })
  })
  it('“不算接龙”有别于没有覆盖，且可恢复', () => {
    expect(at(buildChain(posts, settings, [{ origin, topicId: 7001, childId: 10003, parentId: null }], full(posts)), 3)?.status).toBe('excluded')
    expect(at(buildChain(posts, settings, [], full(posts)), 3)?.status).not.toBe('excluded')
  })
  it('站点与主题隔离', () => {
    for (const override of [{ origin: 'https://other.example', topicId: 7001, childId: 10003, parentId: null }, { origin, topicId: 7002, childId: 10003, parentId: null }])
      expect(at(buildChain(posts, settings, [override], full(posts)), 3)?.status).not.toBe('excluded')
  })
  it('不让未来楼层成为父楼', () => {
    expect(at(buildChain(posts, settings, [{ origin, topicId: 7001, childId: 10002, parentId: 10003 }], full(posts)), 2)?.parentId).not.toBe(10003)
  })
})
