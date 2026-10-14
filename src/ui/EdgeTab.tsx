import { h } from 'preact'
import { useLayoutEffect } from 'preact/hooks'
import type { ChainResult } from '../core/chain'
import type { QaResult } from '../core/questions'
import type { Prefs } from '../core/storage'
import { useDockDrag } from './useDockDrag'

/** 收起状态的贴边按钮：显示“现在该接”的字和问题数；可拖到另一侧（docs/ui-spec.md §3） */
export function EdgeTab({ chain, qa, dock, focus, onFocused, onOpen, onDock }: { chain: ChainResult; qa: QaResult | null; dock: Prefs['dock']; focus: boolean; onFocused: () => void; onOpen: () => void; onDock: (dock: Prefs['dock']) => void }) {
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

  const next = qa ? '?' : chain.heads[0]?.last.value.slice(-1)
  const issues = qa ? qa.repeated.length : chain.issues.length
  const label = qa
    ? `展开 ThreadMap 面板${issues ? `，${issues} 个问题被重复问过` : ''}`
    : `展开 ThreadMap 接龙面板${next ? `，现在该接“${next}”` : ''}${issues ? `，${issues} 个问题` : ''}`

  return <button
    ref={el => { target.current = el }}
    type="button"
    class="tm-edge"
    data-side={dock.side}
    data-drag-handle
    data-dragging={offset ? 'true' : undefined}
    aria-label={label}
    title="ThreadMap · 拖动可换到另一侧"
    style={{ '--tm-edge-ratio': String(dock.ratio), ...dragStyle }}
    {...handlers}
    onClick={guardClick(onOpen)}
  >
    <span class="tm-edge-char" aria-hidden="true">{next || '⌁'}</span>
    {issues ? <span class="tm-count" aria-hidden="true">{issues}</span> : null}
  </button>
}
