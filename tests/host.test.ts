// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/core/session'
import { applyBadges, clearBadges, isOwnMutation } from '../src/host/badges'
import { clearPostCache, readDom, readStore, routeTopicId, topicPermalink } from '../src/host/discourse'

const origin = 'https://forum.example'
const fakeWindow = (model: unknown) => ({ Discourse: { __container__: { lookup: (name: string) => name === 'controller:topic' ? { model } : undefined } } }) as unknown as Window

beforeEach(() => { document.body.innerHTML = ''; clearPostCache() })

describe('Discourse 页面数据', () => {
  it('从 postStream 读到完整 stream 与已加载帖子，不发请求', () => {
    const snap = readStore(7, origin, fakeWindow({ id: 7, postStream: { stream: [11, 12, 13], posts: [{ id: 11, post_number: 1, username: 'a', cooked: '<p>一心一意</p>', reply_to_post_number: null }, { id: 12, post_number: 2, username: 'b', cooked: '<p>意气风发</p>', reply_to_post_number: 1 }] } }))
    expect(snap).toMatchObject({ source: 'store', stream: [11, 12, 13] })
    expect(snap!.posts.map(p => [p.id, p.postNumber, p.text, p.replyToPostNumber])).toEqual([[11, 1, '一心一意', null], [12, 2, '意气风发', 1]])
    expect(snap!.posts[0]).toMatchObject({ topicId: 7, origin })
  })

  it('主题不匹配、结构异常或内部接口报错时视为不可用', () => {
    expect(readStore(7, origin, fakeWindow({ id: 8, postStream: { stream: [1], posts: [] } }))).toBeNull()
    expect(readStore(7, origin, fakeWindow(undefined))).toBeNull()
    expect(readStore(7, origin, { Discourse: { __container__: { lookup: () => { throw new Error('boom') } } } } as unknown as Window)).toBeNull()
    expect(readStore(7, origin, {} as Window)).toBeNull()
  })

  it('内容没变时返回同一个帖子对象', () => {
    const win = fakeWindow({ id: 7, postStream: { stream: [11], posts: [{ id: 11, post_number: 1, username: 'a', cooked: '<p>一心一意</p>' }] } })
    expect(readStore(7, origin, win)!.posts[0]).toBe(readStore(7, origin, win)!.posts[0])
  })

  it('DOM 回退：忽略其他主题的残留楼层、我们自己的标注；回复字段保持未知', () => {
    document.body.innerHTML = `
      <div class="topic-post" data-post-number="1"><article id="post_1" data-post-id="101" data-topic-id="7"><span class="username">a</span><div class="cooked"><button class="threadmap-badge">✓ 接 #9</button><p>一心一意</p></div></article></div>
      <div class="topic-post" data-post-number="2"><article id="post_2" data-post-id="201" data-topic-id="8"><span class="username">b</span><div class="cooked"><p>旧主题</p></div></article></div>`
    const snap = readDom(7, origin)
    expect(snap.posts.map(p => [p.id, p.text])).toEqual([[101, '一心一意']])
    expect(snap.posts[0].replyToPostNumber).toBeUndefined()
  })

  it('路由与跳转链接', () => {
    expect(routeTopicId('/t/some-slug/123/45')).toBe(123)
    expect(routeTopicId('/t/123')).toBe(123)
    expect(routeTopicId('/latest')).toBeNull()
    expect(topicPermalink(123, 9, '/t/some-slug/123/45')).toBe('/t/some-slug/123/9')
    expect(topicPermalink(123, 9, '/t/other/999')).toBe('/t/123/9')
    // 安全：地址栏里的异常 slug 不会被带进跳转地址
    expect(topicPermalink(123, 9, '/t/%2F%2Fevil.example/123')).toBe('/t/123/9')
    expect(topicPermalink(123, 9, '/t/a"onload=x/123')).toBe('/t/123/9')
    expect(routeTopicId('/t/x/99999999999999999999')).toBeNull()
  })
})

describe('原帖标注', () => {
  it('幂等：重复调用不重复插入；移除后清理干净；点击回调带楼层号', () => {
    document.body.innerHTML = `<div data-post-number="3"><article data-post-id="1"><div class="cooked"><p>一心一意</p></div></article></div>`
    const onClick = vi.fn()
    const badges = new Map([[3, { icon: '✓', label: '接 #2 · 同字', tone: 'ok' as const, title: '同字接 #2' }]])
    applyBadges(badges, onClick); applyBadges(badges, onClick)
    const nodes = document.querySelectorAll('.threadmap-badge')
    expect(nodes).toHaveLength(1)
    expect(nodes[0].getAttribute('aria-label')).toContain('第 3 楼')
    ;(nodes[0] as HTMLButtonElement).click()
    expect(onClick).toHaveBeenCalledWith(3)
    applyBadges(new Map(), onClick)
    expect(document.querySelectorAll('.threadmap-badge')).toHaveLength(0)
    applyBadges(badges, onClick); clearBadges()
    expect(document.querySelectorAll('.threadmap-badge')).toHaveLength(0)
  })

  it('只由标注引起的 DOM 变化不触发重算', () => {
    const badge = document.createElement('button'); badge.className = 'threadmap-badge'
    const other = document.createElement('div')
    const record = (added: Node[]) => ({ target: document.body, addedNodes: added, removedNodes: [] }) as unknown as MutationRecord
    expect(isOwnMutation([record([badge])])).toBe(true)
    expect(isOwnMutation([record([badge]), record([other])])).toBe(false)
  })
})

describe('会话状态', () => {
  it('内容不变时不通知订阅者；stream 只在给出时更新', () => {
    const session = createSession({ origin, topicId: 7, posts: [], source: 'dom', scheme: 'light' })
    const listener = vi.fn(); session.subscribe(listener)
    const post = { id: 1, postNumber: 1, username: 'a', createdAt: '', raw: '', text: '一心一意' }
    session.mergePosts([post]); session.mergePosts([{ ...post }])
    expect(listener).toHaveBeenCalledTimes(1)
    session.mergePosts([], { stream: [1, 2], source: 'store' })
    expect(session.get()).toMatchObject({ stream: [1, 2], source: 'store' })
    session.mergePosts([], { source: 'dom' })
    expect(session.get()).toMatchObject({ stream: [1, 2], source: 'store' })
    session.setReading(1); session.setReading(1)
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
