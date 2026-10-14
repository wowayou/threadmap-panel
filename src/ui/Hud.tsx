import { h } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import type { ChainResult } from '../core/chain'
import type { QaResult } from '../core/questions'
import type { Prefs } from '../core/storage'
import type { Post } from '../core/types'
import { useDockDrag } from './useDockDrag'
import type { Tab } from './widget-state'

interface Props {
  chain: ChainResult
  qa: QaResult | null
  byId: Map<number, Post>
  loaded: number
  total?: number
  dock: Prefs['dock']
  focus: boolean
  onFocused: () => void
  onExpand: (tab?: Tab) => void
  onCollapse: () => void
  onJump: (id: number) => void
  onDock: (dock: Prefs['dock']) => void
}

/**
 * 钉住的小窗：参考 Xbox Game Bar 的性能小组件——标题栏可拖动、三格数字读数、一个主要操作。
 * 尺寸固定（tokens.layout.hud*），背景不透明以保证对比度（docs/ui-spec.md §3）。
 */
export function Hud({ chain, qa, byId, loaded, total, dock, focus, onFocused, onExpand, onCollapse, onJump, onDock }: Props) {
  const { target, offset, dragStyle, guardClick, handlers } = useDockDrag(onDock)
  const expandButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { if (focus) { expandButton.current?.focus(); onFocused() } }, [focus])

  const head = chain.heads[0]
  const top = qa?.repeated[0]
  const metrics: { value: string; label: string; tab: Tab }[] = qa
    ? [{ value: String(qa.repeated.length), label: '重复问题', tab: 'qa' }, { value: String(qa.questions.size), label: '提问楼', tab: 'qa' }, { value: total ? `${loaded}/${total}` : String(loaded), label: '已载入', tab: 'qa' }]
    : [{ value: head ? head.last.value.slice(-1) : '–', label: '现在该接', tab: 'chain' }, { value: String(chain.issues.length), label: '问题', tab: 'issues' }, { value: total ? `${loaded}/${total}` : String(loaded), label: '已载入', tab: 'chain' }]
  const foot = qa
    ? top ? { text: `问过 ${top.questionIds.length} 次：${top.text}`, action: '查看', id: top.questionIds[0] } : { text: '没有发现重复提问', action: '', id: 0 }
    : head ? { text: `#${head.postNumber} ${byId.get(head.postId)?.username ?? ''}「${head.last.value}」`, action: `跳到 #${head.postNumber}`, id: head.postId } : { text: '没有识别到接龙', action: '', id: 0 }

  return <section ref={el => { target.current = el }} class="tm-hud" data-side={dock.side} data-dragging={offset ? 'true' : undefined} role="region" aria-label={qa ? 'ThreadMap 问答小窗' : 'ThreadMap 接龙小窗'} onKeyDown={e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); onCollapse() } }} style={{ '--tm-edge-ratio': String(dock.ratio), ...dragStyle }}>
    <div class="tm-hud-bar" title="拖动可移到另一侧" {...handlers}>
      <span class="tm-hud-title">ThreadMap</span>
      <button type="button" class="tm-icon" ref={expandButton} aria-label="展开面板" onClick={guardClick(() => onExpand())}>⤢</button>
      <button type="button" class="tm-icon" aria-label="收起小窗" onClick={guardClick(onCollapse)}>×</button>
    </div>
    <div class="tm-hud-metrics">{metrics.map(m => <button type="button" class="tm-metric" key={m.label} aria-label={`${m.label} ${m.value}，展开查看`} onClick={() => onExpand(m.tab)}><b>{m.value}</b><span>{m.label}</span></button>)}</div>
    <div class="tm-hud-foot">
      <span class="tm-hud-text">{foot.text}</span>
      {foot.action && <button type="button" class="tm-button" data-variant="primary" onClick={() => qa ? onExpand('qa') : onJump(foot.id)}>{foot.action}</button>}
    </div>
  </section>
}
