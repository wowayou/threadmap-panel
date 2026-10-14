import { describe, expect, it } from 'vitest'
import { initialUi, uiReducer, type UiState } from '../src/ui/widget-state'

/** 逐条对应 docs/ui-spec.md §4 的状态表 */
const at = (patch: Partial<UiState>): UiState => ({ ...initialUi(), ...patch })

describe('面板状态机', () => {
  it('默认收起，停在“接龙”，没有选中', () => {
    expect(initialUi()).toEqual({ mode: 'collapsed', tab: 'chain', selected: null, focus: null })
  })

  it('收起 + 点击贴边按钮 → 展开，焦点到当前标签', () => {
    expect(uiReducer(at({ mode: 'collapsed' }), { type: 'toggleFromEdge' })).toMatchObject({ mode: 'open', focus: 'tabs' })
  })

  it.each(['open', 'full'] as const)('%s + 收起 → 收起，焦点回到贴边按钮', mode => {
    expect(uiReducer(at({ mode }), { type: 'collapse' })).toMatchObject({ mode: 'collapsed', focus: 'edge' })
  })

  it('展开 ↔ 全屏；收起时全屏按钮无效', () => {
    expect(uiReducer(at({ mode: 'open' }), { type: 'toggleFull' }).mode).toBe('full')
    expect(uiReducer(at({ mode: 'full' }), { type: 'toggleFull' }).mode).toBe('open')
    expect(uiReducer(at({ mode: 'collapsed' }), { type: 'toggleFull' }).mode).toBe('collapsed')
  })

  it('Esc：全屏 → 展开 → 收起（焦点回贴边按钮）', () => {
    const full = at({ mode: 'full' })
    const open = uiReducer(full, { type: 'escape' })
    expect(open).toMatchObject({ mode: 'open', focus: null })
    expect(uiReducer(open, { type: 'escape' })).toMatchObject({ mode: 'collapsed', focus: 'edge' })
    const collapsed = at({ mode: 'collapsed' })
    expect(uiReducer(collapsed, { type: 'escape' })).toBe(collapsed)
  })

  it('原帖标注 / 详情：展开（全屏保持全屏），切到接龙并聚焦详情', () => {
    expect(uiReducer(at({ mode: 'collapsed', tab: 'issues' }), { type: 'showPost', id: 7 })).toEqual({ mode: 'open', tab: 'chain', selected: 7, focus: 'detail' })
    expect(uiReducer(at({ mode: 'full', tab: 'rules' }), { type: 'showPost', id: 7 }).mode).toBe('full')
    expect(uiReducer(at({ mode: 'collapsed' }), { type: 'showPost', id: 7, tab: 'qa' }).tab).toBe('qa')
  })

  it('钉成小窗：展开/全屏 → 小窗，焦点进入小窗；收起时无效', () => {
    expect(uiReducer(at({ mode: 'open' }), { type: 'pin' })).toMatchObject({ mode: 'hud', focus: 'hud' })
    expect(uiReducer(at({ mode: 'full' }), { type: 'pin' }).mode).toBe('hud')
    const collapsed = at({ mode: 'collapsed' })
    expect(uiReducer(collapsed, { type: 'pin' })).toBe(collapsed)
  })

  it('小窗：展开回面板（可指定标签）；Esc 与收起都回到贴边按钮；全屏按钮无效', () => {
    expect(uiReducer(at({ mode: 'hud', tab: 'chain' }), { type: 'expand', tab: 'issues' })).toMatchObject({ mode: 'open', tab: 'issues', focus: 'tabs' })
    expect(uiReducer(at({ mode: 'hud' }), { type: 'escape' })).toMatchObject({ mode: 'collapsed', focus: 'edge' })
    expect(uiReducer(at({ mode: 'hud' }), { type: 'collapse' })).toMatchObject({ mode: 'collapsed', focus: 'edge' })
    expect(uiReducer(at({ mode: 'hud' }), { type: 'toggleFull' }).mode).toBe('hud')
    expect(uiReducer(at({ mode: 'hud' }), { type: 'showPost', id: 3 })).toMatchObject({ mode: 'open', selected: 3 })
  })

  it('选中不改变展开状态，也不移动焦点', () => {
    const state = at({ mode: 'open' })
    expect(uiReducer(state, { type: 'select', id: 3 })).toEqual({ ...state, selected: 3 })
  })

  it('阅读位置只在尚未选中时作为初始选择', () => {
    expect(uiReducer(at({}), { type: 'readingHint', id: 5 }).selected).toBe(5)
    const chosen = at({ selected: 2 })
    expect(uiReducer(chosen, { type: 'readingHint', id: 5 })).toBe(chosen)
  })

  it('无变化的事件返回同一对象（避免多余渲染）', () => {
    const state = at({ mode: 'open', tab: 'issues', selected: 4 })
    expect(uiReducer(state, { type: 'setTab', tab: 'issues' })).toBe(state)
    expect(uiReducer(state, { type: 'select', id: 4 })).toBe(state)
    expect(uiReducer(state, { type: 'focusDone' })).toBe(state)
  })
})
