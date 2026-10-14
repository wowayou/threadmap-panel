// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
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
