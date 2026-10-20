import { LocalizedError, message, type Message, type Text } from '../i18n'
import { isId, MAX_STREAM, parsePost, parseStream, streamTooLarge } from '../core/post-input'
import type { Post } from '../core/types'
import { loadPolicy, type LoadMeter, type LoadSummary } from '../core/load-policy'
import { createLoadGuard, type LoadGuard } from './load-guard'

export interface LoadProgress extends LoadMeter { loaded: number; total: number; posts: Post[]; stream: number[] }
export interface LoadResult extends LoadSummary { posts: Post[]; stream: number[] }
export interface LoadOptions {
  /** 平台给出的完整帖子 ID 顺序；已知时不再请求 topic JSON */
  stream?: number[]
  /** 已经有的帖子 ID，不重复请求 */
  knownIds?: Iterable<number>
  onProgress?: (progress: LoadProgress) => void
  signal?: AbortSignal
  /** 批次之间的间隔，降低触发站点限流的概率 */
  delayMs?: number
  /** 本次新增目标，不把服务器首批返回量或已知帖子的更新算作新增。 */
  maxPosts?: number
}

export class LoadError extends LocalizedError {
  constructor(text: Text, readonly status: number, readonly retryAfter?: number, readonly challenge = false) { super(text); this.name = 'LoadError' }
}

const CHALLENGE_MESSAGE = message('error.challenge')

/** Cloudflare 等防护层拦截时返回 HTML 挑战页，而不是论坛的 JSON 错误 */
function isChallenge(response: Response) {
  if (response.headers.get('cf-mitigated') === 'challenge') return true
  return (response.status === 403 || response.status === 503) && (response.headers.get('Content-Type') || '').includes('text/html')
}

const BATCH = loadPolicy.batchSize

const abortError = () => { const error = new LocalizedError(message('error.cancelled')); error.name = 'AbortError'; return error }
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) throw abortError() }
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(abortError())
  if (ms <= 0) return resolve()
  const finish = () => { signal?.removeEventListener('abort', cancel); resolve() }
  const timer = setTimeout(finish, ms)
  const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(abortError()) }
  signal?.addEventListener('abort', cancel, { once: true })
})

function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('Retry-After')
  const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : 0
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined
}

function failure(response: Response, action: Message): LoadError {
  const retryAfter = retryAfterSeconds(response)
  if (isChallenge(response)) return new LoadError(CHALLENGE_MESSAGE, response.status, retryAfter, true)
  if (response.status === 429) return new LoadError(message('error.rateLimit', { retry: retryAfter ? message('error.retryAfter', { seconds: retryAfter }) : '' }), 429, retryAfter)
  if (response.status === 403 || response.status === 404) return new LoadError(message('error.permission', { action, status: response.status }), response.status, retryAfter)
  return new LoadError(message('error.http', { action, status: response.status }), response.status, retryAfter)
}

/**
 * 只读加载：同源 GET，带当前浏览器的登录状态；串行分批，每批最多 20 个数据库 ID；
 * 出错立即停止，不自动重试；每批成功的数据都会通过 onProgress 交出，不因后续失败而丢失。
 */
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const dataError = (status: number) => new LoadError(message('error.data'), status)

const tooLarge = (status: number) => new LoadError(message('error.tooLarge', { limit: loadPolicy.maxResponseBytes / 1024 / 1024, posts: MAX_STREAM }), status)

/**
 * 首批只标准化本次可能用到的 ID：新 ID 最多 room 个，已有 ID 的更新最多 maxPosts 个（按首次出现顺序）。
 * 选中的 ID 的**每一次出现**都交给 batchPosts，重复/冲突/坏记录的判定不因用户选择的目标而变；
 * 未选中的 ID 不解析正文。只读 id 字段做筛选；总量仍受响应字节上限约束。
 */
function selectInitial(list: unknown[], allow: ReadonlySet<number>, have: ReadonlySet<number>, room: number): unknown[] {
  const ids: unknown[] = list.map(raw => { try { return record(raw)?.id } catch { return undefined } })
  const chosen = new Set<number>()
  let fresh = 0, known = 0
  for (const id of ids) {
    if (!isId(id) || !allow.has(id) || chosen.has(id)) continue
    if (have.has(id)) { if (known < loadPolicy.maxPosts) { known++; chosen.add(id) } }
    else if (fresh < room) { fresh++; chosen.add(id) }
  }
  return list.filter((_, i) => chosen.has(ids[i] as number))
}

