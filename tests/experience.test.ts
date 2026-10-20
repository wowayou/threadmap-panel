// @vitest-environment jsdom
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPolicy } from '../src/core/load-policy'
import { createSession, postCoverage, COVERAGE_BANDS, type HostApi } from '../src/core/session'
import { readPrefs } from '../src/core/storage'
import type { Post } from '../src/core/types'
import { Widget } from '../src/ui/Widget'

const posts: Post[] = [{ id: 101, postNumber: 1, username: 'reader', text: '主题说明', raw: '<p>主题说明</p>', createdAt: '' }]
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.trim() === text)!
const input = () => document.querySelector<HTMLInputElement>('#tm-action-load-count')!
const fill = (value: string) => act(() => { input().value = value; input().dispatchEvent(new Event('input', { bubbles: true })) })
function mount() {
  const loadAll = vi.fn<NonNullable<HostApi['loadAll']>>(async (_onProgress, _signal, options) => ({ added: options!.maxPosts, target: options!.maxPosts, requests: 1, reason: 'target' }))
  const host: HostApi = { session: createSession({ origin: 'https://forum.example', topicId: 7, posts, stream: [101, 102, 103], source: 'store', scheme: 'light', siteLanguage: 'zh-CN' }), loadAll, setBadges: vi.fn(), navigation: { href: () => undefined, reveal: () => false } }
  act(() => render(h(Widget, { host, initialMode: 'open' }), document.body))
  return { host, loadAll }
}
beforeEach(() => { localStorage.clear(); localStorage.setItem('threadmap-prefs-v2', JSON.stringify({ mode: 'qa' })); vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout) })
afterEach(() => { act(() => render(null, document.body)); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('以默认值而不是更多开关引导问答', () => {
  it('少数据说明范围和下一步，首次授权在同一确认完成；取消保持零许可', () => {
    const { loadAll } = mount()
    expect(document.body.textContent).toContain('当前范围内尚未识别到提问')
    expect(document.body.textContent).toContain('继续浏览原帖会积累上下文')
    act(() => button('选择加载').click())
    expect(input().value).toBe(String(loadPolicy.defaultPosts))
    expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
    expect(loadAll).not.toHaveBeenCalled(); expect(readPrefs().allowLoad).toBe(false)
    act(() => button('先不加载').click())
    expect(readPrefs().allowLoad).toBe(false)
    expect(document.activeElement).toBe(button('选择加载'))
  })

  it('确认数量并按次选择后台，不增加间隔/避让设置；完成后说明新增与停止原因', async () => {
    const { loadAll } = mount()
    act(() => button('选择加载').click()); fill('7')
    act(() => document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
    await act(async () => { button('允许并加载').click(); await Promise.resolve() })
    expect(loadAll).toHaveBeenCalledOnce()
    expect(loadAll.mock.calls[0][2]).toEqual({ maxPosts: 7, delayMs: loadPolicy.minIntervalMs, continueInBackground: true })
    expect(readPrefs()).toMatchObject({ allowLoad: true, loadCount: 7 })
    expect(document.body.textContent).toContain('本次新增 7 楼，完成 1 次请求')
    expect(document.body.textContent).toContain('已达到本次数量目标')
    act(() => button('加载更多楼层').click())
    expect(input().value).toBe('7')
    expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
    expect(document.querySelector('[id$="-interval"]')).toBeNull()
    act(() => button('先不加载').click())
    act(() => document.querySelector<HTMLButtonElement>('#tm-tab-rules')!.click())
    expect(document.querySelector('#tm-default-load-count')).toBeNull()
    expect(document.querySelector('[aria-labelledby="tm-auto-layout"]')).toBeNull()
  })

  it.each(['', '0', '-1', '101', '2.5'])('数量 %s 不合法时原生表单阻止授权和请求', async value => {
    const { loadAll } = mount()
    act(() => button('选择加载').click()); fill(value)
    expect(input().validity.valid).toBe(false)
    await act(async () => { button('允许并加载').click(); await Promise.resolve() })
    expect(loadAll).not.toHaveBeenCalled(); expect(readPrefs().allowLoad).toBe(false)
  })
})

describe('分析数据范围，不冒充阅读进度', () => {
  it('不知道平台列表时不伪造总量或百分比', () => {
    expect(postCoverage(posts)).toEqual({ loaded: 1, total: undefined, missing: undefined, bands: [] })
    expect(postCoverage([], [])).toEqual({ loaded: 0, total: 0, missing: 0, bands: [] })
  })

  it('按帖子ID统计，有限格数保留真实缺口，不把楼号当列表索引', () => {
    const stream = Array.from({ length: 10_000 }, (_, i) => i + 101)
    const sample = [...posts, { ...posts[0], id: 150, postNumber: 900 }, { ...posts[0], id: 99_999, postNumber: 999 }]
    const coverage = postCoverage(sample, stream)
    expect(coverage.loaded).toBe(3); expect(coverage.missing).toBe(9998)
    expect(coverage.bands).toHaveLength(COVERAGE_BANDS)
    expect(coverage.bands.reduce((sum, b) => sum + b.loaded, 0)).toBe(2)
    expect(coverage.bands.reduce((sum, b) => sum + b.total, 0)).toBe(10_000)
    expect(coverage.bands[0].start).toBe(1)
    expect(coverage.bands[COVERAGE_BANDS - 1].end).toBe(10_000)
  })
})

describe('调整面板宽度的全局监听', () => {
  // jsdom 没有 onpointerdown，Preact 会按大小写注册成 PointerDown；补上属性以贴近真实浏览器。
  beforeEach(() => { Object.defineProperty(HTMLElement.prototype, 'onpointerdown', { configurable: true, value: null, writable: true }) })
  afterEach(() => { delete (HTMLElement.prototype as { onpointerdown?: unknown }).onpointerdown })
  const pointer = (type: string, clientX: number, pointerId = 1) => Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 }), { pointerId })
  const tracked = () => {
    const live = new Set<EventListenerOrEventListenerObject>()
    const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => { if (type.startsWith('pointer')) live.add(fn); add(type, fn, options) })
    vi.spyOn(window, 'removeEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => { live.delete(fn); remove(type, fn, options) })
    return live
  }
  const handle = () => document.querySelector<HTMLElement>('.tm-resize')!
  const width = () => Number(handle().getAttribute('aria-valuenow'))

  it('松手保存宽度并移除监听', () => {
    const live = tracked(); mount()
    const start = width()
    act(() => { handle().dispatchEvent(pointer('pointerdown', 1000)) })
    expect(live.size).toBe(3)
    act(() => { window.dispatchEvent(pointer('pointermove', 960)); window.dispatchEvent(pointer('pointerup', 960)) })
    expect(live.size).toBe(0)
    expect(width()).toBe(start + 40)
    expect(readPrefs().width).toBe(start + 40)
  })

  it('取消拖动恢复原宽度且不保存；拖动中卸载也移除全部监听', () => {
    const live = tracked(); mount()
    const start = width(), saved = readPrefs().width
    act(() => { handle().dispatchEvent(pointer('pointerdown', 1000)); window.dispatchEvent(pointer('pointermove', 900)) })
    expect(width()).toBe(start + 100)
    act(() => { window.dispatchEvent(pointer('pointercancel', 900)) })
    expect(live.size).toBe(0); expect(width()).toBe(start); expect(readPrefs().width).toBe(saved)
    act(() => { handle().dispatchEvent(pointer('pointerdown', 1000)); window.dispatchEvent(pointer('pointermove', 950)) })
    expect(live.size).toBe(3)
    act(() => render(null, document.body))
    expect(live.size).toBe(0)
    expect(readPrefs().width).toBe(saved)
    // 卸载后的迟到指针事件不再触发任何处理
    window.dispatchEvent(pointer('pointerup', 800))
    expect(readPrefs().width).toBe(saved)
  })
})

describe('面板强调色跟随论坛', () => {
  it('论坛强调色经对比度推导后作为面板变量；宿主不再提供时回到默认值', () => {
    const { host } = mount()
    const root = () => document.querySelector<HTMLElement>('.tm-root')!
    expect(root().style.getPropertyValue('--tm-c-accent')).toBe('')
    act(() => host.session.setScheme('light', '#0088cc'))
    expect(root().style.getPropertyValue('--tm-c-accent')).toBe('#0070a8')
    expect(root().style.getPropertyValue('--tm-c-focus')).toBe('#0070a8')
    act(() => host.session.setScheme('dark'))
    expect(host.session.get().hostAccent).toBe('#0088cc')
    // 原色在深色表面上对比度不足，按同一色相提亮
    expect(root().style.getPropertyValue('--tm-c-accent')).toBe('#24b6ff')
    act(() => host.session.setScheme('dark', undefined))
    expect(host.session.get().hostAccent).toBeUndefined()
    expect(root().style.getPropertyValue('--tm-c-accent')).toBe('')
    expect(root().style.getPropertyValue('--tm-c-ok-bg')).toBe('')
  })
})
