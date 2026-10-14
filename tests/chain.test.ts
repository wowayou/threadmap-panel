// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { badgeFor, buildChain, defaultChainSettings, looksLikeChainTopic, tryPhrase } from '../src/core/chain'
import { chainDemoPosts } from '../src/demo/fixture'
import type { Post } from '../src/core/types'

const origin = 'https://forum.example'
const make = (n: number, text: string, reply?: number | null): Post => ({ id: 50000 + n, postNumber: n, username: `u${n}`, createdAt: '', raw: text, text, topicId: 3, origin, ...(reply !== undefined ? { replyToPostNumber: reply } : {}) })
const at = (chain: ReturnType<typeof buildChain>, n: number) => chain.verdicts.get(50000 + n)!
const ids = (...numbers: number[]) => numbers.map(n => 50000 + n)

describe('链头模型', () => {
  it('旧帖末字碰巧相同不制造歧义：接最近的链头', () => {
    const chain = buildChain([make(1, '咎由自取'), make(2, '取之不尽'), make(3, '尽善尽美'), make(4, '美不胜收'), make(5, '收回成命'), make(6, '命中注定'), make(7, '定国安邦'), make(8, '自食其取'), make(9, '取长补短')])
    expect(at(chain, 9)).toMatchObject({ status: 'continue', parentId: 50008 })
  })

  it('插话不计入接龙，也不打断链', () => {
    const chain = buildChain([make(1, '一心一意'), make(2, '这个帖子是只能用成语吗？'), make(3, '意气风发')])
    expect(chain.verdicts.has(50002)).toBe(false)
    expect(at(chain, 3)).toMatchObject({ status: 'continue', parentId: 50001, skipped: 0 })
  })

  it('接不上为断链，断链帖成为新的链头', () => {
    const chain = buildChain([make(1, '一心一意'), make(2, '海阔天空'), make(3, '空前绝后')])
    expect(at(chain, 2).status).toBe('break')
    expect(at(chain, 3)).toMatchObject({ status: 'continue', parentId: 50002 })
    expect(chain.issues.map(i => i.kind)).toEqual(['break'])
  })

  it('两人接同一楼标为分叉，之后两条链各自延续', () => {
    const chain = buildChain([make(1, '难能可贵'), make(2, '贵在坚持'), make(3, '贵耳贱目'), make(4, '持之以恒'), make(5, '目不转睛')])
    expect(at(chain, 3)).toMatchObject({ status: 'fork', parentId: 50001, siblingIds: [50002] })
    expect(at(chain, 4)).toMatchObject({ status: 'continue', parentId: 50002, skipped: 1 })
    expect(at(chain, 5)).toMatchObject({ status: 'continue', parentId: 50003, skipped: 1 })
    expect(chain.heads.map(h => h.postNumber)).toEqual([5, 4])
  })

  it('未被接走的链头优先；同样可接的其他链头记为“也能接”', () => {
    const chain = buildChain([make(1, '咎由自取'), make(2, '取之不尽'), make(3, '自食其取'), make(4, '取长补短')])
    expect(at(chain, 4)).toMatchObject({ status: 'continue', parentId: 50003 })
    const tie = buildChain([make(1, '咎由自取'), make(2, '自食其取'), make(3, '取长补短')])
    expect(at(tie, 3)).toMatchObject({ parentId: 50002, alternativeIds: [50001] })
  })

  it('平台回复指向且符合规则时以作者意图为准；接不上时按链头规则', () => {
    expect(at(buildChain([make(1, '咎由自取'), make(2, '自食其取'), make(3, '取长补短', 1)]), 3)).toMatchObject({ parentId: 50001, viaReply: true })
    expect(at(buildChain([make(1, '一心一意'), make(2, '咎由自取'), make(3, '取长补短', 1)]), 3)).toMatchObject({ parentId: 50002, viaReply: false })
  })

  it('窗口外才接上为回溯，进入问题列表', () => {
    const filler = ['一心一意', '意气风发', '发奋图强', '强人所难', '难能可贵']
    const chain = buildChain([make(1, '咎由自取'), ...filler.map((t, i) => make(i + 2, t)), make(7, '取长补短')], { ...defaultChainSettings, window: 3 })
    expect(at(chain, 7)).toMatchObject({ status: 'backtrack', parentId: 50001 })
    expect(chain.issues.some(i => i.kind === 'backtrack' && i.postNumber === 7)).toBe(true)
  })

  it('词典里的读音是确定的：虚与委蛇的“蛇”读 yí，接不上“舌”', () => {
    const chain = buildChain([make(1, '故弄玄虚'), make(2, '虚与委蛇'), make(3, '舌战群儒'), make(4, '移花接木')])
    expect(at(chain, 3).status).toBe('break')
    expect(at(chain, 4)).toMatchObject({ status: 'continue', parentId: 50002, evidence: 'same-sound-tone' })
  })

  it('词典外的多音字只能“待确认”，但链继续推进', () => {
    const chain = buildChain([make(1, '尽善尽美'), make(2, '美不胜数'), make(3, '鼠目寸光'), make(4, '光明正大')])
    expect(at(chain, 3)).toMatchObject({ status: 'pending', parentId: 50002 })
    expect(at(chain, 4)).toMatchObject({ status: 'continue', parentId: 50003 })
  })

  it('同字不受多音影响', () => {
    expect(at(buildChain([make(1, '身体力行'), make(2, '行云流水')]), 2)).toMatchObject({ status: 'continue', evidence: 'same-word' })
  })

  it('声调与同音规则切换生效', () => {
    const posts = [make(1, '一心一意'), make(2, '依依不舍')]
    expect(at(buildChain(posts, { ...defaultChainSettings, tone: true }), 2).status).toBe('break')
    expect(at(buildChain(posts, { ...defaultChainSettings, tone: false }), 2)).toMatchObject({ status: 'continue', evidence: 'same-sound-different-tone' })
    expect(at(buildChain([make(1, '一心一意'), make(2, '义无反顾')], { ...defaultChainSettings, homophone: false }), 2).status).toBe('break')
  })

  it('重复词组与帖内断点进入问题列表', () => {
    const chain = buildChain([make(1, '一心一意'), make(2, '意气风发'), make(3, '发奋图强\n海阔天空'), make(4, '空前绝后'), make(5, '一心一意')])
    expect(at(chain, 5).repeatOf).toBe(1)
    expect(at(chain, 3).innerBreaks).toHaveLength(1)
    expect(chain.issues.filter(i => i.kind === 'repeat').map(i => i.postNumber)).toEqual([5])
  })

  it('本地指定与排除；失效或跨主题的指定不生效', () => {
    const posts = [make(1, '咎由自取'), make(2, '自食其取'), make(3, '取长补短')]
    expect(at(buildChain(posts, defaultChainSettings, [{ origin, topicId: 3, childId: 50003, parentId: 50001 }]), 3)).toMatchObject({ status: 'manual', parentId: 50001 })
    const excluded = buildChain(posts, defaultChainSettings, [{ origin, topicId: 3, childId: 50002, parentId: null }])
    expect(at(excluded, 2).status).toBe('excluded')
    expect(at(excluded, 3)).toMatchObject({ status: 'continue', parentId: 50001 })
    const stale = buildChain(posts, defaultChainSettings, [{ origin, topicId: 3, childId: 50003, parentId: 99999 }])
    expect(at(stale, 3)).toMatchObject({ status: 'continue', parentId: 50002 })
    expect(at(stale, 3).reason).toContain('已失效')
    expect(at(buildChain(posts, defaultChainSettings, [{ origin, topicId: 4, childId: 50003, parentId: 50001 }]), 3).parentId).toBe(50002)
    expect(at(buildChain(posts, defaultChainSettings, [{ origin: 'https://other.example', topicId: 3, childId: 50003, parentId: 50001 }]), 3).parentId).toBe(50002)
  })
})