/** 本批只收允许的身份；坏条目不丢掉其他合法楼层，但同 ID 的冲突不能最后写入者胜出。 */
function batchPosts(list: unknown[], topicId: number, origin: string, allowIds: ReadonlySet<number>) {
  const posts = new Map<number, Post>(), rejected = new Set<number>()
  for (const raw of list) {
    const post = parsePost(raw, { topicId, origin, allowIds })
    if (!post) {
      // 首批已见到的异常/超限帖子不能被当成普通分页缺口再次请求。
      let id: unknown
      try { id = record(raw)?.id } catch { continue }
      if (isId(id) && allowIds.has(id)) { posts.delete(id); rejected.add(id) }
      continue
    }
    if (rejected.has(post.id)) continue
    const previous = posts.get(post.id)
    if (previous && previous.postNumber !== post.postNumber) { posts.delete(post.id); rejected.add(post.id) }
    else posts.set(post.id, post)
  }
  return { posts, invalid: rejected.size > 0 }
}

export function createLoader(fetcher: typeof fetch = fetch, origin = typeof location !== 'undefined' ? location.origin : '', guard: LoadGuard = createLoadGuard()) {
  const headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
  /** 同源绝对 GET 防止 <base> 改写来源；在发出跳转请求之前拒绝所有重定向。 */
  const get = async (path: string, signal?: AbortSignal) => {
    checkAbort(signal)
    const url = origin ? new URL(path, origin) : null
    if (url && url.origin !== origin) throw new LoadError(message('error.address'), 0)
    let response: Response
    try {
      response = await fetcher(url ? url.href : path, { method: 'GET', credentials: 'same-origin', redirect: 'error', headers, signal })
    } catch (error) {
      checkAbort(signal)
      if (error instanceof Error && error.name === 'AbortError') throw error
      // fetch 不区分网络错误和被禁止的跳转，不能伪称已经确定失败原因。
      throw new LoadError(message('error.network'), 0)
    }
    checkAbort(signal)
    if (origin && response.url && new URL(response.url).origin !== origin) throw new LoadError(message('error.redirect'), response.status)
    return response
  }
  /** 按实际读取的字节数限制整份响应；超限立即取消读取，不先把整份正文放进内存。 */
  const body = async (response: Response, signal?: AbortSignal): Promise<string> => {
    const limit = loadPolicy.maxResponseBytes
    const declared = Number(response.headers.get('Content-Length'))
    if (Number.isFinite(declared) && declared > limit) { void response.body?.cancel().catch(() => {}); throw tooLarge(response.status) }
    if (!response.body) {
      // 按规范没有响应流即空正文；仍按 UTF-8 字节核对上限，不依赖调用方实现。
      const text = await response.text()
      checkAbort(signal)
      if (new TextEncoder().encode(text).byteLength > limit) throw tooLarge(response.status)
      return text
    }
    const reader = response.body.getReader(), decoder = new TextDecoder()
    // 取消/超时必须打断正在等待的读取，即使响应流本身不随请求信号结束。
    const stop = () => { void reader.cancel().catch(() => {}) }
    signal?.addEventListener('abort', stop, { once: true })
    let size = 0, text = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        checkAbort(signal)
        if (done) break
        size += value.byteLength
        if (size > limit) { void reader.cancel().catch(() => {}); throw tooLarge(response.status) }
        text += decoder.decode(value, { stream: true })
      }
    } finally { signal?.removeEventListener('abort', stop); reader.releaseLock() }
    return text + decoder.decode()
  }
  const json = async (response: Response, signal?: AbortSignal): Promise<unknown> => {
    let value: unknown
    try { value = JSON.parse(await body(response, signal)) } catch (error) {
      if (error instanceof LoadError || (error instanceof Error && error.name === 'AbortError')) throw error
      checkAbort(signal)
      const html = (response.headers.get('Content-Type') || '').includes('text/html')
      throw new LoadError(html ? CHALLENGE_MESSAGE : message('error.json'), response.status, retryAfterSeconds(response), html)
    }
    checkAbort(signal)
    return value
  }

  return {
    async load(topicId: number, options: LoadOptions = {}): Promise<LoadResult> {
      if (!isId(topicId)) throw new LoadError(message('error.topicId'), 0)
      const target = options.maxPosts ?? loadPolicy.maxPosts
      const delayMs = options.delayMs ?? 0
      if (!Number.isSafeInteger(target) || target < 1 || target > loadPolicy.maxPosts || !Number.isFinite(delayMs) || delayMs < 0 || delayMs > loadPolicy.maxIntervalMs) throw new LoadError(message('error.loadOptions'), 0)
      const deadline = Date.now() + loadPolicy.actionTimeoutMs
      return guard.run(options.signal, async beforeRequest => {
        const { onProgress, signal } = options
        checkAbort(signal)
        let requests = 0, added = 0, lastStarted: number | undefined
        // 超时覆盖响应头和 JSON 正文，不把节流等待算作服务器超时。
        const request = async (path: string, label: Message) => {
          if (lastStarted !== undefined && delayMs) await sleep(lastStarted + delayMs - Date.now(), signal)
          checkAbort(signal)
          if (Date.now() >= deadline) throw new LoadError(message('error.deadline'), 0)
          await beforeRequest()
          checkAbort(signal)
          if (Date.now() >= deadline) throw new LoadError(message('error.deadline'), 0)
          lastStarted = Date.now()
          requests++
          const controller = new AbortController()
          const cancel = () => controller.abort()
          signal?.addEventListener('abort', cancel, { once: true })
          let timedOut = false
          const timer = setTimeout(() => { timedOut = true; controller.abort() }, loadPolicy.requestTimeoutMs)
          try {
            const response = await get(path, controller.signal)
            if (isChallenge(response) || !response.ok) throw failure(response, label)
            return { data: await json(response, controller.signal), status: response.status }
          } catch (error) {
            if (timedOut && !signal?.aborted) throw new LoadError(message('error.timeout'), 0)
            throw error
          } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
        }
        if (streamTooLarge(options.stream)) throw tooLarge(0)
        let stream = options.stream === undefined ? undefined : parseStream(options.stream)
        if (stream === null) throw dataError(0)
        let initial: unknown[] = [], initialStatus = 0
        if (stream === undefined) {
          const response = await request(`/t/${topicId}.json`, message('error.readTopic'))
          const topic = record(response.data), postStream = record(topic?.post_stream)
          if (streamTooLarge(postStream?.stream)) throw tooLarge(response.status)
          stream = parseStream(postStream?.stream)
          if (!topic || (topic.id !== undefined && topic.id !== topicId) || !stream || !Array.isArray(postStream?.posts)) throw dataError(response.status)
          initial = postStream.posts
          initialStatus = response.status
        }
        const posts = new Map<number, Post>()
        const have = new Set([...(options.knownIds || [])].filter(isId))
        let loaded = stream.filter(id => have.has(id)).length
        const accept = (batch: ReturnType<typeof batchPosts>) => batch.posts.forEach(post => {
          if (!have.has(post.id)) {
            if (added >= target) return
            have.add(post.id); loaded++; added++
          }
          posts.set(post.id, post)
        })
        const progress = () => {
          checkAbort(signal)
          onProgress?.({ loaded, total: stream.length, posts: [...posts.values()], stream, requests, added, target })
          checkAbort(signal)
        }
        const allowed = new Set(stream)
        const first = batchPosts(selectInitial(initial, allowed, have, target - added), topicId, origin, allowed)
        accept(first)
        progress()
        if (first.invalid) throw dataError(initialStatus)
        const missing = stream.filter(id => !have.has(id))
        for (let i = 0; i < missing.length && requests < loadPolicy.maxRequests && added < target; i += BATCH) {
          checkAbort(signal)
          const ids = missing.slice(i, i + Math.min(BATCH, target - added)), query = new URLSearchParams()
          ids.forEach(id => query.append('post_ids[]', String(id)))
          const response = await request(`/t/${topicId}/posts.json?${query}`, message('error.readPosts'))
          const data = record(response.data)
          const list = data?.post_stream === undefined ? data?.posts : record(data.post_stream)?.posts
          if (!data || (data.topic_id !== undefined && data.topic_id !== topicId) || !Array.isArray(list)) throw dataError(response.status)
          const batch = batchPosts(list, topicId, origin, new Set(ids))
          accept(batch)
          progress()
          if (batch.invalid || ids.some(id => !have.has(id))) throw dataError(response.status)
        }
        return { posts: [...posts.values()].sort((a, b) => a.postNumber - b.postNumber), stream, requests, added, target, reason: stream.every(id => have.has(id)) ? 'complete' : added >= target ? 'target' : 'budget' }
      })
    },
  }
}

export type TopicLoader = ReturnType<typeof createLoader>
