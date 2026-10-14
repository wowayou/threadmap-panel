import { h } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ChainResult } from '../core/chain'
import type { QaResult } from '../core/questions'
import type { HostApi, SessionState } from '../core/session'
import { PANEL_WIDTH, type Prefs } from '../core/storage'
import { ChainView } from './ChainView'
import { IssuesView } from './IssuesView'
import { QaView } from './QaView'
import { RulesView } from './RulesView'
import type { Tab, UiEvent, UiState } from './widget-state'

/** 超过这么多楼未载入时，加载前先确认 */
const LARGE_LOAD = 1000
/** 估算耗时：每批 20 楼，批间隔 0.5 秒，加上约 0.3 秒请求时间 */
const estimateMinutes = (missing: number) => Math.max(1, Math.round(Math.ceil(missing / 20) * 0.8 / 60))

const CHAIN_TABS: { id: Tab; label: string }[] = [{ id: 'chain', label: '接龙' }, { id: 'issues', label: '问题' }, { id: 'rules', label: '规则' }]
const QA_TABS: { id: Tab; label: string }[] = [{ id: 'qa', label: '问答' }, { id: 'rules', label: '规则' }]

export interface OverrideApi { save: (childId: number, parentId: number | null) => void; restore: (childId: number) => void; has: (childId: number) => boolean; count: number }

interface Props {
  host: HostApi
  state: SessionState
  chain: ChainResult
  /** 非 null 时为问答模式 */
  qa: QaResult | null
  prefs: Prefs
  updatePrefs: (next: Partial<Prefs>) => void
  overrides: OverrideApi
  storageFailed: boolean
  ui: UiState
  dispatch: (event: UiEvent) => void
}

