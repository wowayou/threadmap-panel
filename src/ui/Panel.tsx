import { h } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { TopicAnalysis } from '../core/analysis'
import { isProtectionFailure, loadPolicy, type LoadMeter } from '../core/load-policy'
import type { HostApi, PostCoverage, SessionState } from '../core/session'
import { PANEL_WIDTH, type Prefs } from '../core/storage'
import { errorText, message as msg, type Text } from '../i18n'
import { useI18n } from './I18n'
import { ChainView } from './ChainView'
import { useCacheState } from './CacheControls'
import { CoverageView } from './CoverageView'
import { LoadControls } from './LoadControls'
import { IssuesView } from './IssuesView'
import { QaView } from './QaView'
import type { ViewMemory } from './remembered'
import { RulesView } from './RulesView'
import type { Tab, UiEvent, UiState } from './widget-state'

type TabItem = { id: Tab; label: 'common.chain' | 'common.issues' | 'common.rules' | 'common.qa' }
const CHAIN_TABS: TabItem[] = [{ id: 'chain', label: 'common.chain' }, { id: 'issues', label: 'common.issues' }, { id: 'rules', label: 'common.rules' }]
const QA_TABS: TabItem[] = [{ id: 'qa', label: 'common.qa' }, { id: 'rules', label: 'common.rules' }]

export interface OverrideApi { save: (childId: number, parentId: number | null) => void; restore: (childId: number) => void; has: (childId: number) => boolean; count: number }

interface Props {
  host: HostApi
  state: SessionState
  analysis: TopicAnalysis
  /** 只读数据范围，由会话独立计算，不依赖任一分析引擎 */
  coverage: PostCoverage
  prefs: Prefs
  updatePrefs: (next: Partial<Prefs>) => void
  overrides: OverrideApi
  storageFailed: boolean
  ui: UiState
  dispatch: (event: UiEvent) => void
}

