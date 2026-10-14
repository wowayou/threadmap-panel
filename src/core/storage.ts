import { defaultChainSettings, type ChainSettings } from './chain'
import type { Override } from './types'

const OVERRIDES_KEY = 'threadmap-overrides-v1'
const PREFS_KEY = 'threadmap-prefs-v2'

export type AnnotateMode = 'auto' | 'on' | 'off'
export type DockSide = 'left' | 'right'
/** auto：像接龙就用接龙模式，否则用问答模式 */
export type ViewMode = 'auto' | 'chain' | 'qa'
export interface Prefs {
  settings: ChainSettings
  annotate: AnnotateMode
  /** 面板宽度，范围见 ui/tokens.ts layout.panelMin/panelMax */
  width: number
  /** 贴边按钮与面板停靠的一侧，以及按钮的纵向位置（0–1） */
  dock: { side: DockSide; ratio: number }
  mode: ViewMode
}
export const PANEL_WIDTH = { min: 320, max: 480, default: 380 }
export const defaultPrefs: Prefs = { settings: defaultChainSettings, annotate: 'auto', width: PANEL_WIDTH.default, dock: { side: 'right', ratio: 0.4 }, mode: 'auto' }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const local = (storage?: Storage) => storage || (typeof localStorage !== 'undefined' ? localStorage : null)

export function readOverrides(storage?: Storage): Override[] {
  try {
    const value = JSON.parse(local(storage)?.getItem(OVERRIDES_KEY) || '[]')
    return Array.isArray(value) ? value.filter(x => x && typeof x.origin === 'string' && typeof x.topicId === 'number' && typeof x.childId === 'number' && (x.parentId === null || typeof x.parentId === 'number')) : []
  } catch { return [] }
}

/** 返回是否真正写入。隐私模式或存储被禁用时返回 false，界面需提示“仅本次有效”。 */
export function writeOverrides(value: Override[], storage?: Storage): boolean {
  try { const target = local(storage); if (!target) return false; target.setItem(OVERRIDES_KEY, JSON.stringify(value)); return true } catch { return false }
}

export function readPrefs(storage?: Storage): Prefs {
  try {
    const value = JSON.parse(local(storage)?.getItem(PREFS_KEY) || '{}')
    const s = { ...defaultChainSettings, ...(value.settings || {}) }
    return {
      settings: { homophone: s.homophone !== false, tone: s.tone !== false, window: Math.min(50, Math.max(1, Number(s.window) || defaultChainSettings.window)) },
      annotate: ['auto', 'on', 'off'].includes(value.annotate) ? value.annotate : 'auto',
      width: clamp(Number(value.width) || PANEL_WIDTH.default, PANEL_WIDTH.min, PANEL_WIDTH.max),
      dock: { side: value.dock?.side === 'left' ? 'left' : 'right', ratio: Number.isFinite(Number(value.dock?.ratio)) ? clamp(Number(value.dock.ratio), 0, 1) : 0.4 },
      mode: value.mode === 'chain' || value.mode === 'qa' ? value.mode : 'auto',
    }
  } catch { return defaultPrefs }
}

export function writePrefs(value: Prefs, storage?: Storage): boolean {
  try { const target = local(storage); if (!target) return false; target.setItem(PREFS_KEY, JSON.stringify(value)); return true } catch { return false }
}
