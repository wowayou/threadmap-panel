// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildQa, questionText } from '../src/core/questions'
import type { Post } from '../src/core/types'

const make = (n: number, text: string, extra: Partial<Post> = {}): Post => ({ id: 1000 + n, postNumber: n, username: `u${n}`, createdAt: '', raw: `<p>${text}</p>`, text, topicId: 5, ...extra })
const group = (qa: ReturnType<typeof buildQa>, n: number) => qa.clusterOf.get(1000 + n)?.questionIds.map(id => id - 1000)

describe('识别提问', () => {
  it('问号、句末语气词、疑问词都算；陈述、致谢、已解决不算', () => {
    for (const q of ['这个脚本怎么安装？', '脚本要怎么安装啊', '有人知道 API key 去哪里申请吗', 'api key 在哪申请', '帖子被隐藏是什么原因', 'How do I install it?']) expect(questionText(q), q).not.toBe('')
    for (const q of ['今天天气不错', '已经解决了，谢谢大家', '楼上说得对', '好']) expect(questionText(q), q).toBe('')
  })
  it('主楼不当作提问', () => {
    expect(buildQa([make(1, '大家怎么看这个方案？')]).questions.size).toBe(0)
  })
  it('分句长度边界、连续标点、无句末标点和多句过滤保持原语义', () => {
    expect(questionText('怎么？')).toBe('')
    expect(questionText('怎么办？')).toBe('怎么办？')
    const limit = '怎么' + '甲'.repeat(197) + '？'
    expect(questionText(limit)).toBe(limit)
    expect(questionText('甲' + limit)).toBe('')
    expect(questionText('已经解决了，谢谢！脚本怎么安装？！\n普通说明。邀请码在哪里领')).toBe('脚本怎么安装？ 邀请码在哪里领')
    expect(questionText((limit + '\n').repeat(3))).toHaveLength(400)
  })
  it('无后行断言版本与固定的旧分句算法做 4913 个有界差分样本对照', () => {
    // 冻结旧规则作对照，不从被测函数读取正则，避免把错误预期一并更新。
    const previous = (text: string) => text.split(/(?<=[。！？!?；;\n])/u).map(s => s.trim()).filter(s => s.length >= 4 && s.length <= 200)
      .filter(s => !/(已经|搞定|解决了|知道了|会了|明白了|好了|谢谢|感谢)/u.test(s) && (/[?？]/u.test(s) || /[吗么呢嘛][\s~～。.!！…]*$/u.test(s) || /(怎么|怎样|如何|为什么|为啥|咋|能否|能不能|可不可以|有没有|是否|求教|求助|请教|请问|在哪|哪里|哪儿|哪个|什么|多少|几[个天次]|怎么办|啥)/u.test(s) || /^(how|why|what|when|where|which|who|can|could|does|do|is|are|should|will|would)\b/i.test(s))).join(' ').slice(0, 400)
    const parts = ['', '脚本怎么安装', '普通陈述', '已经解决了', 'How do I install it', '能使用吗', '？', '?', '!', '。', ';', '；', '\n', '\r\n', ' ', '🙂', '甲'.repeat(201)]
    for (const a of parts) for (const b of parts) for (const c of parts) expect(questionText(a + b + c)).toBe(previous(a + b + c))
  })
})

describe('重复提问归组', () => {
  const posts = [make(1, '主楼'), make(2, '请问这个脚本怎么安装？'), make(3, '大佬们，脚本要怎么安装啊'), make(4, '脚本安装方法是什么？'), make(5, '这个脚本怎么卸载？'), make(6, '邀请码在哪里领？'), make(7, '怎么获取邀请码'), make(8, '为什么我的帖子被隐藏了？'), make(9, '帖子被隐藏是什么原因'), make(10, '怎么改用户名？')]
  const qa = buildQa(posts)

  it('同一问题的不同说法归为一组，最早的一楼在前', () => {
    expect(group(qa, 3)).toEqual([2, 3, 4])
    expect(group(qa, 7)).toEqual([6, 7])
    expect(group(qa, 9)).toEqual([8, 9])
  })
  it('“怎么安装”与“怎么卸载”不会因为都有“怎么”而归在一起', () => {
    expect(group(qa, 5)).toEqual([5])
    expect(group(qa, 10)).toEqual([10])
  })
  it('重复问题按被问次数排序', () => {
    expect(qa.repeated.map(c => c.questionIds.length)).toEqual([3, 2, 2])
  })
  it('先查再问：换个说法也能查到', () => {
    expect(qa.search('脚本如何安装')[0].cluster.questionIds[0]).toBe(1002)
    expect(qa.search('邀请码')[0].cluster.questionIds[0]).toBe(1006)
    expect(qa.search('完全无关的话题')).toEqual([])
  })
})

