import { h } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks'
import { badgeFor, buildChain, defaultChainSettings, looksLikeChainTopic, type Badge } from '../core/chain'
import type { TopicAnalysis } from '../core/analysis'
import { buildQa, type QaResult } from '../core/questions'
import { postCoverage, type HostApi, type Session, type SessionState } from '../core/session'
import { PREFS_KEY, readOverrides, readPrefs, writeOverrides, writePrefs, type Prefs } from '../core/storage'
import type { Override } from '../core/types'
import { i18n, resolveLocale, type Locale } from '../i18n'
import { I18nContext } from './I18n'
import { EdgeTab } from './EdgeTab'
import { Hud } from './Hud'
import { Panel } from './Panel'
import { panelCss } from './styles'
import { accentVars, deriveAccent } from './accent'
import { initialWorkspace, viewUi, workspaceReducer, type Mode, type UiEvent } from './widget-state'

/** 订阅宿主会话；订阅后再读一次，避免漏掉渲染与订阅之间的更新 */
function useSession(session: Session): SessionState {
  const [state, setState] = useState(session.get)
  useEffect(() => { const sync = () => setState(session.get()); const off = session.subscribe(sync); sync(); return off }, [session])
  return state
}

const overrideKey = (o: Pick<Override, 'origin' | 'topicId' | 'childId'>) => `${o.origin}:${o.topicId}:${o.childId}`
const sameChainSettings = (a: Prefs['settings'], b: Prefs['settings']) => a.homophone === b.homophone && a.tone === b.tone && a.window === b.window

