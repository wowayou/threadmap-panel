// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '../src/core/session'
import { applyBadges, clearBadges, isOwnMutation } from '../src/host/badges'
import { clearPostCache, readDom, readStore, routeTopicId, topicPermalink } from '../src/host/discourse'
import { markOwned, OWNED, OWNER_ATTR } from '../src/host/owner'
import { MAX_COOKED, MAX_STREAM } from '../src/core/post-input'

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
    markOwned(document.querySelector('button')!)
    const snap = readDom(7, origin)
    expect(snap.posts.map(p => [p.id, p.text])).toEqual([[101, '一心一意']])
    expect(snap.posts[0].replyToPostNumber).toBeUndefined()
  })

  it('DOM 正文缺失或为空记为“未观测到正文”，不当成作者清空', () => {
    document.body.innerHTML = `
      <div data-post-number="1"><article data-post-id="101"><span class="username">a</span><div class="cooked"></div></article></div>
      <div data-post-number="2"><article data-post-id="102"><span class="username">b</span></article></div>
      <div data-post-number="3"><article data-post-id="103"><span class="username">c</span><div class="cooked"><p><img src="/x.png" alt=""></p></div></article></div>
      <div data-post-number="4"><article data-post-id="104"><span class="username">d</span><div class="cooked"><p></p><!-- 渲染中 --></div></article></div>`
    const snap = readDom(7, origin)
    expect(snap.posts.map(p => [p.id, !!p.bodyMissing])).toEqual([[101, true], [102, true], [103, false], [104, true]])
    const store = readStore(7, origin, fakeWindow({ id: 7, postStream: { stream: [11, 12], posts: [{ id: 11, post_number: 1, cooked: '' }, { id: 12, post_number: 2 }] } }))!
    expect(store.posts.map(p => [p.id, !!p.bodyMissing])).toEqual([[11, false], [12, true]])
  })

  it('页面 store 的 stream 超过共用上限时不采用，退回页面元素', () => {
    const stream = Array.from({ length: MAX_STREAM + 1 }, (_, i) => i + 1)
    expect(readStore(7, origin, fakeWindow({ id: 7, postStream: { stream, posts: [] } }))).toBeNull()
    expect(readStore(7, origin, fakeWindow({ id: 7, postStream: { stream: stream.slice(0, MAX_STREAM), posts: [] } }))?.stream).toHaveLength(MAX_STREAM)
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

  it('无标题段的数字路由不把楼层当主题，生成的链接能解析回同一主题', () => {
    expect(routeTopicId('/t/123/9')).toBe(123)
    expect(routeTopicId('/t/123/9/')).toBe(123)
    expect(routeTopicId('/t/123/print')).toBe(123)
    expect(routeTopicId('/t/2048/123/9')).toBe(123)
    expect(routeTopicId('/t/%E6%B5%8B%E8%AF%95/7805')).toBe(7805)
    expect(routeTopicId('/t/%E6%B5%8B%E8%AF%95/7805/2')).toBe(7805)
    expect(routeTopicId('/t/only-slug')).toBeNull()
    expect(routeTopicId('/t//123')).toBeNull()
    const routes = ['/t/123', '/t/123/9', '/t/some-slug/123', '/t/some-slug/123/45', '/t/%E6%B5%8B%E8%AF%95/123/4', '/t/2048/123/1', '/t/9/123', '/t/123/123']
    for (const pathname of routes) {
      const topic = routeTopicId(pathname)!
      expect(topic, pathname).not.toBeNull()
      for (const floor of [1, 2, 9, 123, 9999]) expect(routeTopicId(topicPermalink(topic, floor, pathname)), `${pathname} → #${floor}`).toBe(topic)
    }
  })
})

