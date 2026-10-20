// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutRequest } from '../src/core/types'
import { choosePlacement, watchNativeLayout } from '../src/host/layout'

const request: LayoutRequest = { mode: 'open', side: 'right', width: 380 }
const content = [{ left: 340, right: 1100 }], axis = [{ left: 1266, right: 1416 }]
const element = (className: string, left: number, width: number) => {
  const el = document.createElement('div'); el.className = className; document.body.append(el)
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(left, 180, width, 300))
  return el
}

beforeEach(() => { document.body.innerHTML = ''; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 }) })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('正文与论坛控件共同避让', () => {
  it('右侧有真正空白才并排，原生进度轴和正文都不相交', () => {
    expect(choosePlacement(request, 1440, [{ left: 200, right: 840 }], axis)).toEqual({ kind: 'sidecar', side: 'right', offset: 182, available: 410 })
  })

  it('反例：为进度轴左移会盖正文时改用左侧空白，宽度不小于320', () => {
    const placement = choosePlacement(request, 1440, content, axis)
    expect(placement).toEqual({ kind: 'sidecar', side: 'left', offset: 0, available: 332 })
    expect(placement.offset + Math.min(request.width, placement.available)).toBeLessThan(content[0].left)
  })

  it('两侧都不够、宿主未知或窄屏时明确为贴边临时抽屉，不假称并排', () => {
    expect(choosePlacement(request, 1440, content, [...axis, { left: 0, right: 320 }])).toMatchObject({ kind: 'drawer', offset: 0 })
    expect(choosePlacement(request, 1440, [], axis)).toMatchObject({ kind: 'drawer', offset: 0 })
    expect(choosePlacement(request, 600, [{ left: 50, right: 500 }], [])).toMatchObject({ kind: 'drawer', available: 600 })
  })

  it('全屏尊重显式覆盖选择；小窗/贴边按钮按自身宽度找空白', () => {
    expect(choosePlacement({ ...request, mode: 'full' }, 1440, content, axis)).toMatchObject({ kind: 'full', offset: 0, available: 1440 })
    expect(choosePlacement({ ...request, mode: 'hud' }, 1440, content, axis)).toMatchObject({ kind: 'sidecar', side: 'left' })
    expect(choosePlacement({ ...request, mode: 'collapsed' }, 1440, content, axis)).toMatchObject({ kind: 'sidecar', side: 'right', offset: 182, available: 150 })
  })

  it('宿主隐藏/原生全屏控件不占空白；测量不修改任何论坛节点', () => {
    element('topic-post', 200, 640)
    const timeline = element('timeline-container', 1266, 150)
    const root = document.createElement('div'); document.body.append(root)
    const changed = vi.fn(), watcher = watchNativeLayout(root, changed)
    const original = timeline.outerHTML
    watcher.configure(request)
    expect(changed).toHaveBeenLastCalledWith({ kind: 'sidecar', side: 'right', offset: 182, available: 410 })
    expect(timeline.outerHTML).toBe(original)
    timeline.style.visibility = 'hidden'; watcher.configure(request)
    expect(changed).toHaveBeenLastCalledWith({ kind: 'sidecar', side: 'right', offset: 0, available: 592 })
    timeline.style.visibility = ''; timeline.classList.add('timeline-fullscreen'); watcher.configure(request)
    expect(changed.mock.lastCall?.[0].offset).toBe(0)
    watcher.stop()
  })

  it('按帧合并动态测量；停止后移除变量、标记和监听', () => {
    vi.useFakeTimers()
    const root = document.createElement('div'); document.body.append(root)
    element('topic-post', 200, 640); element('timeline-container', 1266, 150)
    const remove = vi.spyOn(window, 'removeEventListener'), changed = vi.fn()
    const watcher = watchNativeLayout(root, changed)
    watcher.configure(request); changed.mockClear()
    watcher.schedule(); watcher.schedule(); window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(20)
    expect(changed).toHaveBeenCalledOnce()
    expect(root.style.getPropertyValue('--tm-dock-offset')).toBe('182px')
    expect(root.hasAttribute('data-edge-inset')).toBe(true)
    watcher.stop()
    expect(root.style.getPropertyValue('--tm-dock-offset')).toBe('')
    expect(root.style.getPropertyValue('--tm-free-width')).toBe('')
    expect(root.hasAttribute('data-edge-inset')).toBe(false)
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })
})