/** 展开的面板：标题栏 / 标签栏 / 状态栏三个固定区域 + 唯一可滚动的内容区（docs/ui-spec.md §3） */
export function Panel({ host, state, chain, qa, prefs, updatePrefs, overrides, storageFailed, ui, dispatch }: Props) {
  const { origin, topicId, posts, stream } = state
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [message, setMessage] = useState<{ tone: 'bad' | 'neutral'; text: string } | null>(null)
  const [width, setWidth] = useState(prefs.width)
  const controller = useRef<AbortController | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const scrollMemory = useRef<Record<Tab, number>>({ chain: 0, issues: 0, rules: 0, qa: 0 })
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ chain: null, issues: null, rules: null, qa: null })
  const TABS = qa ? QA_TABS : CHAIN_TABS
  const byId = useMemo(() => new Map(posts.map(post => [post.id, post])), [posts])
  const [confirmLarge, setConfirmLarge] = useState(false)

  useEffect(() => () => controller.current?.abort(), [])
  useLayoutEffect(() => { if (ui.focus === 'tabs') { tabRefs.current[ui.tab]?.focus(); dispatch({ type: 'focusDone' }) } }, [ui.focus])
  // 各标签记住自己的滚动位置：滚动时持续记录（任何途径切换标签都不会漏记），切换后恢复
  const activeTab = useRef(ui.tab)
  useLayoutEffect(() => { activeTab.current = ui.tab; if (body.current) body.current.scrollTop = scrollMemory.current[ui.tab] }, [ui.tab])
  const onScroll = () => { if (body.current) scrollMemory.current[activeTab.current] = body.current.scrollTop }

  const setTab = (tab: Tab) => dispatch({ type: 'setTab', tab })
  const select = (id: number) => dispatch({ type: 'select', id })
  const jump = (id: number) => { const post = byId.get(id); if (post) { select(id); host.jump(post) } }

  const load = async (confirmed = false) => {
    if (!host.loadAll) return
    if (busy) { controller.current?.abort(); return }
    // 超大主题先说明代价：请求数与大致耗时，由用户确认后再开始
    if (!confirmed && (chain.missing ?? 0) > LARGE_LOAD) { setConfirmLarge(true); return }
    setConfirmLarge(false)
    const c = new AbortController()
    controller.current = c; setBusy(true); setMessage(null)
    try {
      await host.loadAll((loaded, total) => setProgress({ loaded, total }), c.signal)
    } catch (e) {
      const error = e as Error
      setMessage(error.name === 'AbortError' ? { tone: 'neutral', text: '已取消。已经载入的楼层会保留。' } : { tone: 'bad', text: error.message })
    } finally {
      if (controller.current === c) controller.current = null
      setBusy(false)
    }
  }

  const setPanelWidth = (next: number, save: boolean) => {
    const clamped = Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, Math.round(next)))
    setWidth(clamped)
    if (save) updatePrefs({ width: clamped })
  }
  const resizeStart = (e: PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX, startWidth = width, sign = prefs.dock.side === 'right' ? -1 : 1
    let latest = startWidth
    const move = (x: PointerEvent) => { latest = startWidth + sign * (x.clientX - startX); setPanelWidth(latest, false) }
    const done = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', done); setPanelWidth(latest, true) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', done)
  }
  const resizeKey = (e: KeyboardEvent) => {
    const grow = prefs.dock.side === 'right' ? 'ArrowLeft' : 'ArrowRight', shrink = prefs.dock.side === 'right' ? 'ArrowRight' : 'ArrowLeft'
    if (e.key !== grow && e.key !== shrink) return
    e.preventDefault(); setPanelWidth(width + (e.key === grow ? 16 : -16), true)
  }
  const tabKey = (e: KeyboardEvent) => {
    const index = TABS.findIndex(t => t.id === ui.tab)
    const next = e.key === 'ArrowRight' ? (index + 1) % TABS.length : e.key === 'ArrowLeft' ? (index - 1 + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1
    if (next < 0) return
    e.preventDefault(); setTab(TABS[next].id); tabRefs.current[TABS[next].id]?.focus()
  }
  const panelKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    e.stopPropagation(); dispatch({ type: 'escape' })
  }

  const total = stream?.length
  const missing = chain.missing ?? 0
  const complete = total !== undefined && missing === 0
  const source = state.source === 'dom' ? '仅页面上显示的楼层' : state.source === 'demo' ? '本地演示数据' : complete ? '已载入全部楼层' : `还有 ${missing} 楼未载入`
  const statusText = busy && progress ? `正在载入 ${progress.loaded}/${progress.total} 楼` : `${source}${state.readingPosition !== undefined ? ` · 阅读 #${state.readingPosition}` : ''}`
  const loadLabel = busy ? '取消加载' : complete ? '检查新楼层' : '加载全部楼层'
  const view = { chain, settings: prefs.settings, byId, onSelect: select, onJump: jump }

  return <section class="tm-panel" data-side={prefs.dock.side} data-mode={ui.mode} hidden={ui.mode === 'collapsed' || ui.mode === 'hud'} role="complementary" aria-label={qa ? 'ThreadMap 问答面板' : 'ThreadMap 接龙面板'} style={{ '--tm-w': `${width}px` }} onKeyDown={panelKey}>
    <div class="tm-resize" role="separator" aria-orientation="vertical" aria-label="调整面板宽度" aria-valuemin={PANEL_WIDTH.min} aria-valuemax={PANEL_WIDTH.max} aria-valuenow={width} tabIndex={0} onPointerDown={resizeStart} onKeyDown={resizeKey} />
    <header class="tm-header">
      <h1 class="tm-title">{qa ? '帖子问答' : '接龙追踪'}<small>{origin === 'demo' ? '演示' : '主题'} #{topicId} · 已载入 {posts.length} 楼{total ? ` / ${total}` : ''}</small></h1>
      <button type="button" class="tm-icon" onClick={() => dispatch({ type: 'pin' })} aria-label="钉成小窗" title="钉成小窗（像游戏里的性能小组件）">▣</button>
      <button type="button" class="tm-icon" data-action="full" onClick={() => dispatch({ type: 'toggleFull' })} aria-label={ui.mode === 'full' ? '退出全屏' : '全屏'} aria-pressed={ui.mode === 'full'}>{ui.mode === 'full' ? '⤡' : '⤢'}</button>
      <button type="button" class="tm-icon" onClick={() => dispatch({ type: 'collapse' })} aria-label="收起面板">{prefs.dock.side === 'right' ? '›' : '‹'}</button>
    </header>
    <div class="tm-tabs" role="tablist" aria-label="视图" onKeyDown={tabKey}>
      {TABS.map(t => <button type="button" key={t.id} id={`tm-tab-${t.id}`} ref={el => { tabRefs.current[t.id] = el }} class="tm-tab" role="tab" aria-selected={ui.tab === t.id} aria-controls="tm-tabpanel" tabIndex={ui.tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}>
        {t.label}{t.id === 'issues' && chain.issues.length ? <span class="tm-count" aria-label={`${chain.issues.length} 个`}>{chain.issues.length}</span> : t.id === 'qa' && qa?.repeated.length ? <span class="tm-count" aria-label={`${qa.repeated.length} 个重复问题`}>{qa.repeated.length}</span> : null}
      </button>)}
    </div>
    <div class="tm-status">
      <span class="tm-status-text" role="status" aria-live="polite">{statusText}</span>
      {host.loadAll && <button type="button" class="tm-button" data-variant={!busy && !complete ? 'primary' : undefined} onClick={() => load()}>{loadLabel}</button>}
      {busy && progress && <div class="tm-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, progress.loaded / Math.max(1, progress.total) * 100)}%` }} /></div>}
    </div>
    <div class="tm-body" id="tm-tabpanel" role="tabpanel" aria-labelledby={`tm-tab-${ui.tab}`} ref={body} tabIndex={-1} onScroll={onScroll}>
      <div class="tm-stack">
        {confirmLarge && <div class="tm-banner" data-tone="warn" role="alert"><b>这个主题还有 {missing} 楼未载入</b>需要约 {Math.ceil(missing / 20)} 次请求、大约 {estimateMinutes(missing)} 分钟。加载期间可以继续浏览，随时可以取消，已载入的部分会保留。<div class="tm-actions"><button type="button" class="tm-button" data-variant="primary" onClick={() => load(true)}>开始加载</button><button type="button" class="tm-button" onClick={() => setConfirmLarge(false)}>先不加载</button></div></div>}
        {message && <div class="tm-banner" data-tone={message.tone} role={message.tone === 'bad' ? 'alert' : undefined}>{message.text}</div>}
        {!qa && chain.unknownCount > 0 && !busy && <div class="tm-banner">有 {chain.unknownCount} 处因为前文没载入而无法判断，已标为“前文未载入”。{host.loadAll ? '加载全部楼层后会重新判断。' : ''}</div>}
        {storageFailed && <div class="tm-banner" data-tone="bad" role="alert">浏览器禁止了本地存储，刚才的纠正只在当前页面有效。</div>}
        {ui.tab === 'chain' && !qa && <ChainView {...view} selected={ui.selected} annotate={prefs.annotate} focusDetail={ui.focus === 'detail'} onFocused={() => dispatch({ type: 'focusDone' })} onOverride={overrides.save} onRestore={overrides.restore} hasOverride={overrides.has} onShowIssues={() => setTab('issues')} onForceAnnotate={() => updatePrefs({ annotate: 'on' })} />}
        {ui.tab === 'issues' && !qa && <IssuesView {...view} readingPosition={state.readingPosition} onDetail={id => dispatch({ type: 'showPost', id })} />}
        {ui.tab === 'qa' && qa && <QaView qa={qa} byId={byId} selected={ui.selected} focusDetail={ui.focus === 'detail'} onFocused={() => dispatch({ type: 'focusDone' })} onSelect={select} onJump={jump} missing={missing} />}
        {ui.tab === 'rules' && <RulesView qaMode={!!qa} prefs={prefs} overrideCount={overrides.count} onPrefs={updatePrefs} />}
      </div>
    </div>
  </section>
}
