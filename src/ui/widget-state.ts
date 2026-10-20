import type { ToolMode } from '../core/analysis'

/**
 * 面板交互状态机（纯函数）。每条转换对应 docs/ui-spec.md 第 4 节的表格，
 * 由 tests/widget-state.test.ts 覆盖。组件只派发事件，不自行决定状态。
 */

/** collapsed 贴边按钮 · hud 钉住的小窗 · open 面板 · full 全屏 */
export type Mode = 'collapsed' | 'hud' | 'open' | 'full'
/** 接龙模式：chain / issues / rules；问答模式：qa / rules */
export type Tab = 'chain' | 'issues' | 'rules' | 'qa'
/** 下一次渲染后需要移动焦点的位置；处理完由组件派发 focusDone 清除 */
export type FocusTarget = 'tabs' | 'edge' | 'detail' | 'hud' | null

export interface UiState { mode: Mode; tab: Tab; selected: number | null; focus: FocusTarget }

export type UiEvent =
  | { type: 'toggleFromEdge' }
  | { type: 'collapse' }
  | { type: 'toggleFull' }
  /** 面板 → 钉成小窗 */
  | { type: 'pin' }
  /** 小窗 → 展开面板，可指定标签 */
  | { type: 'expand'; tab?: Tab }
  | { type: 'escape' }
  | { type: 'setTab'; tab: Tab }
  | { type: 'select'; id: number }
  /** 原帖标注、问题列表“详情”：打开并聚焦到该楼的判断 */
  | { type: 'showPost'; id: number; tab?: Tab }
  /** 只有尚未选中任何楼时，才用阅读位置作为初始选择 */
  | { type: 'readingHint'; id: number }
  | { type: 'focusDone' }

export const initialUi = (mode: Mode = 'collapsed'): UiState => ({ mode, tab: 'chain', selected: null, focus: null })

export function uiReducer(state: UiState, event: UiEvent): UiState {
  switch (event.type) {
    case 'toggleFromEdge':
      return state.mode === 'collapsed' ? { ...state, mode: 'open', focus: 'tabs' } : { ...state, mode: 'collapsed', focus: 'edge' }
    case 'collapse':
      return state.mode === 'collapsed' ? state : { ...state, mode: 'collapsed', focus: 'edge' }
    case 'pin':
      return state.mode === 'open' || state.mode === 'full' ? { ...state, mode: 'hud', focus: 'hud' } : state
    case 'expand':
      return state.mode === 'hud' ? { ...state, mode: 'open', tab: event.tab ?? state.tab, focus: 'tabs' } : state
    case 'toggleFull':
      return state.mode === 'open' ? { ...state, mode: 'full' } : state.mode === 'full' ? { ...state, mode: 'open' } : state
    case 'escape':
      return state.mode === 'full' ? { ...state, mode: 'open' } : state.mode === 'open' || state.mode === 'hud' ? { ...state, mode: 'collapsed', focus: 'edge' } : state
    case 'setTab':
      return state.tab === event.tab ? state : { ...state, tab: event.tab }
    case 'select':
      return state.selected === event.id ? state : { ...state, selected: event.id }
    case 'showPost':
      return { ...state, mode: state.mode === 'full' ? 'full' : 'open', tab: event.tab ?? 'chain', selected: event.id, focus: 'detail' }
    case 'readingHint':
      return state.selected === null ? { ...state, selected: event.id } : state
    case 'focusDone':
      return state.focus === null ? state : { ...state, focus: null }
  }
}

/** 窗口模式/焦点共用，业务标签与选中项隔离；复用原窗口状态机而非复制转换逻辑。 */
export interface WorkspaceUi {
  mode: Mode
  focus: FocusTarget
  views: Record<ToolMode, Pick<UiState, 'tab' | 'selected'>>
}
export const initialWorkspace = (mode: Mode = 'collapsed'): WorkspaceUi => ({ mode, focus: null, views: { chain: { tab: 'chain', selected: null }, qa: { tab: 'qa', selected: null } } })
export const viewUi = (state: WorkspaceUi, tool: ToolMode): UiState => ({ mode: state.mode, focus: state.focus, ...state.views[tool] })
export function workspaceReducer(state: WorkspaceUi, action: { tool: ToolMode; event: UiEvent }): WorkspaceUi {
  const { tool } = action
  const event = action.event.type === 'showPost' && action.event.tab === undefined ? { ...action.event, tab: tool } : action.event
  if ('tab' in event && event.tab !== undefined && event.tab !== 'rules' && (tool === 'qa' ? event.tab !== 'qa' : event.tab !== 'chain' && event.tab !== 'issues')) return state
  const current = viewUi(state, tool), next = uiReducer(current, event)
  if (next === current) return state
  const paneChanged = next.tab !== current.tab || next.selected !== current.selected
  return { mode: next.mode, focus: next.focus, views: paneChanged ? { ...state.views, [tool]: { tab: next.tab, selected: next.selected } } : state.views }
}
