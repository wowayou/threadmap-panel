import { normalizePost } from '../core/phrases'
import type { Post } from '../core/types'

export interface LoadProgress { loaded: number; total: number; posts: Post[] }
export interface LoadResult { posts: Post[]; stream: number[] }
export interface LoadOptions {
  /** 平台给出的完整帖子 ID 顺序；已知时不再请求 topic JSON */
  stream?: number[]
  /** 已经有的帖子 ID，不重复请求 */
  knownIds?: Iterable<number>
  onProgress?: (progress: LoadProgress) => void
  signal?: AbortSignal
  /** 批次之间的间隔，降低触发站点限流的概率 */
  delayMs?: number
}

export class LoadError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number, readonly challenge = false) { super(message); this.name = 'LoadError' }
}

const CHALLENGE_MESSAGE = '站点要求重新做人机验证（Cloudflare）。请刷新页面或打开任意帖子完成验证，再点“加载全部楼层”；已载入的楼层会保留。'

/** Cloudflare 等防护层拦截时返回 HTML 挑战页，而不是论坛的 JSON 错误 */
function isChallenge(response: Response) {
  if (response.headers.get('cf-mitigated') === 'challenge') return true
  return (response.status === 403 || response.status === 503) && (response.headers.get('Content-Type') || '').includes('text/html')
}

const BATCH = 20

const abortError = () => { const error = new Error('已取消'); error.name = 'AbortError'; return error }
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (!ms) return resolve()
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()) }, { once: true })
})

function failure(response: Response, what: string): LoadError {
  if (isChallenge(response)) return new LoadError(CHALLENGE_MESSAGE, response.status, undefined, true)
  const retryAfter = Number(response.headers.get('Retry-After')) || undefined
  if (response.status === 429) return new LoadError(`请求过于频繁（429）${retryAfter ? `，请 ${retryAfter} 秒后再试` : '，请稍后再试'}`, 429, retryAfter)
  if (response.status === 403 || response.status === 404) return new LoadError(`${what}失败（${response.status}）：没有权限或内容不存在。已载入的楼层会保留。`, response.status)
  return new LoadError(`${what}失败（${response.status}）`, response.status)
}

/**
 * 只读加载：同源 GET，带当前浏览器的登录状态；串行分批，每批最多 20 个数据库 ID；
 * 出错立即停止，不自动重试；每批成功的数据都会通过 onProgress 交出，不因后续失败而丢失。
 */
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0

export function createLoader(fetcher: typeof fetch = fetch, origin = typeof location !== 'undefined' ? location.origin : '') {
  const headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
  /**
   * 安全约束：只发同源 GET。路径只由数字 ID 拼成；用 origin 解析成绝对地址，
   * 防止页面里的 <base href> 把请求带到别的站点；解析后再校验一次来源。
   */
  const get = async (path: string, signal?: AbortSignal) => {
    const url = origin ? new URL(path, origin) : null
    if (url && url.origin !== origin) throw new LoadError('请求地址异常，已停止。', 0)
    const response = await fetcher(url ? url.href : path, { method: 'GET', credentials: 'same-origin', headers, signal })
    // 被重定向到别的站点时不读取内容
    if (origin && response.url && new URL(response.url).origin !== origin) throw new LoadError('请求被重定向到其他站点，已停止。', response.status)
    return response
  }
  const toPost = (raw: unknown, topicId: number) => ({ ...normalizePost(raw as never), topicId, origin })
  const json = async <T>(response: Response): Promise<T> => {
    try { return await response.json() as T } catch {
      const html = (response.headers.get('Content-Type') || '').includes('text/html')
      throw new LoadError(html ? CHALLENGE_MESSAGE : '返回的数据无法解析，已停止加载。已载入的楼层会保留。', response.status, undefined, html)
    }
  }

  return {
    async load(topicId: number, options: LoadOptions = {}): Promise<LoadResult> {
      if (!isId(topicId)) throw new LoadError('主题编号无效，已停止。', 0)
      const { onProgress, signal, delayMs = 0 } = options
      const posts = new Map<number, Post>()
      let stream = options.stream
      if (!stream?.length) {
        const response = await get(`/t/${topicId}.json`, signal)
        if (!response.ok) throw failure(response, '主题读取')
        const topic = await json<{ post_stream?: { stream?: number[]; posts?: unknown[] } }>(response)
        stream = (topic.post_stream?.stream || []).filter(isId)
        for (const raw of topic.post_stream?.posts || []) { const post = toPost(raw, topicId); posts.set(post.id, post) }
      }
      const known = new Set(options.knownIds || [])
      posts.forEach((_, id) => known.add(id))
      const missing = stream.filter(id => isId(id) && !known.has(id))
      let done = 0
      const progress = () => onProgress?.({ loaded: stream!.length - missing.length + done, total: stream!.length, posts: [...posts.values()] })
      progress()
      for (let i = 0; i < missing.length; i += BATCH) {
        if (signal?.aborted) throw abortError()
        if (i > 0) await sleep(delayMs, signal)
        const query = new URLSearchParams()
        missing.slice(i, i + BATCH).forEach(id => query.append('post_ids[]', String(id)))
        const response = await get(`/t/${topicId}/posts.json?${query}`, signal)
        if (!response.ok) throw failure(response, '楼层读取')
        const data = await json<{ post_stream?: { posts?: unknown[] }; posts?: unknown[] }>(response)
        for (const raw of data.post_stream?.posts || data.posts || []) { const post = toPost(raw, topicId); posts.set(post.id, post) }
        done += Math.min(BATCH, missing.length - i)
        progress()
      }
      return { posts: [...posts.values()].sort((a, b) => a.postNumber - b.postNumber), stream }
    },
  }
}

export type TopicLoader = ReturnType<typeof createLoader>
