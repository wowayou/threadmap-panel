// @vitest-environment jsdom
import { h, render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePostPreview } from '../src/core/post-preview'
import { buildQa } from '../src/core/questions'
import { createSession, type HostApi } from '../src/core/session'
import type { Post } from '../src/core/types'
import { QaView } from '../src/ui/QaView'
import { PostPreview } from '../src/ui/PostPreview'
import { Widget } from '../src/ui/Widget'

const post = (n: number, text: string, reply?: number): Post => ({ id: 1000 + n, postNumber: n, username: `reader${n}`, text, raw: '', createdAt: '', topicId: 7, replyToPostNumber: reply })
const navigation = { href: (p: Post) => `https://forum.example/t/topic/7/${p.postNumber}`, reveal: vi.fn(() => false) }
const posts = () => [post(1, '主楼'), post(2, '脚本怎么安装？'), post(3, '先安装浏览器扩展。', 2), post(4, '脚本安装方法是什么？'), post(5, '然后安装脚本并打开主题。', 2)]
const back = () => document.querySelector<HTMLButtonElement>('.tm-reader-nav button')!
const click = (selector: string) => act(() => document.querySelector<HTMLButtonElement>(selector)!.click())
const next = () => click('.tm-reply-nav button:last-child')
afterEach(() => { act(() => render(null, document.body)); navigation.reveal.mockClear() })

describe('共享预览游标', () => {
  it('按稳定帖子 ID 定位，保留业务排序、去重、过滤未载入项，不自动选别的答案', () => {
    const byId = new Map([post(2, '第二楼'), post(3, '第三楼')].map(p => [p.id, p]))
    expect(resolvePostPreview([1003, 9999, 1002, 1003], byId, 1002)).toMatchObject({ post: { id: 1002 }, index: 1, total: 2, previousId: 1003, nextId: undefined })
    expect(resolvePostPreview([1003], byId, 1002)).toBeNull()
    expect(resolvePostPreview([], byId, 1002)).toBeNull()
    byId.set(1004, post(4, '新增内容'))
    expect(resolvePostPreview([1004, 1003, 1002], byId, 1002)?.post.id).toBe(1002)
  })
  it('纯文本展示不执行 HTML，空内容/不在当前范围有明确说明', () => {
    const unsafe = post(3, '<img src=x onerror=alert(1)>\n这里只是文字')
    const props = { ids: [unsafe.id], byId: new Map([[unsafe.id, unsafe]]), selectedId: unsafe.id, navigation, onSelect: vi.fn(), onClose: vi.fn() }
    act(() => render(h(PostPreview, props), document.body))
    expect(document.querySelector('.tm-post-text')?.textContent).toBe(unsafe.text)
    expect(document.querySelector('img')).toBeNull()
    expect(document.body.textContent).toContain('代码、图片等未完整展示')
    act(() => render(h(PostPreview, { ...props, byId: new Map([[unsafe.id, { ...unsafe, text: '' }]]) }), document.body))
    expect(document.body.textContent).toContain('没有可预览的正文文字')
    act(() => render(h(PostPreview, { ...props, selectedId: 999 }), document.body))
    expect(document.body.textContent).toContain('不会自动发起请求')
  })
})

