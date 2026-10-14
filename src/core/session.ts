import type { Badge } from './chain'
import type { Post } from './types'
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
}

export interface Session {
  get(): SessionState
  subscribe(listener: () => void): () => void
  /** 合并新观察到的帖子；内容没有变化时不通知订阅者 */
  mergePosts(posts: Post[], extra?: Partial<Pick<SessionState, 'stream' | 'source'>>): void
  setReading(postNumber: number | undefined): void
  focus(postNumber: number): void
  setScheme(scheme: 'light' | 'dark'): void
}

export function createSession(initial: SessionState): Session {
  let state = initial
  const listeners = new Set<() => void>()
  const set = (next: SessionState) => { if (next === state) return; state = next; listeners.forEach(listener => listener()) }
  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    mergePosts(posts, extra = {}) {
      const merged = mergePosts(state.posts, posts)
      // 新给出的 stream 视为更新的事实；没给出时保留已有的（DOM 观察不提供 stream）
      const stream = extra.stream ?? state.stream
      const sameStream = stream === state.stream || (!!stream && !!state.stream && stream.length === state.stream.length && stream.every((id, i) => id === state.stream![i]))
      // 一旦从 store/API 拿到过 stream，就不再降级标注为 dom
      const source = extra.source === 'dom' && state.stream ? state.source : extra.source ?? state.source
      if (merged === state.posts && sameStream && source === state.source) return
      set({ ...state, posts: merged, stream: sameStream ? state.stream : stream, source })
    },
    setReading(postNumber) { if (postNumber !== state.readingPosition) set({ ...state, readingPosition: postNumber }) },
    focus(postNumber) { set({ ...state, focusRequest: { postNumber, nonce: (state.focusRequest?.nonce ?? 0) + 1 } }) },
    setScheme(scheme) { if (scheme !== state.scheme) set({ ...state, scheme }) },
  }
}

/** 宿主提供给面板的能力 */
export interface HostApi {
  session: Session
  /** 只读补齐全部楼层；没有该能力（如 demo）时不显示加载按钮 */
  loadAll?: (onProgress: (loaded: number, total: number) => void, signal: AbortSignal) => Promise<void>
  /** 明确的跳转：滚动宿主页面到该楼并短暂高亮 */
  jump: (post: Post) => void
  setBadges: (badges: Map<number, Badge> | null) => void
}
