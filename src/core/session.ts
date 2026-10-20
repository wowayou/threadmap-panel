import type { Badge } from './chain'
import type { LayoutRequest, Placement, Post, PostNavigation } from './types'
import type { LoadMeter, LoadSelection, LoadSummary } from './load-policy'
import type { PostCacheApi } from './post-cache'
import { mergePosts } from './phrases'

/**
 * 一个主题的会话状态，由宿主（UserScript 或 demo）拥有，面板只读取并订阅。
 * 面板关闭再打开、阅读位置变化都不会丢失已载入的楼层；切换主题时整个会话被丢弃。
 */
export interface SessionState {
  origin: string
  topicId: number
  posts: Post[]
  /** 平台给出的完整帖子 ID 顺序；undefined 表示未知（只看到了 DOM） */
  stream?: number[]
  /** 数据来源，用于界面说明 */
  source: 'store' | 'dom' | 'api' | 'demo'
  readingPosition?: number
  focusRequest?: { postNumber: number; nonce: number }
  /** 宿主页面的配色（跟随论坛主题） */
  scheme: 'light' | 'dark'
  /** 宿主强调色（#rrggbb），面板按对比度推导自己的强调色；undefined 用默认强调色 */
  hostAccent?: string
  siteLanguage?: string
  placement?: Placement
  cachedCount?: number
}

export interface Session {
  get(): SessionState
  subscribe(listener: () => void): () => void
  /** 合并新观察到的帖子；内容没有变化时不通知订阅者 */
  mergePosts(posts: Post[], extra?: Partial<Pick<SessionState, 'stream' | 'source'>>): void
  setReading(postNumber: number | undefined): void
  focus(postNumber: number): void
  setScheme(scheme: 'light' | 'dark', ...hostAccent: [] | [string | undefined]): void
  setSiteLanguage(language: string): void
  setPlacement(placement: Placement): void
  restorePosts(posts: Post[]): void
  dropCached(): void
}

export function createSession(initial: SessionState): Session {
  let state = initial
  const cached = new Set<number>()
  const listeners = new Set<() => void>()
  const set = (next: SessionState) => { if (next === state) return; state = next; listeners.forEach(listener => listener()) }
  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    mergePosts(posts, extra = {}) {
      const incoming = new Set(posts.map(p => p.id)), allowed = extra.stream && new Set(extra.stream)
      const removed = new Set([...cached].filter(id => incoming.has(id) || (allowed && !allowed.has(id))))
      removed.forEach(id => cached.delete(id))
      // 新观测覆盖缓存整条记录，包括空正文；不能用旧缓存补回已删除内容。
      const base = removed.size ? state.posts.filter(p => !removed.has(p.id)) : state.posts
      const merged = mergePosts(base, posts)
      // 新给出的 stream 视为更新的事实；没给出时保留已有的（DOM 观察不提供 stream）
      const stream = extra.stream ?? state.stream
      const sameStream = stream === state.stream || (!!stream && !!state.stream && stream.length === state.stream.length && stream.every((id, i) => id === state.stream![i]))
      // 一旦从 store/API 拿到过 stream，就不再降级标注为 dom
      const source = extra.source === 'dom' && state.stream ? state.source : extra.source ?? state.source
      if (merged === state.posts && sameStream && source === state.source) return
      set({ ...state, posts: merged, stream: sameStream ? state.stream : stream, source, cachedCount: cached.size })
    },
    restorePosts(posts) {
      const ids = new Set(state.posts.map(p => p.id)), floors = new Set(state.posts.map(p => p.postNumber)), allowed = state.stream && new Set(state.stream)
      const restored = posts.filter(p => !ids.has(p.id) && !floors.has(p.postNumber) && (!allowed || allowed.has(p.id)))
      if (!restored.length) return
      restored.forEach(p => cached.add(p.id))
      set({ ...state, posts: mergePosts(state.posts, restored), cachedCount: cached.size })
    },
    dropCached() {
      if (!cached.size) return
      const posts = state.posts.filter(p => !cached.has(p.id)); cached.clear()
      set({ ...state, posts, cachedCount: 0 })
    },
    setReading(postNumber) { if (postNumber !== state.readingPosition) set({ ...state, readingPosition: postNumber }) },
    focus(postNumber) { set({ ...state, focusRequest: { postNumber, nonce: (state.focusRequest?.nonce ?? 0) + 1 } }) },
    // 只传配色时保留强调色；显式传入 undefined 表示宿主已不再提供强调色。
    setScheme(scheme, ...accent) {
      const hostAccent = accent.length ? accent[0] : state.hostAccent
      if (scheme !== state.scheme || hostAccent !== state.hostAccent) set({ ...state, scheme, hostAccent })
    },
    setSiteLanguage(siteLanguage) { if (siteLanguage !== state.siteLanguage) set({ ...state, siteLanguage }) },
    setPlacement(placement) {
      const before = state.placement
      if (!before || Object.keys(placement).some(key => placement[key as keyof Placement] !== before[key as keyof Placement])) set({ ...state, placement })
    },
  }
}

/** 纯数据范围；问答加载进度不能依赖接龙算法是否运行。 */
export const COVERAGE_BANDS = 48
export interface CoverageBand { start: number; end: number; loaded: number; total: number }
export function postCoverage(posts: readonly Post[], stream?: readonly number[]) {
  const known = new Set(posts.map(post => post.id))
  const bands: CoverageBand[] = []
  if (stream) for (let i = 0, count = Math.min(COVERAGE_BANDS, stream.length); i < count; i++) {
    const start = Math.floor(i * stream.length / count), end = Math.floor((i + 1) * stream.length / count)
    let loaded = 0
    for (let index = start; index < end; index++) if (known.has(stream[index])) loaded++
    bands.push({ start: start + 1, end, loaded, total: end - start })
  }
  const inStream = bands.reduce((sum, band) => sum + band.loaded, 0)
  return { loaded: known.size, total: stream?.length, missing: stream ? stream.length - inStream : undefined, bands }
}
export type PostCoverage = ReturnType<typeof postCoverage>

/** 宿主提供给面板的能力 */
export interface HostApi {
  session: Session
  /** 主动、有界地补充楼层；没有该能力（如 demo）时不显示加载按钮 */
  loadAll?: (onProgress: (loaded: number, total: number, meter?: LoadMeter) => void, signal: AbortSignal, selection?: LoadSelection) => Promise<LoadSummary | void>
  setLayout?: (request: LayoutRequest) => void
  cache?: PostCacheApi
  /** 共享的原帖链接/定位能力，不改变业务选中状态或刷新分析页 */
  navigation: PostNavigation
  setBadges: (badges: Map<number, Badge> | null) => void
}