/** 共享只读数据/窗口；显式模式只运行自己的引擎，业务状态与设置按模式隔离。 */
export function Widget({ host, initialMode = 'collapsed' }: { host: HostApi; initialMode?: Mode }) {
  const state = useSession(host.session)
  const { origin, topicId, posts, stream } = state
  const [workspace, send] = useReducer(workspaceReducer, initialMode, initialWorkspace)
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  const locale = resolveLocale(prefs.language, state.siteLanguage, typeof navigator === 'undefined' ? [] : navigator.languages)
  const language = i18n(locale)
  const [overrides, setOverrides] = useState<Override[]>(() => readOverrides())
  const [prefsFailed, setPrefsFailed] = useState(false)
  const [overridesFailed, setOverridesFailed] = useState(false)
  const opened = useRef(initialMode !== 'collapsed')
  if (workspace.mode !== 'collapsed') opened.current = true

  // 自动识别只用固定默认规则，且不读取本地纠正；显式模式完全不做另一引擎的识别。
  const autoChain = useMemo(() => prefs.mode === 'auto' ? buildChain(posts, defaultChainSettings, [], { stream }) : null, [prefs.mode, posts, stream])
  const view = prefs.mode === 'auto' ? (autoChain && looksLikeChainTopic(autoChain) ? 'chain' : 'qa') : prefs.mode
  const topicOverrides = useMemo(() => overrides.filter(o => o.origin === origin && o.topicId === topicId), [overrides, origin, topicId])
  const chain = useMemo(() => {
    if (view !== 'chain') return null
    if (autoChain && sameChainSettings(prefs.settings, defaultChainSettings) && !topicOverrides.length) return autoChain
    return buildChain(posts, prefs.settings, topicOverrides, { stream })
  }, [view, posts, prefs.settings, topicOverrides, stream, autoChain])
  const qa = useMemo(() => view === 'qa' ? buildQa(posts, prefs.qa) : null, [view, posts, prefs.qa])
  const analysis: TopicAnalysis = chain ? { mode: 'chain', result: chain } : { mode: 'qa', result: qa! }
  const coverage = useMemo(() => postCoverage(posts, stream), [posts, stream])
  const byId = useMemo(() => new Map(posts.map(post => [post.id, post])), [posts])
  const ui = viewUi(workspace, view)
  const dispatch = (event: UiEvent) => send({ tool: view, event })
  const annotate = prefs.annotate[view]
  const dock = state.placement ? { ...prefs.dock, side: state.placement.side } : prefs.dock
  useLayoutEffect(() => host.setLayout?.({ mode: workspace.mode, side: prefs.dock.side, width: prefs.width }), [workspace.mode, prefs.dock.side, prefs.width])
  const annotating = annotate === 'on' || (annotate === 'auto' && (view === 'qa' || (!!chain && looksLikeChainTopic(chain))))

  useEffect(() => {
    if (!annotating) { host.setBadges(null); return }
    host.setBadges(qa ? qaBadges(qa, posts, prefs.qa.associateReplies, locale) : new Map(chain!.order.map(v => [v.postNumber, badgeFor(v, chain!, locale)])))
  }, [chain, qa, annotating, state.scheme, locale])
  useEffect(() => () => host.setBadges(null), [])
  useEffect(() => {
    const request = state.focusRequest
    const post = request && posts.find(p => p.postNumber === request.postNumber)
    if (post) dispatch({ type: 'showPost', id: post.id, tab: view })
  }, [state.focusRequest?.nonce])
  useEffect(() => {
    const post = state.readingPosition === undefined ? undefined : posts.find(p => p.postNumber === state.readingPosition)
    if (post) dispatch({ type: 'readingHint', id: post.id })
  }, [state.readingPosition, posts, view])
  // 其他标签页关闭主动补取后立即生效；开启不跨页传播，仍需在当前页手动打开并逐次确认。
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== PREFS_KEY) return
      if (!readPrefs().allowLoad) setPrefs(current => current.allowLoad ? { ...current, allowLoad: false } : current)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const updatePrefs = (next: Partial<Prefs>) => {
    // 模式只能在“规则”页切换：两种模式都停留在规则页，避免卸载当前控件导致焦点丢失。
    if (next.mode !== undefined && next.mode !== prefs.mode && ui.tab === 'rules') {
      send({ tool: 'chain', event: { type: 'setTab', tab: 'rules' } })
      send({ tool: 'qa', event: { type: 'setTab', tab: 'rules' } })
    }
    setPrefs(current => {
      const merged = { ...current, ...next }
      // 其他标签页刚关闭补取时，本页无关设置不能用旧的 true 把它写回开启。
      if (next.allowLoad === undefined && merged.allowLoad && !readPrefs().allowLoad) merged.allowLoad = false
      setPrefsFailed(!writePrefs(merged))
      return merged
    })
  }
  const persist = (next: Override[]) => { setOverrides(next); setOverridesFailed(!writeOverrides(next)) }
  const overrideApi = {
    save: (childId: number, parentId: number | null) => { const o = { origin, topicId, childId, parentId }; persist([...overrides.filter(x => overrideKey(x) !== overrideKey(o)), o]) },
    restore: (childId: number) => persist(overrides.filter(x => overrideKey(x) !== overrideKey({ origin, topicId, childId }))),
    has: (childId: number) => topicOverrides.some(x => x.childId === childId),
    count: topicOverrides.length,
  }

  // 运行时强调色只覆盖 --tm-c-accent 等变量；宿主没有可用强调色时保持 tokens 默认值。
  const accent = useMemo(() => accentVars(deriveAccent(state.hostAccent, state.scheme)), [state.hostAccent, state.scheme])
  return <I18nContext.Provider value={language}><div class="tm-root" data-scheme={state.scheme} data-tool={view} lang={locale} style={accent}>
    <style>{panelCss}</style>
    {ui.mode === 'collapsed' && <EdgeTab analysis={analysis} dock={dock} focus={ui.focus === 'edge'} onFocused={() => dispatch({ type: 'focusDone' })} onOpen={() => dispatch({ type: 'toggleFromEdge' })} onDock={dock => updatePrefs({ dock })} />}
    {ui.mode === 'hud' && <Hud analysis={analysis} byId={byId} loaded={coverage.loaded} total={coverage.total} dock={dock} focus={ui.focus === 'hud'} onFocused={() => dispatch({ type: 'focusDone' })} onExpand={tab => dispatch({ type: 'expand', tab })} onShow={id => dispatch({ type: 'showPost', id })} onCollapse={() => dispatch({ type: 'collapse' })} navigation={host.navigation} onDock={dock => updatePrefs({ dock })} />}
    {opened.current && <Panel host={host} state={state} analysis={analysis} coverage={coverage} prefs={prefs} updatePrefs={updatePrefs} overrides={overrideApi} storageFailed={prefsFailed || (view === 'chain' && overridesFailed)} ui={ui} dispatch={dispatch} />}
  </div></I18nContext.Provider>
}

/** 问答模式的原帖标注：只标被问过 2 次及以上的提问楼；关闭回复关联时不显示回答数量。 */
function qaBadges(qa: QaResult, posts: { id: number; postNumber: number }[], associate: boolean, locale: Locale): Map<number, Badge> {
  const { t } = i18n(locale)
  const number = new Map(posts.map(p => [p.id, p.postNumber]))
  const badges = new Map<number, Badge>()
  for (const cluster of qa.repeated) {
    const first = number.get(cluster.questionIds[0])
    const answers = !associate ? '' : cluster.answerIds.length ? t('badge.answers', { count: cluster.answerIds.length }) : t('badge.noAnswers')
    cluster.questionIds.forEach((id, i) => {
      const n = number.get(id)
      if (n === undefined) return
      badges.set(n, i === 0
        ? { icon: '?', label: t('badge.asked', { count: cluster.questionIds.length, answers }), tone: associate && !cluster.answerIds.length ? 'warn' : associate ? 'ok' : 'muted', title: cluster.text }
        : { icon: '↺', label: t('badge.similar', { number: first ?? '?', answers }), tone: 'muted', title: cluster.text })
    })
  }
  return badges
}