describe('实站写法', () => {
  it('混排与逗号串不再误报断链（linux.do #2915068 的写法）', () => {
    const posts = [make(8, '鼎鼎有名'), make(9, '名扬四海sogasoga，原来如此'), make(10, '海纳百川\n接的很点题嘛（自夸一下'), make(28, '人仰马翻，翻天覆地，低声下气，气冲斗牛'), make(29, '牛气冲天\n应该可以吧，刚好想到了')]
    const chain = buildChain(posts, defaultChainSettings, [], { stream: posts.map(p => p.id) })
    expect(at(chain, 9)).toMatchObject({ status: 'continue', parentId: 50008 })
    expect(at(chain, 10)).toMatchObject({ status: 'continue', parentId: 50009 })
    expect(at(chain, 29)).toMatchObject({ status: 'continue', parentId: 50028 })
  })
})

describe('数据缺口', () => {
  it('第一个载入的接龙帖前面还有楼未载入时，不报“开局”', () => {
    const chain = buildChain([make(5, '一心一意'), make(6, '意气风发')], defaultChainSettings, [], { stream: ids(1, 2, 3, 4, 5, 6) })
    expect(at(chain, 5).status).toBe('unknown')
    expect(at(chain, 6)).toMatchObject({ status: 'continue', parentId: 50005 })
    expect(chain).toMatchObject({ missing: 4, unknownCount: 1 })
    expect(chain.issues).toHaveLength(0)
  })

  it('最近的链头接不上且中间有楼未载入时，不报“断链”', () => {
    const chain = buildChain([make(1, '一心一意'), make(3, '海阔天空')], defaultChainSettings, [], { stream: ids(1, 2, 3) })
    expect(at(chain, 3).status).toBe('unknown')
    expect(chain.issues.filter(i => i.kind === 'break')).toHaveLength(0)
  })

  it('接上了但中间有楼未载入时，照常判断并说明', () => {
    const chain = buildChain([make(1, '一心一意'), make(4, '意气风发')], defaultChainSettings, [], { stream: ids(1, 2, 3, 4, 5) })
    expect(at(chain, 4)).toMatchObject({ status: 'continue', missingBetween: 2 })
    expect(at(chain, 4).reason).toContain('2 楼未载入')
    expect(chain.missingAfterLast).toBe(1)
  })

  it('没有 stream 时用楼层号估计缺口', () => {
    const chain = buildChain([make(21, '咎由自取'), make(23, '取之不尽')])
    expect(at(chain, 21).status).toBe('unknown')
    expect(at(chain, 23)).toMatchObject({ status: 'continue', missingBetween: 1 })
    expect(chain.missing).toBeUndefined()
  })

  it('stream 完整时没有缺口', () => {
    const chain = buildChain([make(1, '一心一意'), make(2, '意气风发')], defaultChainSettings, [], { stream: ids(1, 2) })
    expect(chain).toMatchObject({ missing: 0, missingAfterLast: 0, unknownCount: 0 })
    expect(at(chain, 1).status).toBe('start')
  })
})