describe('原帖标注', () => {
  it('标注焦点色跟随强调色写在自有节点上；没有强调色时移除，回退默认色', () => {
    document.body.innerHTML = `<div data-post-number="3"><article data-post-id="1"><div class="cooked"><p>一心一意</p></div></article></div>`
    const badge = { icon: '✓', label: '接 #2', tone: 'ok' as const, title: '' }
    applyBadges(new Map([[3, badge]]), vi.fn(), document, 'dark', '#24b6ff')
    const node = document.querySelector<HTMLElement>(OWNED)!
    expect(node.style.getPropertyValue('--threadmap-accent')).toBe('#24b6ff')
    expect(document.querySelector('article')!.getAttribute('style')).toBeNull()
    applyBadges(new Map([[3, badge]]), vi.fn(), document, 'dark')
    expect(node.style.getPropertyValue('--threadmap-accent')).toBe('')
    clearBadges()
  })

  it('幂等：重复调用不重复插入；移除后清理干净；点击回调带楼层号', () => {
    document.body.innerHTML = `<div data-post-number="3"><article data-post-id="1"><div class="cooked"><p>一心一意</p></div></article></div>`
    const onClick = vi.fn()
    const badges = new Map([[3, { icon: '✓', label: '接 #2 · 同字', tone: 'ok' as const, title: '同字接 #2' }]])
    applyBadges(badges, onClick); applyBadges(badges, onClick)
    const nodes = document.querySelectorAll('.threadmap-badge')
    expect(nodes).toHaveLength(1)
    expect(nodes[0].getAttribute('aria-label')).toContain('#3')
    ;(nodes[0] as HTMLButtonElement).click()
    expect(onClick).toHaveBeenCalledWith(3)
    applyBadges(new Map(), onClick)
    expect(document.querySelectorAll('.threadmap-badge')).toHaveLength(0)
    applyBadges(badges, onClick); clearBadges()
    expect(document.querySelectorAll('.threadmap-badge')).toHaveLength(0)
  })

  it('只有令牌匹配的标注变化可忽略，同名类与混合变化必须重读', () => {
    const badge = document.createElement('button'); badge.className = 'threadmap-badge'
    const other = document.createElement('div')
    const record = (added: Node[]) => ({ target: document.body, addedNodes: added, removedNodes: [] }) as unknown as MutationRecord
    expect(isOwnMutation([record([badge])])).toBe(false)
    badge.setAttribute(OWNER_ATTR, 'not-current-token')
    expect(isOwnMutation([record([badge])])).toBe(false)
    markOwned(badge)
    expect(isOwnMutation([record([badge])])).toBe(true)
    expect(isOwnMutation([record([badge]), record([other])])).toBe(false)
    expect(isOwnMutation([record([badge, other])])).toBe(false)
    const text = document.createTextNode('标注'); badge.append(text)
    expect(isOwnMutation([{ target: text, addedNodes: [], removedNodes: [] } as unknown as MutationRecord])).toBe(true)
    expect(isOwnMutation([{ target: document.body, addedNodes: [], removedNodes: [badge] } as unknown as MutationRecord])).toBe(true)
  })

  it('不复用/改写/清理同名正文按钮，虚拟楼层复用时点击使用新楼层号', () => {
    document.body.innerHTML = '<div data-post-number="3"><article data-post-id="101"><div class="cooked"><button class="threadmap-badge">正文按钮</button><p>一心一意</p></div></article></div>'
    const original = document.querySelector('button')!, originalHtml = original.outerHTML
    const onClick = vi.fn(), nativeClick = vi.fn(); original.addEventListener('click', nativeClick)
    const badge = { icon: '✓', label: '接 #2', tone: 'ok' as const, title: '判断' }
    applyBadges(new Map([[3, badge]]), onClick)
    expect(original.outerHTML).toBe(originalHtml)
    expect(document.querySelectorAll(OWNED)).toHaveLength(1)
    original.click(); expect(nativeClick).toHaveBeenCalledOnce(); expect(onClick).not.toHaveBeenCalled()
    document.querySelector<HTMLElement>('[data-post-number]')!.dataset.postNumber = '4'
    applyBadges(new Map([[4, badge]]), onClick)
    ;(document.querySelector(OWNED) as HTMLButtonElement).click()
    expect(onClick).toHaveBeenCalledWith(4)
    clearBadges()
    expect(document.querySelectorAll(OWNED)).toHaveLength(0)
    expect(original.isConnected).toBe(true)
    expect(original.outerHTML).toBe(originalHtml)
  })
})