/** 展开的面板：标题栏 / 标签栏 / 状态栏三个固定区域 + 唯一可滚动的内容区（docs/ui-spec.md §3） */
export function Panel({ host, state, analysis, coverage, prefs, updatePrefs, overrides, storageFailed, ui, dispatch }: Props) {
  const { t, format } = useI18n()
  const { origin, topicId, posts } = state
  const cacheState = useCacheState(host.cache)
  const chain = analysis.mode === 'chain' ? analysis.result : null
  const qa = analysis.mode === 'qa' ? analysis.result : null
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ loaded: number; total: number; meter?: LoadMeter } | null>(null)
  const [message, setMessage] = useState<{ tone: 'bad' | 'neutral'; text: Text } | null>(null)
  const [width, setWidth] = useState(prefs.width)
  const controller = useRef<AbortController | null>(null)
  const loadButton = useRef<HTMLButtonElement>(null)
  const loadConfirmation = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [memory] = useState<ViewMemory>(() => new Map())
  const scrollMemory = useRef(new Map<string, number>())
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ chain: null, issues: null, rules: null, qa: null })
  const TABS = qa ? QA_TABS : CHAIN_TABS
  const byId = useMemo(() => new Map(posts.map(post => [post.id, post])), [posts])
  const [confirmLoad, setConfirmLoad] = useState(false)
  const [background, setBackground] = useState(false)
  const side = state.placement?.side ?? prefs.dock.side
  const canLoad = !!host.loadAll

  useEffect(() => () => controller.current?.abort(), [])
  // 拖动宽度时卸载（换主题/离开）：移除全局监听，不把半途宽度写进偏好或新布局。
  const stopResize = useRef<((save: boolean) => void) | null>(null)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false; stopResize.current?.(false) }, [])
  // 关闭补取许可（包括其他标签页关闭）时取消本页正在进行的加载；已交出的合法数据由宿主保留。
  useEffect(() => { if (!prefs.allowLoad) { controller.current?.abort(); setConfirmLoad(false) } }, [prefs.allowLoad])
  useLayoutEffect(() => {
    if (confirmLoad) {
      if (body.current) body.current.scrollTop = 0
      loadConfirmation.current?.focus({ preventScroll: true })
    }
  }, [confirmLoad])
  useLayoutEffect(() => { if (ui.focus === 'tabs') { tabRefs.current[ui.tab]?.focus(); dispatch({ type: 'focusDone' }) } }, [ui.focus])
  // 每个模式的每个标签记住自己的滚动位置：滚动时持续记录，切换模式或标签后恢复
  const scrollKey = `${analysis.mode}:${ui.tab}`
  const activeScroll = useRef(scrollKey)
  useLayoutEffect(() => { activeScroll.current = scrollKey; if (body.current) body.current.scrollTop = scrollMemory.current.get(scrollKey) ?? 0 }, [scrollKey])
  const onScroll = () => { if (body.current) scrollMemory.current.set(activeScroll.current, body.current.scrollTop) }

  const setTab = (tab: Tab) => dispatch({ type: 'setTab', tab })
  const select = (id: number) => dispatch({ type: 'select', id })
  const dismissConfirm = () => { setConfirmLoad(false); loadButton.current?.focus({ preventScroll: true }) }

  const load = async (confirmed = false) => {
    if (!host.loadAll) return
    if (controller.current) { controller.current.abort(); return }
    // 初次授权与本次参数在一个确认中完成；仅查看或取消不能开启许可。
    if (!confirmed) { setBackground(false); setConfirmLoad(true); return }
    if (!prefs.allowLoad) updatePrefs({ allowLoad: true })
    dismissConfirm()
    const c = new AbortController()
    controller.current = c; setBusy(true); setMessage(null); setProgress(null)
    try {
      const result = await host.loadAll((loaded, total, meter) => setProgress({ loaded, total, meter }), c.signal, { maxPosts: prefs.loadCount, delayMs: loadPolicy.minIntervalMs, continueInBackground: background })
      if (result) setMessage({ tone: 'neutral', text: msg('load.result', { added: result.added, requests: result.requests, reason: msg(result.reason === 'complete' ? 'load.complete' : result.reason === 'target' ? 'load.target' : 'load.budget'), seconds: loadPolicy.actionCooldownMs / 1000 }) })
    } catch (e) {
      const error = e as Error
      if (error.name === 'AbortError') setMessage({ tone: 'neutral', text: msg('load.cancelled', { reason: errorText(error) }) })
      else if (isProtectionFailure(error)) {
        updatePrefs({ allowLoad: false })
        setMessage({ tone: 'bad', text: msg('load.protected', { reason: errorText(error) }) })
      } else setMessage({ tone: 'bad', text: errorText(error) })
    } finally {
      if (controller.current === c) controller.current = null
      setBusy(false)
    }
  }

  const setPanelWidth = (next: number, save: boolean) => {
    const clamped = Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, Math.round(next)))
    setWidth(clamped)
    host.setLayout?.({ mode: ui.mode, side: prefs.dock.side, width: clamped })
    if (save) updatePrefs({ width: clamped })
  }
  const resizeStart = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    stopResize.current?.(false)
    const startX = e.clientX, startWidth = width, sign = side === 'right' ? -1 : 1, pointer = e.pointerId
    let latest = startWidth
    const move = (x: PointerEvent) => { if (x.pointerId !== pointer) return; latest = startWidth + sign * (x.clientX - startX); setPanelWidth(latest, false) }
    const up = (x: PointerEvent) => { if (x.pointerId === pointer) stop(true) }
    const cancel = (x: PointerEvent) => { if (x.pointerId === pointer) stop(false) }
    // 结束、取消和卸载共用同一个清理；只有正常松手才保存，取消恢复拖动前宽度。
    const stop = (save: boolean) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel)
      stopResize.current = null
      if (save) setPanelWidth(latest, true)
      else if (mounted.current) setPanelWidth(startWidth, false)
    }
    stopResize.current = stop
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel)
  }
  const resizeKey = (e: KeyboardEvent) => {
    const grow = side === 'right' ? 'ArrowLeft' : 'ArrowRight', shrink = side === 'right' ? 'ArrowRight' : 'ArrowLeft'
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
    e.stopPropagation()
    if (confirmLoad) { e.preventDefault(); dismissConfirm() }
    else dispatch({ type: 'escape' })
  }

  const total = coverage.total
  const missing = coverage.missing ?? 0
  const complete = total !== undefined && missing === 0
  const source = state.source === 'dom' ? t('panel.dom') : state.source === 'demo' ? t('panel.demoSource') : complete ? t('panel.complete') : total === undefined ? t('panel.unknown') : t('panel.missing', { count: missing })
  const statusText = busy && progress ? t('panel.loading', progress) : `${source}${state.readingPosition !== undefined ? t('panel.reading', { number: state.readingPosition }) : ''}`
  const loadLabel = t(busy ? 'load.cancel' : !prefs.allowLoad ? 'load.choose' : complete ? 'load.check' : 'load.more')

  return <section class="tm-panel" data-side={side} data-layout={state.placement?.kind} data-mode={ui.mode} hidden={ui.mode === 'collapsed' || ui.mode === 'hud'} role="complementary" aria-label={t(qa ? 'panel.qa' : 'panel.chain')} style={{ '--tm-w': `${width}px` }} onKeyDown={panelKey}>
    <div class="tm-resize" role="separator" aria-orientation="vertical" aria-label={t('panel.resize')} aria-valuemin={PANEL_WIDTH.min} aria-valuemax={PANEL_WIDTH.max} aria-valuenow={width} tabIndex={0} onPointerDown={resizeStart} onKeyDown={resizeKey} />
    <header class="tm-header">
      <h1 class="tm-title">{t(qa ? 'panel.qaTitle' : 'panel.chainTitle')}<small title={t(origin === 'demo' ? 'panel.demo' : 'panel.topic', { id: topicId, loaded: coverage.loaded })}>{t(origin === 'demo' ? 'panel.demo' : 'panel.topic', { id: topicId, loaded: coverage.loaded })}{total !== undefined ? ` / ${total}` : ''}</small></h1>
      <button type="button" class="tm-icon" onClick={() => dispatch({ type: 'pin' })} aria-label={t('panel.pin')} title={t('panel.pin')}>▣</button>
      <button type="button" class="tm-icon" data-action="full" onClick={() => dispatch({ type: 'toggleFull' })} aria-label={t(ui.mode === 'full' ? 'panel.exitFull' : 'panel.full')} aria-pressed={ui.mode === 'full'}>{ui.mode === 'full' ? '⤡' : '⤢'}</button>
      <button type="button" class="tm-icon" onClick={() => dispatch({ type: 'collapse' })} aria-label={t('panel.collapse')}>{side === 'right' ? '›' : '‹'}</button>
    </header>
    <div class="tm-tabs" role="tablist" aria-label={t('panel.views')} onKeyDown={tabKey}>
      {TABS.map(item => <button type="button" key={item.id} id={`tm-tab-${item.id}`} ref={el => { tabRefs.current[item.id] = el }} class="tm-tab" role="tab" aria-selected={ui.tab === item.id} aria-controls="tm-tabpanel" tabIndex={ui.tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}>
        {t(item.label)}{item.id === 'issues' && chain?.issues.length ? <span class="tm-count" aria-label={t('common.count', { count: chain.issues.length })}>{chain.issues.length}</span> : item.id === 'qa' && qa?.repeated.length ? <span class="tm-count" aria-label={t('panel.repeated', { count: qa.repeated.length })}>{qa.repeated.length}</span> : null}
      </button>)}
    </div>
    <div class="tm-status">
      <span class="tm-status-text" role="status" aria-live="polite">{statusText}</span>
      {canLoad && <button type="button" ref={loadButton} class="tm-button" data-variant={busy || !prefs.allowLoad || complete ? undefined : 'primary'} aria-expanded={confirmLoad} aria-controls={confirmLoad ? 'tm-load-confirm' : undefined} onClick={() => load()}>{loadLabel}</button>}
      {busy && progress && <div class="tm-progress" aria-hidden="true"><i style={{ width: `${Math.min(100, progress.loaded / Math.max(1, progress.total) * 100)}%` }} /></div>}
    </div>
    <div class="tm-body" id="tm-tabpanel" role="tabpanel" aria-labelledby={`tm-tab-${ui.tab}`} ref={body} tabIndex={-1} onScroll={onScroll}>
      <div class="tm-stack">
        {confirmLoad && <div class="tm-banner" data-tone="warn" role="alert" id="tm-load-confirm" aria-label={t('load.confirm')} tabIndex={-1} ref={loadConfirmation}>
          <b>{total === undefined ? t('load.unknown') : missing ? t('load.remaining', { count: missing }) : t('load.checkTitle')}</b>
          {missing > 0 && <span>{t('load.batches', { count: Math.ceil(missing / loadPolicy.batchSize) })}</span>}
          <form class="tm-stack" onSubmit={e => { e.preventDefault(); if (e.currentTarget.reportValidity()) void load(true) }}>
            <LoadControls id="tm-action-load" prefs={prefs} onPrefs={updatePrefs} />
            <label class="tm-check"><input type="checkbox" checked={background} onChange={e => setBackground(e.currentTarget.checked)} />{t('load.background')}</label>
            <p class="tm-note">{t('load.backgroundHint', { minutes: loadPolicy.actionTimeoutMs / 60_000 })}</p>
            <p class="tm-note">{t('load.limits', { requests: loadPolicy.maxRequests, batch: loadPolicy.batchSize, seconds: loadPolicy.minIntervalMs / 1000, cooldown: loadPolicy.actionCooldownMs / 1000 })}</p>
            {!prefs.allowLoad && <p class="tm-note">{t('load.firstConsent')}</p>}
            <p class="tm-note">{t('load.siteWarning')}</p>
            <div class="tm-actions"><button type="submit" class="tm-button" data-variant="primary">{t(prefs.allowLoad ? 'load.start' : 'load.allowStart')}</button><button type="button" class="tm-button" onClick={dismissConfirm}>{t('load.notNow')}</button></div>
          </form>
        </div>}
        {state.placement?.kind === 'drawer' && <div class="tm-banner">{t('panel.drawer')}<button type="button" class="tm-button" onClick={() => dispatch({ type: 'collapse' })}>{t('panel.collapseRead')}</button></div>}
        {state.placement?.kind === 'sidecar' && state.placement.side !== prefs.dock.side && <p class="tm-note">{t('panel.opposite', { side: t(state.placement.side === 'left' ? 'panel.left' : 'panel.right') })}</p>}
        {busy && progress?.meter && <div class="tm-banner" role="status" aria-label={t('load.action')}><span>{t('load.progress', { ...progress.meter, max: loadPolicy.maxRequests })}</span><progress class="tm-load-progress" aria-label={t('load.newPosts')} max={progress.meter.target} value={progress.meter.added} /><span>{t(background ? 'load.continuing' : 'load.stopping')}</span></div>}
        {(ui.tab === 'chain' || ui.tab === 'qa') && <CoverageView coverage={coverage} />}
        {message && <div class="tm-banner" data-tone={message.tone} role={message.tone === 'bad' ? 'alert' : undefined}>{format(message.text)}</div>}
        {!!state.cachedCount && <div class="tm-banner">{t('panel.cached', { count: state.cachedCount })}</div>}
        {cacheState?.error && <div class="tm-banner" data-tone="bad" role="alert">{format(cacheState.message)}</div>}
        {chain && chain.unknownCount > 0 && !busy && <div class="tm-banner">{t('panel.unknownChain', { count: chain.unknownCount })}{canLoad ? t('panel.moreContext') : ''}</div>}
        {storageFailed && <div class="tm-banner" data-tone="bad" role="alert">{t('panel.storageFailed')}</div>}
        {chain && ui.tab === 'chain' && <ChainView chain={chain} settings={prefs.settings} byId={byId} onSelect={select} navigation={host.navigation} memory={memory} selected={ui.selected} annotate={prefs.annotate.chain} focusDetail={ui.focus === 'detail'} onFocused={() => dispatch({ type: 'focusDone' })} onOverride={overrides.save} onRestore={overrides.restore} hasOverride={overrides.has} onShowIssues={() => setTab('issues')} onForceAnnotate={() => updatePrefs({ annotate: { ...prefs.annotate, chain: 'on' } })} />}
        {chain && ui.tab === 'issues' && <IssuesView chain={chain} settings={prefs.settings} byId={byId} onSelect={select} navigation={host.navigation} memory={memory} readingPosition={state.readingPosition} onDetail={id => dispatch({ type: 'showPost', id })} />}
        {/* 问答页切到规则时只隐藏，不卸载查询、分页和预览状态；隐藏期间不抢焦点。 */}
        {qa && <div class="tm-stack" hidden={ui.tab !== 'qa'}><QaView qa={qa} byId={byId} selected={ui.selected} active={ui.tab === 'qa' && (ui.mode === 'open' || ui.mode === 'full')} focusDetail={ui.focus === 'detail'} onFocused={() => dispatch({ type: 'focusDone' })} onSelect={select} navigation={host.navigation} missing={missing} settings={prefs.qa} memory={memory} scrollContainer={body} confirmingLoad={confirmLoad} /></div>}
        {ui.tab === 'rules' && <RulesView tool={analysis.mode} prefs={prefs} overrideCount={overrides.count} canLoad={!!host.loadAll} cache={host.cache} onPrefs={updatePrefs} />}
      </div>
    </div>
  </section>
}
