// @vitest-environment jsdom
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as chainCore from '../src/core/chain'
import { LoadError } from '../src/host/loader'
import * as qaCore from '../src/core/questions'
import { createSession, type HostApi } from '../src/core/session'
import { defaultPrefs, readPrefs, writePrefs } from '../src/core/storage'
import type { Post } from '../src/core/types'
import { Widget } from '../src/ui/Widget'

const posts: Post[] = ['一心一意', '意气风发', '发奋图强', '强人所难', '脚本怎么安装？', '先安装浏览器扩展。', '脚本安装方法是什么？'].map((text, i) => ({
  id: 101 + i, postNumber: i + 1, topicId: 7, origin: 'https://forum.example', username: `reader${i}`, text, raw: '', createdAt: '', replyToPostNumber: i === 5 ? 5 : null,
}))
const button = (name: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.trim() === name)!
const tab = (name: string) => document.querySelector<HTMLButtonElement>(`#tm-tab-${name}`)!
const changeMode = (name: string) => {
  act(() => tab('rules').click())
  act(() => button(name, document.querySelector('[aria-label="工具模式"]')!).click())
}
function mount(mode: 'chain' | 'qa', extra: Record<string, unknown> = {}, loadAll: HostApi['loadAll'] = vi.fn(async () => {})) {
  localStorage.setItem('threadmap-prefs-v2', JSON.stringify({ mode, ...extra }))
  const session = createSession({ origin: 'https://forum.example', topicId: 7, posts, stream: [...posts.map(p => p.id), 999], source: 'store', scheme: 'light', siteLanguage: 'zh-CN' })
  const host: HostApi = { session, setBadges: vi.fn(), loadAll, navigation: { href: p => `https://forum.example/t/7/${p.postNumber}`, reveal: vi.fn(() => false) } }
  act(() => render(h(Widget, { host, initialMode: 'open' }), document.body))
  return host
}
beforeEach(() => { localStorage.clear(); vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(f, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout) })
afterEach(() => { act(() => render(null, document.body)); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('显式模式与可选能力', () => {
  it('显式问答不运行接龙引擎，接龙选项不参与问答结果', () => {
    const chain = vi.spyOn(chainCore, 'buildChain'), qa = vi.spyOn(qaCore, 'buildQa')
    mount('qa')
    expect(chain).not.toHaveBeenCalled()
    expect(qa).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('还有 1 楼未载入')
  })

  it('显式接龙不运行问答引擎', () => {
    const chain = vi.spyOn(chainCore, 'buildChain'), qa = vi.spyOn(qaCore, 'buildQa')
    mount('chain')
    expect(chain).toHaveBeenCalledOnce()
    expect(qa).not.toHaveBeenCalled()
  })

  it('默认不提供主动补取入口，仍能显示本地分析', () => {
    const host = mount('qa')
    expect(button('加载更多楼层')).toBeUndefined()
    expect(document.querySelector('#tm-ask')).not.toBeNull()
    expect(host.loadAll).not.toHaveBeenCalled()
  })

  it('两种模式往返后分别保留输入与标注选项', () => {
    const host = mount('chain')
    const input = document.querySelector<HTMLInputElement>('#tm-try')!
    act(() => { input.value = '难能可贵'; input.dispatchEvent(new Event('input', { bubbles: true })) })
    changeMode('问答')
    act(() => tab('qa').click())
    const ask = document.querySelector<HTMLInputElement>('#tm-ask')!
    act(() => { ask.value = '脚本安装'; ask.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => tab('rules').click())
    act(() => button('关闭', document.querySelector('[aria-label="原帖标注"]')!).click())
    act(() => button('接龙', document.querySelector('[aria-label="工具模式"]')!).click())
    act(() => tab('chain').click())
    expect(document.querySelector<HTMLInputElement>('#tm-try')!.value).toBe('难能可贵')
    const lastBadges = vi.mocked(host.setBadges).mock.calls.at(-1)?.[0]
    expect(lastBadges?.has(2)).toBe(true)
    changeMode('问答')
    act(() => tab('qa').click())
    expect(document.querySelector<HTMLInputElement>('#tm-ask')!.value).toBe('脚本安装')
    expect(vi.mocked(host.setBadges).mock.calls.at(-1)?.[0]).toBeNull()
  })

  it('问答结果只受问答设置影响；关闭回复关联后不显示假的“没有回答”', () => {
    mount('qa', { settings: { homophone: false, tone: false, window: 3 }, qa: { approximate: true, associateReplies: false } })
    expect(document.body.textContent).toContain('回复/引用关联已关闭')
    expect(document.body.textContent).not.toContain('1 条回答')
    act(() => document.querySelector<HTMLButtonElement>('.tm-repeated button')!.click())
    expect(document.body.textContent).toContain('已在规则页关闭回复/引用关联')
    expect(document.body.textContent).not.toContain('没有找到更晚楼层')
    act(() => tab('rules').click())
    expect(document.body.textContent).toContain('问答规则')
    expect(document.body.textContent).not.toContain('允许同音字接')
  })

  it('自动模式往返后恢复的回答预览不抢走页面其他位置的焦点', () => {
    localStorage.setItem('threadmap-prefs-v2', JSON.stringify({ mode: 'auto' }))
    const session = createSession({ origin: 'https://forum.example', topicId: 7, posts: posts.slice(4), source: 'dom', scheme: 'light', siteLanguage: 'zh-CN' })
    const host: HostApi = { session, setBadges: vi.fn(), navigation: { href: p => `https://forum.example/t/7/${p.postNumber}`, reveal: vi.fn(() => false) } }
    const composer = document.createElement('textarea'), mountPoint = document.createElement('div')
    document.body.append(composer, mountPoint)
    act(() => render(h(Widget, { host, initialMode: 'open' }), mountPoint))
    act(() => document.querySelector<HTMLButtonElement>('.tm-repeated button[aria-label="阅读第 5 楼的问题与相关回复"]')!.click())
    expect(document.querySelector('.tm-post-text')?.textContent).toBe('先安装浏览器扩展。')
    composer.focus()
    const idioms = ['一心一意', '意气风发', '发奋图强', '强人所难'].map((text, i) => ({ ...posts[i], id: 301 + i, postNumber: 11 + i, text }))
    act(() => session.mergePosts(idioms))
    expect(document.querySelector('#tm-try')).not.toBeNull()
    act(() => session.mergePosts(idioms.map(p => ({ ...p, text: '普通对话' }))))
    expect(document.querySelector('.tm-post-text')?.textContent).toBe('先安装浏览器扩展。')
    expect(document.activeElement).toBe(composer)
    act(() => render(null, mountPoint))
  })
})

describe('主动补取许可', () => {
  const confirmLoad = () => {
    act(() => button('加载更多楼层').click())
    act(() => button('开始加载').click())
  }

  it.each([[403, false], [429, false], [503, true]])('HTTP %i 后是否保留补取许可：%s', async (status, kept) => {
    const loadAll = vi.fn(async () => { throw new LoadError(`楼层读取失败（${status}）`, status) })
    mount('qa', { allowLoad: true }, loadAll)
    confirmLoad()
    await act(async () => { await Promise.resolve() })
    expect(loadAll).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain(`（${status}）`)
    expect(readPrefs().allowLoad).toBe(kept)
    expect(button('加载更多楼层') !== undefined).toBe(kept)
    if (!kept) expect(document.body.textContent).toContain('已自动关闭主动补取')
  })

  it('人机验证也关闭许可；关闭开关会取消本页加载', async () => {
    let signal: AbortSignal | undefined
    const loadAll = vi.fn((_progress: (loaded: number, total: number) => void, abort: AbortSignal) => { signal = abort; return new Promise<void>((_resolve, reject) => abort.addEventListener('abort', () => { const error = new Error('已取消'); error.name = 'AbortError'; reject(error) })) })
    mount('qa', { allowLoad: true }, loadAll)
    confirmLoad()
    act(() => tab('rules').click())
    const toggle = document.querySelector<HTMLButtonElement>('[aria-labelledby="tm-allow-load"]')!
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await act(async () => { toggle.click(); await Promise.resolve() })
    expect(signal?.aborted).toBe(true)
    expect(readPrefs().allowLoad).toBe(false)
    act(() => render(null, document.body))
    const challenge = vi.fn(async () => { throw new LoadError('站点要求人机验证', 200, undefined, true) })
    mount('qa', { allowLoad: true }, challenge)
    confirmLoad()
    await act(async () => { await Promise.resolve() })
    expect(readPrefs().allowLoad).toBe(false)
  })

  it('其他标签页关闭许可后本页入口消失，本页无关设置不会把它写回开启', () => {
    mount('qa', { allowLoad: true })
    expect(button('加载更多楼层')).toBeDefined()
    writePrefs({ ...readPrefs(), allowLoad: false })
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'threadmap-prefs-v2' })) })
    expect(button('加载更多楼层')).toBeUndefined()
    act(() => tab('rules').click())
    act(() => button('左侧', document.querySelector('[aria-label="停靠位置"]')!).click())
    expect(readPrefs()).toMatchObject({ allowLoad: false, dock: { side: 'left' } })
  })
})

