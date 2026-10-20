import { errorText, message, type Text } from '../i18n'
import { cachePolicy, cachePost, cachedCandidates, decodeCachedPost, type CacheConsent, type CachedPost, type CacheScope, type CacheStatus, type PostCacheApi } from '../core/post-cache'
import { mergePost, samePost } from '../core/phrases'
import { hasBody, hasContent, isId } from '../core/post-input'
import type { Session, SessionState } from '../core/session'
import type { Post } from '../core/types'
import type { CacheStore } from './cache-store'

const CHANNEL = 'threadmap-post-cache-control-v1'
const OFF = message('cache.off')
type Account = number | null | undefined

/** 一个主题的缓存生命周期；只把真实观测写回，绝不把恢复的数据重新标成新观测。 */
export function createTopicCache(session: Session, readAccount: () => Account, store: CacheStore, win: Window = window, doc: Document = document) {
  const { origin, topicId } = session.get()
  let state: CacheStatus = { enabled: false, busy: false, saved: 0, message: OFF, error: false }
  const listeners = new Set<() => void>()
  const set = (next: Partial<CacheStatus>) => { state = { ...state, ...next }; listeners.forEach(fn => fn()) }
  const live = new Map<number, { post: Post; cached: CachedPost }>(), pending = new Map<number, CachedPost>()
  let consent: CacheConsent | null = null, owner: Account, changed = false, readable = false, active = true, revision = 0, initialized = false, syncing = false, paused = false, closing = false
  let streamDirty = false
  let timer: number | undefined, expiry: number | undefined, expiryAt: number | undefined, writing: Promise<void> | undefined
  let channel: BroadcastChannel | undefined
  function connectChannel() {
    if (channel) return true
    try {
      if (typeof BroadcastChannel === 'undefined') return false
      channel = new BroadcastChannel(CHANNEL); channel.onmessage = disabledElsewhere; return true
    } catch { return false } // 不能协调跨页清空时拒绝缓存，不退回无保护写入。
  }
  function broadcastDisabled() {
    if (connectChannel()) channel!.postMessage('disabled')
    channel?.close(); channel = undefined
  }
  const clearTimers = () => { win.clearTimeout(timer); win.clearTimeout(expiry); timer = expiry = expiryAt = undefined }
  const fail = (error: unknown) => { paused = true; clearTimers(); set({ busy: false, error: true, message: message('cache.failed', { reason: errorText(error) }) }) }
  const scope = (accountId: number): CacheScope => ({ origin, topicId, accountId })

  async function reset(notice: Text = message('cache.cleared')) {
    const ticket = ++revision
    consent = null; paused = false; pending.clear(); live.clear(); streamDirty = false; clearTimers(); session.dropCached()
    set({ enabled: false, busy: true, saved: 0, error: false, message: message('cache.clearing') })
    try {
      await store.disable()
      broadcastDisabled()
      if (active && ticket === revision) set({ busy: false, message: notice })
    } catch (error) { if (active && ticket === revision) fail(error) }
  }
  function identity(): number | undefined {
    const next = readAccount()
    if (owner === undefined) { if (next !== undefined) owner = next }
    else if (owner !== next && !changed) {
      changed = true; live.clear()
      void reset(message('cache.accountChanged'))
    }
    return !changed && isId(next) ? next : undefined
  }
  function collect(posts: Post[], accountId: number) {
    for (const incoming of posts) {
      const before = live.get(incoming.id), post = mergePost(before?.post, incoming)
      if (before && samePost(before.post, post)) continue
      // 没带正文的观测只能更新元数据，不能把补回的旧正文当成刚刚重新看到：沿用旧的 seenAt。
      // 从未见过正文的楼（没有旧记录）不能凭元数据开始保存。
      if (incoming.bodyMissing && !before) continue
      const cached = cachePost(post, scope(accountId), incoming.bodyMissing ? before!.cached.seenAt : Date.now())
      if (!cached) continue
      live.set(post.id, { post, cached })
      if (consent) pending.set(post.id, cached)
    }
  }
  /**
   * “当前可读”只约束恢复与保存新正文；撤销旧内容不能依赖另一楼仍可读。
   * 页面不可读时只写入明确清空的记录（正文无内容），不写新正文、不按 stream 删减。
   */
  const clearing = (post: CachedPost) => !hasContent(post.raw)
  const due = () => readable ? pending.size > 0 || streamDirty : [...pending.values()].some(clearing)
  const schedule = () => {
    if (!active || paused || !consent || !due() || timer !== undefined || writing) return
    set({ busy: true, message: message(readable ? 'cache.savingNew' : 'cache.unreadable') })
    timer = win.setTimeout(() => { timer = undefined; void flush() }, cachePolicy.writeDelayMs)
  }
  const expires = (records: readonly CachedPost[]) => {
    win.clearTimeout(expiry)
    const now = Date.now(), times = records.map(p => p.seenAt + cachePolicy.ttlMs).filter(time => time > now)
    if (expiryAt !== undefined && expiryAt > now) times.push(expiryAt)
    if (!times.length) { expiryAt = undefined; return }
    const next = times.reduce((min, time) => Math.min(min, time), Infinity)
    expiryAt = next
    expiry = win.setTimeout(() => { expiry = expiryAt = undefined; session.dropCached(); void sync() }, next - now)
  }
  async function flush(): Promise<void> {
    win.clearTimeout(timer); timer = undefined
    // 卸载时排在在途写入之后的新观测也要落盘（例如刚观察到的清空），不能随旧写入一起丢弃。
    if (writing) return closing ? writing.then(() => flush()) : writing
    const accountId = identity(), token = consent, ticket = revision
    if ((!active && !closing) || paused || !token || accountId === undefined || !due()) return
    const records = readable ? [...pending.values()] : [...pending.values()].filter(clearing)
    const stream = readable ? session.get().stream : undefined
    writing = (async () => {
      try {
        const result = await store.write(scope(accountId), token, records, stream)
        if (!active || ticket !== revision) return
        if (!result.active) { consent = null; pending.clear(); session.dropCached(); set({ enabled: false, busy: false, saved: 0, message: message('cache.revokedWrite') }); return }
        for (const post of records) if (pending.get(post.id) === post) pending.delete(post.id)
        if (stream !== undefined && session.get().stream === stream) streamDirty = false
        set({ busy: false, saved: result.saved, error: false, message: message(result.discarded ? 'cache.discardedSave' : result.limited ? 'cache.limited' : readable ? 'cache.saved' : 'cache.unreadable', { count: result.saved }) })
        expires([...live.values()].map(v => v.cached))
      } catch (error) { if (active && ticket === revision) fail(error) }
      finally { writing = undefined; schedule() }
    })()
    return writing
  }
  async function sync() {
    if (!active || changed || syncing || paused) return
    const accountId = identity()
    if (changed) return
    if (accountId === undefined) {
      if (readAccount() === null) await reset(message('cache.anonymous'))
      else set({ busy: false, message: message('cache.unknownAccount') })
      return
    }
    syncing = true
    const ticket = ++revision
    try {
      const status = await store.status(origin, accountId)
      if (!active || ticket !== revision || identity() !== accountId) return
      if (status.revoked) broadcastDisabled()
      if (consent?.token !== status.consent?.token) session.dropCached()
      consent = status.consent; initialized = true
      set({ enabled: !!consent, busy: false, error: false, message: status.revoked ? message('cache.mismatchedAccount') : OFF })
      if (!consent) { pending.clear(); live.clear(); streamDirty = false; clearTimers(); session.dropCached(); channel?.close(); channel = undefined; set({ saved: 0 }); return }
      if (!connectChannel()) { consent = null; session.dropCached(); set({ enabled: false, message: message('cache.noCoordination') }); return }
      if (!readable) {
        session.dropCached()
        // 首次观测可能早于异步许可返回，已合入会话但尚未入队。核验通过后补处理明确清空，
        // 不依赖下一次 DOM 变化；不收集留存正文/缺失观测，也不放开恢复或新正文写入门槛。
        collect(session.get().posts.filter(post => !post.bodyMissing && !hasBody(post)), accountId)
        set({ message: message('cache.unreadable') }); schedule(); return
      }
      // 未启用时不维护第二份正文索引；首次恢复前，这些仍全是当前页面的真实观测。
      if (!session.get().cachedCount) collect(session.get().posts, accountId)
      set({ busy: true, message: message('cache.restoring') })
      const result = await store.read(scope(accountId), consent, session.get().stream)
      if (!active || ticket !== revision || identity() !== accountId || !readable) return
      if (!result.active) { consent = null; pending.clear(); session.dropCached(); set({ enabled: false, busy: false, saved: 0, message: message('cache.revoked') }); return }
      const restored: Post[] = [], current = session.get()
      let sliceStart = performance.now()
      if (result.topic) for (const cached of cachedCandidates(result.topic, current.posts, current.stream)) {
        if (!active || ticket !== revision || !readable || identity() !== accountId) return
        const post = decodeCachedPost(cached, result.topic)
        if (post) restored.push(post)
        // 解析大缓存时让出主线程，但只在最后合并/分析一次；清空或换主题可阻止迟到结果。
        if (performance.now() - sliceStart >= cachePolicy.restoreSliceMs) { await new Promise(resolve => win.setTimeout(resolve, 0)); sliceStart = performance.now() }
      }
      if (!active || ticket !== revision || identity() !== accountId || !readable) return
      session.restorePosts(restored)
      set({ busy: false, saved: result.topic?.posts.length ?? 0, message: result.discarded ? message('cache.discardedRestore') : message('cache.restored', { count: session.get().cachedCount ?? 0 }) })
      if (result.topic) expires(result.topic.posts)
      for (const value of live.values()) pending.set(value.post.id, value.cached)
      schedule()
    } catch (error) { if (active && ticket === revision) fail(error) }
    finally { syncing = false }
  }
  const api: PostCacheApi = {
    get: () => state,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    async enable() {
      const accountId = identity()
      if (changed || accountId === undefined || !readable || !connectChannel()) { set({ message: message(changed ? 'cache.reopen' : !readable ? 'cache.enableUnreadable' : 'cache.enableUnavailable') }); return }
      const ticket = ++revision
      paused = false; set({ busy: true, error: false, message: message('cache.enabling') })
      try {
        const token = await store.enable(scope(accountId))
        if (!active || ticket !== revision || identity() !== accountId) return
        consent = token; initialized = true
        const current = session.get()
        collect(current.posts.filter(p => live.has(p.id) || !current.cachedCount), accountId)
        for (const value of live.values()) pending.set(value.post.id, value.cached)
        set({ enabled: true, busy: !!pending.size, message: message(pending.size ? 'cache.saving' : 'cache.noValidPosts') }); await flush()
      } catch (error) { if (active && ticket === revision) fail(error) }
    },
    disable: () => reset(),
  }
  function disabledElsewhere(event: MessageEvent) {
    if (event.data !== 'disabled' || !active) return
    revision++; consent = null; pending.clear(); live.clear(); streamDirty = false; clearTimers(); session.dropCached()
    channel?.close(); channel = undefined
    set({ enabled: false, busy: false, saved: 0, error: false, message: message('cache.clearedElsewhere') })
  }
  const focus = () => { if (!doc.hidden) void sync() }
  const hide = () => { if (doc.hidden) void flush() }
  const leave = () => { void flush() }
  win.addEventListener('focus', focus)
  doc.addEventListener('visibilitychange', focus)
  doc.addEventListener('visibilitychange', hide)
  win.addEventListener('pagehide', leave)
  void sync()
  return {
    ...api,
    observe(posts: Post[], extra: Partial<Pick<SessionState, 'stream' | 'source'>> = {}, page = false) {
      if (!active) return
      const wasReadable = readable
      // 只有当前观测确实带来正文才算可读；空占位或只有元数据不能打开历史恢复。
      if (page) readable = posts.some(hasBody)
      else if (posts.some(hasBody)) readable = true
      const previousStream = session.get().stream
      session.mergePosts(posts, extra)
      if (consent && session.get().stream !== previousStream) streamDirty = true
      if (!readable) session.dropCached()
      const accountId = identity()
      if (extra.stream) {
        const allowed = new Set(extra.stream), incoming = new Set(posts.map(p => p.id))
        for (const id of live.keys()) if (!allowed.has(id) && !incoming.has(id)) { live.delete(id); pending.delete(id) }
      }
      if (accountId !== undefined && consent && !paused) collect(posts, accountId)
      if ((!initialized || (!wasReadable && readable)) && !syncing) void sync()
      schedule()
    },
    flush,
    destroy() {
      closing = true; void flush(); active = false; revision++; clearTimers(); channel?.close()
      win.removeEventListener('focus', focus)
      doc.removeEventListener('visibilitychange', focus)
      doc.removeEventListener('visibilitychange', hide)
      win.removeEventListener('pagehide', leave)
      listeners.clear()
    },
  }
}