describe('试接与主题判断', () => {
  it('试接：能否接当前链头、是否用过、格式是否正确', () => {
    const chain = buildChain([make(1, '一心一意'), make(2, '意气风发')])
    expect(tryPhrase('发奋图强', chain, defaultChainSettings).matches[0].link?.evidence).toBe('same-word')
    expect(tryPhrase('海阔天空', chain, defaultChainSettings).matches[0].link).toBeNull()
    expect(tryPhrase('一心一意', chain, defaultChainSettings).repeatOf).toBe(1)
    expect(tryPhrase('发奋', chain, defaultChainSettings).phrase).toBeUndefined()
    expect(tryPhrase('发奋图强啊', chain, defaultChainSettings).phrase).toBeUndefined()
  })

  it('普通讨论里零星的四字回复不判为接龙主题', () => {
    expect(looksLikeChainTopic(buildChain([make(1, '请问这个插件怎么安装？'), make(2, '谢谢分享'), make(3, '看文档就行。'), make(4, '前排围观'), make(5, '感谢大佬')]))).toBe(false)
    expect(looksLikeChainTopic(buildChain(chainDemoPosts))).toBe(true)
  })

  it('演示主题覆盖各种状态', () => {
    const chain = buildChain(chainDemoPosts)
    const statuses = new Set(chain.order.map(v => v.status))
    for (const status of ['start', 'continue', 'fork', 'pending', 'break'] as const) expect(statuses.has(status)).toBe(true)
    const v23 = chain.verdicts.get(9023)!
    expect(v23).toMatchObject({ parentId: 9021, viaReply: true })
    expect(badgeFor(v23, chain).label).toContain('重复')
    expect(chain.verdicts.has(9022)).toBe(false)
  })

  it('2000 楼长链：线性推进、无误报', () => {
    const words = ['一心一意', '意气风发', '发奋图强', '强人所难', '难能可贵', '贵在坚持', '持之以恒', '恒河沙数', '数一数二', '二话不说', '说一不二', '二者择一']
    const texts: string[] = []
    for (let i = 0; texts.length < 2000; i++) { texts.push(words[i % words.length]); if (i % 7 === 3) texts.push('插话：这一轮好难') }
    const posts = texts.map((text, i) => make(i + 1, text))
    const start = performance.now()
    const chain = buildChain(posts, defaultChainSettings, [], { stream: posts.map(p => p.id) })
    expect(performance.now() - start).toBeLessThan(3000)
    expect(chain.issues.filter(i => i.kind !== 'repeat')).toHaveLength(0)
    expect(chain.linked).toBe(chain.gamePosts - 1)
  })
})
