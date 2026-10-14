import { h } from 'preact'
import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks'
import { badgeFor, buildChain, looksLikeChainTopic, type Badge } from '../core/chain'
import { buildQa, type QaResult } from '../core/questions'
import type { HostApi, Session, SessionState } from '../core/session'
import { readOverrides, readPrefs, writeOverrides, writePrefs, type Prefs } from '../core/storage'
import type { Override } from '../core/types'
import { EdgeTab } from './EdgeTab'
import { Hud } from './Hud'
import { Panel } from './Panel'
import { panelCss } from './styles'
import { initialUi, uiReducer, type Mode } from './widget-state'

/** 订阅宿主会话；订阅后再读一次，避免漏掉渲染与订阅之间的更新 */
function useSession(session: Session): SessionState {
  const [state, setState] = useState(session.get)
  useEffect(() => { const sync = () => setState(session.get()); const off = session.subscribe(sync); sync(); return off }, [session])
  return state
}

const overrideKey = (o: Pick<Override, 'origin' | 'topicId' | 'childId'>) => `${o.origin}:${o.topicId}:${o.childId}`

/**
 * 根组件：持有设置、本地纠正、交互状态与接龙计算结果；
 * 收起时渲染贴边按钮，展开时渲染面板（面板保持挂载以保留滚动位置与输入）。
 */
export function Widget({ host, initialMode = 'collapsed' }: { host: HostApi; initialMode?: Mode }) {
  const state = useSession(host.session)
  const { origin, topicId, posts, stream } = state
  const [ui, dispatch] = useReducer(uiReducer, initialMode, initialUi)
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  const [overrides, setOverrides] = useState<Override[]>(() => readOverrides())
  const [storageFailed, setStorageFailed] = useState(false)
  const opened = useRef(initialMode !== 'collapsed')
  if (ui.mode !== 'collapsed') opened.current = true

  const chain = useMemo(() => buildChain(posts, prefs.settings, overrides, { stream }), [posts, prefs.settings, overrides, stream])
  const byId = useMemo(() => new Map(posts.map(post => [post.id, post])), [posts])
  const isChain = looksLikeChainTopic(chain)
  const view = prefs.mode === 'auto' ? (isChain ? 'chain' : 'qa') : prefs.mode
  const qa = useMemo(() => view === 'qa' ? buildQa(posts) : null, [view, posts])
  // 接龙模式按“像不像接龙”决定是否标注；问答模式只标被重复问过的提问
  const annotating = prefs.annotate === 'on' || (prefs.annotate === 'auto' && (view === 'qa' || isChain))

  useEffect(() => {
    if (!annotating) { host.setBadges(null); return }
    host.setBadges(view === 'qa' && qa ? qaBadges(qa, posts) : new Map(chain.order.map(v => [v.postNumber, badgeFor(v, chain)])))
  }, [chain, qa, view, annotating, state.scheme])
  useEffect(() => () => host.setBadges(null), [])
  useEffect(() => {
    const request = state.focusRequest
    const post = request && posts.find(p => p.postNumber === request.postNumber)
    if (post) dispatch({ type: 'showPost', id: post.id, tab: view === 'qa' ? 'qa' : 'chain' })
  }, [state.focusRequest?.nonce])
  // 模式切换后，当前标签若不属于新模式，回到该模式的首个标签
  useEffect(() => {
    const valid = view === 'qa' ? ['qa', 'rules'] : ['chain', 'issues', 'rules']
    if (!valid.includes(ui.tab)) dispatch({ type: 'setTab', tab: view === 'qa' ? 'qa' : 'chain' })
  }, [view])
  useEffect(() => {
    const post = state.readingPosition === undefined ? undefined : posts.find(p => p.postNumber === state.readingPosition)
    if (post) dispatch({ type: 'readingHint', id: post.id })
  }, [state.readingPosition, posts])

  const updatePrefs = (next: Partial<Prefs>) => setPrefs(current => { const merged = { ...current, ...next }; writePrefs(merged); return merged })
  const persist = (next: Override[]) => { setOverrides(next); setStorageFailed(!writeOverrides(next)) }
  const overrideApi = {
    save: (childId: number, parentId: number | null) => { const o = { origin, topicId, childId, parentId }; persist([...overrides.filter(x => overrideKey(x) !== overrideKey(o)), o]) },
    restore: (childId: number) => persist(overrides.filter(x => overrideKey(x) !== overrideKey({ origin, topicId, childId }))),
    has: (childId: number) => overrides.some(x => overrideKey(x) === overrideKey({ origin, topicId, childId })),
    count: overrides.filter(o => o.origin === origin && o.topicId === topicId).length,
  }

  return <div class="tm-root" data-scheme={state.scheme}>
    <style>{panelCss}</style>
    {ui.mode === 'collapsed' && <EdgeTab chain={chain} qa={view === 'qa' ? qa : null} dock={prefs.dock} focus={ui.focus === 'edge'} onFocused={() => dispatch({ type: 'focusDone' })} onOpen={() => dispatch({ type: 'toggleFromEdge' })} onDock={dock => updatePrefs({ dock })} />}
    {ui.mode === 'hud' && <Hud chain={chain} qa={view === 'qa' ? qa : null} byId={byId} loaded={posts.length} total={stream?.length} dock={prefs.dock} focus={ui.focus === 'hud'} onFocused={() => dispatch({ type: 'focusDone' })} onExpand={tab => dispatch({ type: 'expand', tab })} onCollapse={() => dispatch({ type: 'collapse' })} onJump={id => { const post = byId.get(id); if (post) host.jump(post) }} onDock={dock => updatePrefs({ dock })} />}
    {opened.current && <Panel host={host} state={state} chain={chain} qa={view === 'qa' ? qa : null} prefs={prefs} updatePrefs={updatePrefs} overrides={overrideApi} storageFailed={storageFailed} ui={ui} dispatch={dispatch} />}
  </div>
}

/** 问答模式的原帖标注：只标被问过 2 次及以上的提问楼 */
function qaBadges(qa: QaResult, posts: { id: number; postNumber: number }[]): Map<number, Badge> {
  const number = new Map(posts.map(p => [p.id, p.postNumber]))
  const badges = new Map<number, Badge>()
  for (const cluster of qa.repeated) {
    const first = number.get(cluster.questionIds[0])
    const answers = cluster.answerIds.length ? `${cluster.answerIds.length} 条回答` : '暂无明确回答'
    cluster.questionIds.forEach((id, i) => {
      const n = number.get(id)
      if (n === undefined) return
      badges.set(n, i === 0
        ? { icon: '?', label: `被问过 ${cluster.questionIds.length} 次 · ${answers}`, tone: cluster.answerIds.length ? 'ok' : 'warn', title: cluster.text }
        : { icon: '↺', label: `相似问题见 #${first} · ${answers}`, tone: 'muted', title: cluster.text })
    })
  }
  return badges
}