describe('高频提问与证据边界', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('高频相同/改写问题不能因所有词都常见而分裂成几百组', () => {
    const text = ['脚本怎么安装？', '大佬们，脚本要怎么安装啊', '脚本安装方法是什么？']
    const qa = buildQa(Array.from({ length: 300 }, (_, i) => make(i + 2, text[i % text.length])))
    expect(qa.repeated).toHaveLength(1)
    expect(qa.repeated[0].questionIds).toHaveLength(300)
    expect(qa.search('脚本如何安装')[0].cluster.questionIds).toHaveLength(300)
  })

  it('明确不同的 HTTP 错误码不能自动合并，搜索也不把冲突代码当同题', () => {
    const qa = buildQa([make(2, '访问论坛返回 HTTP 403 错误，怎么处理？'), make(3, '访问论坛返回 HTTP 429 错误，怎么处理？')])
    expect(group(qa, 2)).toEqual([2])
    expect(group(qa, 3)).toEqual([3])
    expect(qa.search('HTTP 403 报错怎么处理？').map(x => x.cluster.questionIds)).toEqual([[1002]])
  })

  it.each([
    "<aside data-topic='5' data-post='2' class='quote no-group'><blockquote>提问</blockquote></aside>",
    '<ASIDE DATA-TOPIC="5" CLASS="quote" DATA-POST="2"><blockquote>提问</blockquote></ASIDE>',
  ])('引用属性顺序、单引号和标签大小写不影响明确关联 %#', raw => {
    const qa = buildQa([make(2, '脚本怎么安装？'), make(3, '请参考安装说明。', { raw })])
    expect(qa.clusterOf.get(1002)?.answerIds).toEqual([1003])
  })

  it.each([
    '<aside class="quote" data-post="2" data-topic="invalid"></aside>',
    '<!-- <aside class="quote" data-post="2" data-topic="5"></aside> -->',
    '<pre><aside class="quote" data-post="2" data-topic="5"></aside></pre>',
    '<aside data-note="class=\'quote\' data-post=\'2\'" class="notquote"></aside>',
  ])('无效主题、注释/代码和伪属性不能提供引用证据 %#', raw => {
    const qa = buildQa([make(2, '脚本怎么安装？'), make(3, '普通说明。', { raw })])
    expect(qa.clusterOf.get(1002)?.answerIds).toEqual([])
  })

  it('不能把早于提问的帖子关联为该提问的回答', () => {
    const qa = buildQa([make(2, '普通说明。', { replyToPostNumber: 3 }), make(3, '脚本怎么安装？')])
    expect(qa.clusterOf.get(1003)?.answerIds).toEqual([])
  })

  it('关闭近似归组只合并整理后相同的问题，关闭关联不生成回答，搜索仍可用', () => {
    const posts = [make(2, '脚本怎么安装？'), make(3, '脚本怎么安装？'), make(4, '脚本安装方法是什么？'), make(5, '装油猴。', { replyToPostNumber: 2 })]
    const exact = buildQa(posts, { approximate: false, associateReplies: true })
    expect(group(exact, 2)).toEqual([2, 3])
    expect(group(exact, 4)).toEqual([4])
    expect(exact.clusterOf.get(1002)?.answerIds).toEqual([1005])
    expect(exact.search('脚本如何安装').length).toBeGreaterThan(0)
    const unlinked = buildQa(posts, { approximate: true, associateReplies: false })
    expect(group(unlinked, 4)).toEqual([2, 3, 4])
    expect(unlinked.clusters.every(c => c.answerIds.length === 0)).toBe(true)
  })

  it('大量关联回复不重复计入，平台回复和引用同一楼只算一次', () => {
    const quote = '<aside class="quote" data-post="2" data-topic="5"><blockquote>提问</blockquote></aside><p>回答</p>'
    const posts = [make(2, '脚本怎么安装？'), ...Array.from({ length: 400 }, (_, i) => make(i + 3, '回答', { replyToPostNumber: 2, raw: quote }))]
    expect(buildQa(posts).clusterOf.get(1002)?.answerIds).toHaveLength(400)
  })
})

describe('关联回答', () => {
  it('平台回复与引用都算回答，按点赞排序；提问者自己的回复与其他主题的引用不算', () => {
    const posts = [
      make(1, '主楼'),
      make(2, '脚本怎么安装？'),
      make(3, '装油猴，再点安装链接', { replyToPostNumber: 2, likeCount: 1 }),
      make(4, '看 README 就行', { raw: '<aside class="quote no-group" data-username="u2" data-post="2" data-topic="5"><blockquote>脚本怎么安装？</blockquote></aside><p>看 README 就行</p>', likeCount: 5 }),
      make(5, '我自己补充一下', { username: 'u2', replyToPostNumber: 2 }),
      make(6, '别的帖子', { raw: '<aside class="quote" data-post="2" data-topic="999"></aside><p>别的帖子</p>' }),
      make(7, '脚本要怎么安装啊'),
    ]
    const cluster = buildQa(posts).clusterOf.get(1002)!
    expect(cluster.questionIds).toEqual([1002, 1007])
    expect(cluster.answerIds).toEqual([1004, 1003])
  })
  it('异常输入：超长、未闭合的标签与 HTML 片段不会拖慢或被执行', () => {
    const hostile = '<aside class="quote" data-post="2"' + ' x'.repeat(50000)
    const start = performance.now()
    const qa = buildQa([make(1, '主楼'), make(2, '<img src=x onerror=alert(1)> 怎么办？', { raw: hostile })])
    expect(performance.now() - start).toBeLessThan(500)
    expect(qa.questions.get(1002)).toContain('<img')
  })
  it('1000 楼在可接受时间内完成', () => {
    const texts = ['脚本怎么安装？', '邀请码在哪里领？', '帖子为什么被隐藏？', '顶一下', '感谢分享']
    const posts = Array.from({ length: 1000 }, (_, i) => make(i + 1, `${texts[i % texts.length]} ${i}`))
    const start = performance.now()
    buildQa(posts)
    expect(performance.now() - start).toBeLessThan(3000)
  })
})