describe('宿主输入与归属边界', () => {
  const post = (id = 11, extra: Record<string, unknown> = {}) => ({ id, post_number: id - 10, username: 'reader', cooked: '<p>一心一意</p>', ...extra })
  const store = (posts: unknown, stream: unknown = [11, 12]) => fakeWindow({ id: 7, postStream: { posts, stream } })

  it('坏条目与坏字段访问不使合法 store 帖子丢失，stream 不强制转换且稳定去重', () => {
    const snap = readStore(7, origin, store([post(), null, 3, { get id() { throw new Error('bad field') } }, post(99, { topic_id: 8 }), post(13, { cooked: 2 }), post(12)], [11, 12, '13', true, 11, -1]))!
    expect(snap.stream).toEqual([11, 12])
    expect(snap.posts.map(p => p.id)).toEqual([11, 12])
    expect(snap.posts[0]).not.toHaveProperty('replyToPostNumber')
  })

  it('支持明确的 toArray 容器；容器/stream 错误才使 store 不可用', () => {
    expect(readStore(7, origin, store({ toArray: () => [post()] }))?.posts).toHaveLength(1)
    for (const value of [{}, 3, { toArray: () => ({}) }, { toArray: () => { throw new Error('unavailable') } }]) expect(readStore(7, origin, store(value))).toBeNull()
    expect(readStore(7, origin, store([post()], {}))).toBeNull()
    expect(readStore(7, origin, store([], []))).toMatchObject({ posts: [], stream: [], source: 'store' })
    const unknown = fakeWindow({ id: 7, postStream: { posts: [post()] } })
    expect(readStore(7, origin, unknown)?.stream).toBeUndefined()
  })

  it('store 未知回复不会抹掉先前 API 的明确回复', () => {
    const known = readStore(7, origin, store([post(12, { reply_to_post_number: 1 })]))!.posts
    const later = readStore(7, origin, store([post(12)]))!.posts
    const session = createSession({ origin, topicId: 7, posts: known, source: 'api', scheme: 'light' })
    session.mergePosts(later)
    expect(later[0].replyToPostNumber).toBeUndefined()
    expect(session.get().posts[0].replyToPostNumber).toBe(1)
  })

  it('合法缓存保留对象；字段或来源/主题上下文变化不能命中旧对象', () => {
    const item = post(), win = store([item])
    const first = readStore(7, origin, win)!.posts[0]
    expect(readStore(7, origin, win)!.posts[0]).toBe(first)
    item.cooked = '<p>意气风发</p>'
    expect(readStore(7, origin, win)!.posts[0]).toMatchObject({ text: '意气风发' })
    expect(readStore(7, 'https://another.example', win)!.posts[0].origin).toBe('https://another.example')
    const next = fakeWindow({ id: 8, postStream: { posts: [item] } })
    expect(readStore(8, origin, next)!.posts[0].topicId).toBe(8)
    expect(readStore(7, origin, store([post(11, { cooked: {} })]))?.posts).toEqual([])
  })

  it('同名类与错误令牌是正文；改类名的自有节点仍只在副本剥离', () => {
    document.body.innerHTML = `<div data-post-number="1"><article data-post-id="101"><div class="cooked"><p class="threadmap-badge">一心一意</p><p class="threadmap-badge" ${OWNER_ATTR}="wrong">意气风发</p></div></article></div>`
    const cooked = document.querySelector('.cooked')!, html = cooked.innerHTML
    const own = document.createElement('button'); markOwned(own); own.className = 'renamed'; own.textContent = '不属于正文'; cooked.prepend(own)
    const liveHtml = cooked.innerHTML
    const snap = readDom(7, origin)
    expect(snap.posts[0]).toMatchObject({ text: '一心一意\n意气风发', raw: html })
    expect(cooked.innerHTML).toBe(liveHtml)
    expect(own.isConnected).toBe(true)
    expect(readDom(7, origin).posts[0]).toBe(snap.posts[0])
  })

  it('非法时间是空字段；其他主题、缺少数据库 ID、伪数字的楼层不接受', () => {
    document.body.innerHTML = `
      <div data-post-number="1"><article id="post_1"><div class="cooked">无数据库 ID</div></article></div>
      <div data-post-number="2"><article data-post-id="102" data-topic-id="7"><span class="relative-date" data-time="invalid-date"></span><div class="cooked">一心一意</div></article></div>
      <div data-post-number="3" data-topic-id="8"><article data-post-id="103" data-topic-id="7"><div class="cooked">主题冲突</div></article></div>
      <div data-post-number="4e1"><article data-post-id="104"><div class="cooked">伪数字</div></article></div>`
    for (const value of ['invalid-date', 'Infinity', '8640000000000001', '']) {
      document.querySelector<HTMLElement>('.relative-date')!.dataset.time = value
      expect(readDom(7, origin).posts).toMatchObject([{ id: 102, createdAt: '', text: '一心一意' }])
    }
    document.querySelector<HTMLElement>('.relative-date')!.dataset.time = '0'
    expect(readDom(7, origin).posts[0].createdAt).toBe('1970-01-01T00:00:00.000Z')
    expect(routeTopicId('/t/topic/0')).toBeNull()
  })

  it('DOM 超限帖不会污染或阻断其他合法楼层', () => {
    document.body.innerHTML = `<div data-post-number="1"><article data-post-id="101"><div class="cooked">${'甲'.repeat(MAX_COOKED + 1)}</div></article></div><div data-post-number="2"><article data-post-id="102"><div class="cooked">意气风发</div></article></div>`
    expect(readDom(7, origin).posts.map(p => p.id)).toEqual([102])
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