describe('同一面板内的问题与回复阅读', () => {
  it('从搜索一步阅读第一条回复，切换与返回不把答案 ID 当成选中的问题；恢复入口焦点', () => {
    const items = posts(), byId = new Map(items.map(p => [p.id, p])), qa = buildQa(items), selections = vi.fn()
    function Harness() {
      const [selected, select] = useState<number | null>(1002)
      return h(QaView, { qa, byId, selected, focusDetail: false, onFocused: () => {}, onSelect: id => { selections(id); select(id) }, navigation, missing: 0 })
    }
    act(() => render(h(Harness, {}), document.body))
    const input = document.querySelector<HTMLInputElement>('#tm-ask')!
    act(() => { input.value = '脚本安装'; input.dispatchEvent(new Event('input', { bubbles: true })) })
    const opener = document.querySelector<HTMLButtonElement>('.tm-search-results button')!
    act(() => opener.click())
    expect(document.querySelector('.tm-question-context h3')?.textContent).toContain('脚本怎么安装')
    expect(document.querySelector('.tm-post-text')?.textContent).toBe('先安装浏览器扩展。')
    expect(document.querySelector('.tm-reply-evidence')?.textContent).toContain('明确回复 #2')
    expect(document.activeElement).toBe(document.querySelector('.tm-question-context h3'))
    next()
    expect(document.querySelector('.tm-post-text')?.textContent).toBe('然后安装脚本并打开主题。')
    expect(document.activeElement).toBe(document.querySelector('.tm-post-heading h3'))
    act(() => back().click())
    expect(document.querySelector('.tm-reader')).toBeNull()
    expect(input.value).toBe('脚本安装')
    expect(document.activeElement).toBe(opener)
    expect(selections).not.toHaveBeenCalled()
    expect(navigation.reveal).not.toHaveBeenCalled()
  })
  it('回答不再关联时不自动换成另一条；整个问题入口消失后返回查询框', () => {
    const items = posts()
    const props = (items: Post[]) => ({ qa: buildQa(items), byId: new Map(items.map(p => [p.id, p])), selected: 1002, focusDetail: false, onFocused: vi.fn(), onSelect: vi.fn(), navigation, missing: 0 })
    act(() => render(h(QaView, props(items)), document.body))
    const opener = document.querySelector<HTMLButtonElement>('.tm-repeated button')!
    act(() => opener.click())
    act(() => render(h(QaView, props(items.map(p => p.id === 1003 ? { ...p, replyToPostNumber: null } : p))), document.body))
    expect(document.querySelector('section[aria-label="帖子预览"]')?.textContent).toContain('已不在当前可预览范围')
    expect(document.querySelector('.tm-post-text')).toBeNull()
    act(() => render(h(QaView, props(items.map(p => [1002, 1004].includes(p.id) ? { ...p, text: '普通讨论。' } : p))), document.body))
    expect(opener.isConnected).toBe(false)
    expect(document.querySelector('.tm-reader')?.textContent).toContain('已不在当前归组范围')
    act(() => back().click())
    expect(document.activeElement?.id).toBe('tm-ask')
    expect(navigation.reveal).not.toHaveBeenCalled()
  })
  it('Esc 先退出阅读回列表，再清空搜索；不会直接收起外层面板', () => {
    const items = posts(), outer = vi.fn()
    act(() => render(h('div', { onKeyDown: outer }, h(QaView, { qa: buildQa(items), byId: new Map(items.map(p => [p.id, p])), selected: null, focusDetail: false, onFocused: vi.fn(), onSelect: vi.fn(), navigation, missing: 0 })), document.body))
    click('.tm-repeated button')
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => { back().dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(outer).not.toHaveBeenCalled()
    expect(document.querySelector('.tm-reader')).toBeNull()
  })
  it('原帖标注的显式阅读请求在标题挂载后聚焦，而不是先消费焦点动作', () => {
    const items = posts(), onFocused = vi.fn()
    act(() => render(h(QaView, { qa: buildQa(items), byId: new Map(items.map(p => [p.id, p])), selected: 1004, focusDetail: true, active: true, onFocused, onSelect: vi.fn(), navigation, missing: 0 }), document.body))
    expect(document.querySelector('.tm-post-text')?.textContent).toBe('先安装浏览器扩展。')
    expect(document.activeElement).toBe(document.querySelector('.tm-question-context h3'))
    expect(onFocused).toHaveBeenCalledOnce()
  })
  it('新回复到达不自动替换无回答视图，但提供明确的继续阅读入口', () => {
    const items = posts(), props = (list: Post[]) => ({ qa: buildQa(list), byId: new Map(list.map(p => [p.id, p])), selected: null, focusDetail: false, onFocused: vi.fn(), onSelect: vi.fn(), navigation, missing: 0 })
    act(() => render(h(QaView, props(items.filter(p => !p.replyToPostNumber))), document.body))
    click('.tm-repeated button')
    expect(document.querySelector('.tm-reader')?.textContent).toContain('不代表问题未解决')
    act(() => render(h(QaView, props(items)), document.body))
    expect(document.querySelector('.tm-post-text')).toBeNull()
    const action = [...document.querySelectorAll<HTMLButtonElement>('.tm-reader button')].find(b => b.textContent === '阅读 2 条回复')!
    act(() => action.click())
    expect(document.querySelector('.tm-post-text')?.textContent).toBe('先安装浏览器扩展。')
  })
})

describe('面板阅读状态与确认焦点', () => {
  function mount() {
    localStorage.clear()
    localStorage.setItem('threadmap-prefs-v2', JSON.stringify({ allowLoad: true }))
    const session = createSession({ origin: 'https://forum.example', topicId: 7, posts: posts(), source: 'dom', scheme: 'light', siteLanguage: 'zh-CN' })
    const host: HostApi = { session, navigation, setBadges: vi.fn(), loadAll: vi.fn(async () => {}) }
    act(() => render(h(Widget, { host, initialMode: 'open' }), document.body))
    return host
  }
  it('切规则/收起/小窗保留查询与回复；新高赞回复不换当前 ID，不抢标签焦点', () => {
    const host = mount(), input = document.querySelector<HTMLInputElement>('#tm-ask')!
    act(() => { input.value = '脚本安装'; input.dispatchEvent(new Event('input', { bubbles: true })) })
    click('.tm-search-results button')
    click('#tm-tab-rules')
    act(() => { const tab = document.querySelector<HTMLButtonElement>('#tm-tab-qa')!; tab.click(); tab.focus() })
    expect(input.value).toBe('脚本安装')
    expect(document.querySelector('.tm-post-text')?.textContent).toBe('先安装浏览器扩展。')
    act(() => host.session.mergePosts([{ ...post(6, '新出现的高赞回答。', 2), likeCount: 100 }]))
    expect(document.querySelector('.tm-post-text')?.textContent).toBe('先安装浏览器扩展。')
    expect(document.activeElement?.id).toBe('tm-tab-qa')
    click('[aria-label="钉成小窗"]'); click('[aria-label="展开面板"]')
    expect(document.querySelector('.tm-post-text')?.textContent).toBe('先安装浏览器扩展。')
    click('[aria-label="收起面板"]'); click('.tm-edge')
    expect(input.value).toBe('脚本安装')
    expect(document.querySelector('.tm-post-text')?.textContent).toBe('先安装浏览器扩展。')
  })
  it('确认未结束时即使焦点回到阅读页，Esc也先取消确认并保留回复', () => {
    const host = mount()
    click('.tm-repeated button'); click('.tm-status button')
    const title = document.querySelector<HTMLElement>('.tm-question-context h3')!
    act(() => { title.focus(); title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(document.querySelector('#tm-load-confirm')).toBeNull()
    expect(document.querySelector('.tm-post-text')?.textContent).toBe('先安装浏览器扩展。')
    expect(document.activeElement).toBe(document.querySelector('.tm-status button'))
    expect(host.loadAll).not.toHaveBeenCalled()
  })
  it('确认加载先聚焦说明，Esc 仅关闭确认并返回入口，仍然零请求', () => {
    const host = mount(), load = document.querySelector<HTMLButtonElement>('.tm-status button')!
    act(() => load.click())
    const confirmation = document.querySelector<HTMLElement>('#tm-load-confirm')!
    expect(document.activeElement).toBe(confirmation)
    act(() => { confirmation.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(confirmation.isConnected).toBe(false)
    expect(document.activeElement).toBe(load)
    expect(document.querySelector<HTMLElement>('.tm-panel')!.hidden).toBe(false)
    expect(host.loadAll).not.toHaveBeenCalled()
  })
})