describe('设置迁移与保守默认值', () => {
  it('旧的单一标注设置只作为两种模式的初值；未声明的补取保持关闭', () => {
    localStorage.setItem('threadmap-prefs-v2', JSON.stringify({ annotate: 'off', mode: 'chain' }))
    expect(readPrefs()).toMatchObject({ annotate: { chain: 'off', qa: 'off' }, allowLoad: false, loadCount: 20, qa: { approximate: true, associateReplies: true } })
    localStorage.setItem('threadmap-prefs-v2', JSON.stringify({ annotate: { chain: 'on', qa: 'bogus' }, allowLoad: 'true', preserveTimeline: false, qa: { approximate: false } }))
    expect(readPrefs()).toMatchObject({ annotate: { chain: 'on', qa: 'auto' }, allowLoad: false, qa: { approximate: false, associateReplies: true } })
    localStorage.setItem('threadmap-prefs-v2', '{broken')
    expect(readPrefs()).toEqual(defaultPrefs)
  })

  it('写入后必须能读回相同内容，否则提示未可靠保存', () => {
    const silent = { getItem: () => null, setItem: () => {} } as unknown as Storage
    expect(writePrefs(defaultPrefs, silent)).toBe(false)
    mount('qa')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    act(() => tab('rules').click())
    act(() => button('左侧', document.querySelector('[aria-label="停靠位置"]')!).click())
    expect(document.body.textContent).toContain('没有可靠保存设置或纠正')
  })
})
