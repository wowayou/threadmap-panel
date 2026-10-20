// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadLifecycle } from '../src/host/load-lifecycle'
import { loadPolicy } from '../src/core/load-policy'

const hidden = (value: boolean) => { Object.defineProperty(document, 'hidden', { configurable: true, value }); document.dispatchEvent(new Event('visibilitychange')) }
beforeEach(() => { vi.useFakeTimers(); hidden(false) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('本次加载的生命周期选择', () => {
  it('默认切到后台取消，返回也不恢复', () => {
    const lifecycle = loadLifecycle(new AbortController().signal, false)
    hidden(true)
    expect(lifecycle.signal.aborted).toBe(true)
    hidden(false)
    expect(lifecycle.signal.aborted).toBe(true)
    expect(lifecycle.error(Object.assign(new Error('abort'), { name: 'AbortError' }))).toMatchObject({ name: 'AbortError', message: expect.stringContaining('切换标签页') })
    lifecycle.dispose(); expect(vi.getTimerCount()).toBe(0)
  })

  it('勾选后台继续仅改变可见性策略，pagehide依然取消', () => {
    const lifecycle = loadLifecycle(new AbortController().signal, true)
    hidden(true); expect(lifecycle.signal.aborted).toBe(false)
    window.dispatchEvent(new Event('pagehide'))
    expect(lifecycle.signal.aborted).toBe(true)
    lifecycle.dispose()
  })

  it('主动取消/换主题的父信号永远有效，开始前取消也不遗漏', () => {
    for (const before of [true, false]) {
      const parent = new AbortController()
      if (before) parent.abort()
      const lifecycle = loadLifecycle(parent.signal, true)
      if (!before) parent.abort()
      expect(lifecycle.signal.aborted).toBe(true)
      lifecycle.dispose()
    }
  })

  it('后台本次任务也有截止时间，完成后清理不再受页面事件影响', () => {
    const lifecycle = loadLifecycle(new AbortController().signal, true)
    hidden(true); vi.advanceTimersByTime(loadPolicy.actionTimeoutMs)
    expect(lifecycle.signal.aborted).toBe(true)
    lifecycle.dispose()
    hidden(false)
    const finished = loadLifecycle(new AbortController().signal, false)
    finished.dispose(); hidden(true); window.dispatchEvent(new Event('pagehide'))
    expect(finished.signal.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
