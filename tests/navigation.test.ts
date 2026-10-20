// @vitest-environment jsdom
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Post } from '../src/core/types'
import { createPostNavigation } from '../src/host/navigation'
import { PostLink } from '../src/ui/PostLink'

const origin = location.origin
const post: Post = { id: 101, postNumber: 2, topicId: 7, origin, username: 'reader', text: '回答', raw: '', createdAt: '' }
beforeEach(() => { document.body.innerHTML = ''; history.replaceState({}, '', '/t/topic/7'); vi.useFakeTimers() })
afterEach(() => { act(() => render(null, document.body)); vi.useRealTimers(); vi.restoreAllMocks() })

describe('共享原帖定位', () => {
  it('安全绝对链接不受 base 影响；非法身份/来源不生成链接', () => {
    const navigation = createPostNavigation(7, origin, () => 'light')
    const base = document.createElement('base'); base.href = 'https://evil.example/'; document.head.append(base)
    try {
      expect(navigation.href(post)).toBe(`${origin}/t/topic/7/2`)
      for (const patch of [{ postNumber: 0 }, { id: NaN }, { topicId: 8 }, { origin: 'https://evil.example' }]) expect(navigation.href({ ...post, ...patch })).toBeUndefined()
      expect(createPostNavigation(7, 'javascript:alert(1)', () => 'light').href({ ...post, origin: undefined })).toBeUndefined()
    } finally { base.remove() }
  })

  it('只定位数据库 ID、楼层和主题都对应的已显示节点；无节点不做整页导航', () => {
    document.body.innerHTML = '<div data-post-number="2"><article data-post-id="101" data-topic-id="7"><div class="cooked">回答</div></article></div>'
    const outer = document.querySelector<HTMLElement>('[data-post-number]')!, scroll = vi.fn(); outer.scrollIntoView = scroll
    vi.spyOn(outer.querySelector('article')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 100))
    const navigation = createPostNavigation(7, origin, () => 'dark'), before = location.href
    expect(navigation.reveal(post)).toBe(true)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' })
    expect(outer.querySelector('article')?.classList.contains('threadmap-flash')).toBe(true)
    vi.advanceTimersByTime(1600)
    expect(outer.querySelector('article')?.classList.contains('threadmap-flash')).toBe(false)
    expect(navigation.reveal({ ...post, id: 999 })).toBe(false)
    outer.remove()
    expect(navigation.reveal(post)).toBe(false)
    expect(location.href).toBe(before)
  })

  it('到达描边使用与面板相同的强调色，结束后从宿主节点移除', () => {
    document.body.innerHTML = '<div data-post-number="2"><article data-post-id="101" data-topic-id="7"><div class="cooked">回答</div></article></div>'
    const outer = document.querySelector<HTMLElement>('[data-post-number]')!; outer.scrollIntoView = vi.fn()
    const article = outer.querySelector('article')!
    vi.spyOn(article, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 100))
    expect(createPostNavigation(7, origin, () => 'light', document, () => '#c13a1a').reveal(post)).toBe(true)
    expect(article.style.getPropertyValue('--threadmap-accent')).toBe('#c13a1a')
    vi.advanceTimersByTime(1600)
    expect(article.style.getPropertyValue('--threadmap-accent')).toBe('')
    expect(article.getAttribute('style') || '').toBe('')
  })

  it('隐藏或零尺寸占位不误认为可以定位的正文', () => {
    document.body.innerHTML = '<div data-post-number="2"><article data-post-id="101" data-topic-id="7" hidden></article></div>'
    const el = document.querySelector<HTMLElement>('[data-post-number]')!; el.scrollIntoView = vi.fn()
    expect(createPostNavigation(7, origin, () => 'light').reveal(post)).toBe(false)
    expect(el.scrollIntoView).not.toHaveBeenCalled()
  })

  it('旧主题 DOM 残留不能误定位到新主题的同号楼层', () => {
    document.body.innerHTML = '<div data-post-number="2"><article data-post-id="101" data-topic-id="8"></article></div>'
    const el = document.querySelector<HTMLElement>('[data-post-number]')!; el.scrollIntoView = vi.fn()
    const navigation = createPostNavigation(7, origin, () => 'light')
    expect(navigation.reveal(post)).toBe(false)
    history.replaceState({}, '', '/t/new/8')
    document.querySelector<HTMLElement>('article')!.dataset.topicId = '7'
    expect(navigation.reveal(post)).toBe(false)
    expect(el.scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('共享原帖链接', () => {
  it.each([true, false])('reveal=%s：只有本地成功才阻止默认行为，其余保留新标签链接', revealed => {
    const navigation = { href: () => `${origin}/t/topic/7/2`, reveal: vi.fn(() => revealed) }, followed = vi.fn(), delegated = vi.fn()
    act(() => render(h(PostLink, { post, navigation, children: '查看原帖', onFollow: followed }), document.body))
    const link = document.querySelector('a')!
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
    let prevented: boolean | undefined
    link.addEventListener('click', event => { prevented = event.defaultPrevented; event.preventDefault() }) // 阻止 jsdom 实际导航，不影响被测处理顺序
    document.addEventListener('click', delegated)
    try { act(() => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) }) }
    finally { document.removeEventListener('click', delegated) }
    expect(prevented).toBe(revealed)
    expect(navigation.reveal).toHaveBeenCalledWith(post)
    expect(followed).toHaveBeenCalledOnce()
    expect(delegated).not.toHaveBeenCalled()
  })

  it('修饰键遵守原生新标签行为，不改变原页业务选中项', () => {
    const navigation = { href: () => `${origin}/t/topic/7/2`, reveal: vi.fn(() => true) }, followed = vi.fn()
    act(() => render(h(PostLink, { post, navigation, children: '原帖', onFollow: followed }), document.body))
    const link = document.querySelector('a')!
    let prevented = true
    link.addEventListener('click', event => { prevented = event.defaultPrevented; event.preventDefault() })
    act(() => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })) })
    expect(prevented).toBe(false)
    expect(followed).not.toHaveBeenCalled()
    expect(navigation.reveal).not.toHaveBeenCalled()
  })
})
