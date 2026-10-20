import { h } from 'preact'
import { useLayoutEffect } from 'preact/hooks'
import type { TopicAnalysis } from '../core/analysis'
import type { Prefs } from '../core/storage'
import { useI18n } from './I18n'
import { useDockDrag } from './useDockDrag'

/** 收起状态的贴边按钮：只显示当前模式的读数；可拖到另一侧（docs/ui-spec.md §3） */
export function EdgeTab({ analysis, dock, focus, onFocused, onOpen, onDock }: { analysis: TopicAnalysis; dock: Prefs['dock']; focus: boolean; onFocused: () => void; onOpen: () => void; onDock: (dock: Prefs['dock']) => void }) {
  const { t } = useI18n()
  const { target, offset, dragStyle, guardClick, handlers } = useDockDrag(onDock)
  // 面板在同一次提交里变为 display:none，浏览器会在下一帧把焦点修正到 body：先在布局阶段聚焦，下一帧再确认一次
  useLayoutEffect(() => {
    if (!focus) return
    const el = target.current
    el?.focus()
    const frame = requestAnimationFrame(() => { if (el && el.isConnected && (el.getRootNode() as Document | ShadowRoot).activeElement !== el) el.focus() })
    onFocused()
    return () => cancelAnimationFrame(frame)
  }, [focus])

  const qa = analysis.mode === 'qa' ? analysis.result : null
  const next = analysis.mode === 'chain' ? analysis.result.heads[0]?.last.value.slice(-1) : '?'
  const issues = analysis.mode === 'qa' ? analysis.result.repeated.length : analysis.result.issues.length
  const label = qa
    ? t('edge.qa') + (issues ? t('edge.repeated', { count: issues }) : '')
    : t('edge.chain') + (next ? t('edge.next', { char: next }) : '') + (issues ? t('edge.issues', { count: issues }) : '')

  return <button
    ref={el => { target.current = el }}
    type="button"
    class="tm-edge"
    data-side={dock.side}
    data-drag-handle
    data-dragging={offset ? 'true' : undefined}
    aria-label={label}
    title={t('edge.drag')}
    style={{ '--tm-edge-ratio': String(dock.ratio), ...dragStyle }}
    {...handlers}
    onClick={guardClick(onOpen)}
  >
    <span class="tm-edge-char" aria-hidden="true">{next || '⌁'}</span>
    {issues ? <span class="tm-count" aria-hidden="true">{issues}</span> : null}
  </button>
}
