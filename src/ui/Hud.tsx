import { h } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import type { TopicAnalysis } from '../core/analysis'
import type { Prefs } from '../core/storage'
import type { Post, PostNavigation } from '../core/types'
import { useI18n } from './I18n'
import { PostLink } from './PostLink'
import { useDockDrag } from './useDockDrag'
import type { Tab } from './widget-state'

interface Props {
  analysis: TopicAnalysis
  byId: Map<number, Post>
  loaded: number
  total?: number
  dock: Prefs['dock']
  focus: boolean
  onFocused: () => void
  onExpand: (tab?: Tab) => void
  onShow: (id: number) => void
  onCollapse: () => void
  navigation: PostNavigation
  onDock: (dock: Prefs['dock']) => void
}

/**
 * 钉住的小窗：参考 Xbox Game Bar 的性能小组件——标题栏可拖动、三格数字读数、一个主要操作。
 * 尺寸固定（tokens.layout.hud*），背景不透明以保证对比度（docs/ui-spec.md §3）。
 */
export function Hud({ analysis, byId, loaded, total, dock, focus, onFocused, onExpand, onShow, onCollapse, navigation, onDock }: Props) {
  const { t } = useI18n()
  const { target, offset, dragStyle, guardClick, handlers } = useDockDrag(onDock)
  const expandButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { if (focus) { expandButton.current?.focus(); onFocused() } }, [focus])

  const chain = analysis.mode === 'chain' ? analysis.result : null
  const qa = analysis.mode === 'qa' ? analysis.result : null
  const head = chain?.heads[0]
  const top = qa?.repeated[0]
  const loadedMetric = { value: String(loaded), label: t('common.loaded'), detail: total === undefined ? t('common.unknownTotal') : t('common.total', { count: total }), tab: (qa ? 'qa' : 'chain') as Tab }
  const metrics: { value: string; label: string; detail?: string; tab: Tab }[] = qa
    ? [{ value: String(qa.repeated.length), label: t('hud.repeated'), tab: 'qa' }, { value: String(qa.questions.size), label: t('hud.questions'), tab: 'qa' }, loadedMetric]
    : [{ value: head ? head.last.value.slice(-1) : '–', label: t('hud.next'), tab: 'chain' }, { value: String(chain!.issues.length), label: t('common.issues'), tab: 'issues' }, loadedMetric]
  const foot = qa
    ? top ? { text: t('hud.asked', { count: top.questionIds.length, text: top.text }), action: t('hud.view'), id: top.questionIds[0] } : { text: t('hud.noRepeated'), action: t('hud.search'), id: 0 }
    : head ? { text: `#${head.postNumber} ${byId.get(head.postId)?.username ?? ''}「${head.last.value}」`, action: t('common.jump', { number: head.postNumber }), id: head.postId } : { text: t('hud.noChain'), action: '', id: 0 }

  return <section ref={el => { target.current = el }} class="tm-hud" data-side={dock.side} data-dragging={offset ? 'true' : undefined} role="region" aria-label={t(qa ? 'hud.qa' : 'hud.chain')} onKeyDown={e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); onCollapse() } }} style={{ '--tm-edge-ratio': String(dock.ratio), ...dragStyle }}>
    <div class="tm-hud-bar" title={t('common.drag')} {...handlers}>
      <span class="tm-hud-title">ThreadMap</span>
      <button type="button" class="tm-icon" ref={expandButton} aria-label={t('common.expand')} onClick={guardClick(() => onExpand())}>⤢</button>
      <button type="button" class="tm-icon" aria-label={t('hud.collapse')} onClick={guardClick(onCollapse)}>×</button>
    </div>
    <div class="tm-hud-metrics">{metrics.map((m, index) => <button type="button" class="tm-metric" key={index} title={`${m.label} ${m.value}${m.detail ? ` · ${m.detail}` : ''}`} aria-label={t('hud.metric', { label: m.label, value: m.value, detail: m.detail ? ` · ${m.detail}` : '' })} onClick={() => onExpand(m.tab)}><b data-dense={m.value.length > 5 ? 'true' : undefined}>{m.value}</b><span>{m.label}</span>{m.detail && <small>{m.detail}</small>}</button>)}</div>
    <div class="tm-hud-foot">
      <span class="tm-hud-text" title={foot.text}>{foot.text}</span>
      {foot.action && (qa ? <button type="button" class="tm-button" data-variant="primary" onClick={() => foot.id ? onShow(foot.id) : onExpand('qa')}>{foot.action}</button> : <PostLink post={byId.get(foot.id)} navigation={navigation} primary>{foot.action}</PostLink>)}
    </div>
  </section>
}
