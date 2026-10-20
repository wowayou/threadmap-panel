import { h, render } from 'preact'
import type { Badge } from './core/chain'
import { BUILD_INFO } from './core/build-info'
import { clearPhraseCache } from './core/phrases'
import type { Post } from './core/types'
import { createSession, type HostApi } from './core/session'
import { applyBadges, clearBadges, ensureBadgeStyle, isOwnMutation } from './host/badges'
import { clearPostCache, onRouteChange, postElements, readCurrentAccount, readSnapshot, routeTopicId } from './host/discourse'
import { watchNativeLayout } from './host/layout'
import { watchSiteLanguage } from './host/locale'
import { createPostNavigation } from './host/navigation'
import { createLoader } from './host/loader'
import { createCacheStore } from './host/cache-store'
import { createTopicCache } from './host/topic-cache'
import { loadLifecycle } from './host/load-lifecycle'
import { loadPolicy } from './core/load-policy'
import { detectAccent, detectScheme, watchScheme } from './host/theme'
import { deriveAccent } from './ui/accent'
import { Widget } from './ui/Widget'

/**
 * UserScript 入口。元数据头由 vite.userscript.config.ts 注入。
 *
 * 每个主题一个会话：贴边按钮常驻，面板默认收起；切换主题时整个会话销毁并重建。
 * 面板定位跟随论坛：上沿 = header 下沿（--header-offset），编辑器打开时下沿 = 编辑器上沿。
 */

const ALLOWED_HOSTS = /^(linux\.do|meta\.discourse\.org)$/
const HOST_CSS = `
#threadmap-root{--tm-top:var(--header-offset,0px);--tm-bottom:0px;position:fixed;top:0;left:0;width:0;height:0;z-index:1100}
html.composer-open #threadmap-root{--tm-bottom:var(--composer-height,0px)}
`
const FLUSH_MS = 1500
const cacheStore = createCacheStore()

function startTopic(topicId: number) {
  const origin = location.origin
  const snapshot = readSnapshot(topicId, origin)
  const session = createSession({ origin, topicId, posts: [], stream: snapshot.stream, source: snapshot.source, scheme: detectScheme(), hostAccent: detectAccent() })
  const cache = createTopicCache(session, readCurrentAccount, cacheStore)
  cache.observe(snapshot.posts, {}, true)
  const loader = createLoader(fetch, origin)

  const root = document.createElement('div')
  root.id = 'threadmap-root'
  root.dataset.threadmapBuild = BUILD_INFO.id
  const shadow = root.attachShadow({ mode: 'open' })
  const mountPoint = document.createElement('div')
  shadow.appendChild(mountPoint)
  document.body.appendChild(root)
  const layout = watchNativeLayout(root, session.setPlacement)

  let badges: Map<number, Badge> | null = null
  let refreshTimer: number | undefined
  let frame: number | undefined

  const focusPost = (postNumber: number) => session.focus(postNumber)
  // 原帖标注与到达描边用面板同一个强调色（按当前配色推导，不合格时用默认色）
  const accent = () => { const { hostAccent, scheme } = session.get(); return deriveAccent(hostAccent, scheme)?.focus }
  const paintBadges = () => { if (badges) applyBadges(badges, focusPost, document, session.get().scheme, accent()) }
  const refresh = () => {
    const next = readSnapshot(topicId, origin)
    cache.observe(next.posts, { stream: next.stream, source: next.source }, true)
    paintBadges()
    layout.schedule()
  }
  const trackReading = () => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      const marker = window.innerHeight * 0.28
      let current: number | undefined
      for (const el of postElements()) { if (el.getBoundingClientRect().top <= marker) current = Number(el.dataset.postNumber) || current }
      session.setReading(current)
    })
  }

  const host: HostApi = {
    session,
    cache,
    setLayout: layout.configure,
    async loadAll(onProgress, signal, selection = { maxPosts: loadPolicy.defaultPosts, delayMs: loadPolicy.minIntervalMs, continueInBackground: false }) {
      const state = session.get()
      const lifecycle = loadLifecycle(signal, selection.continueInBackground)
      // “检查新楼层”时 stream 可能已过时：已经全部载入就重新拉取主题 JSON
      const known = new Set(state.posts.map(p => p.id))
      const complete = !!state.stream && state.stream.every(id => known.has(id))
      // 性能：每批都合并会让整条链在加载期间重算上百次。改为最多每 1.5 秒合并一次，结束（含出错、取消）时必定合并
      let pending: Post[] = []
      let pendingStream: number[] | undefined
      const source = state.source === 'dom' ? 'api' : state.source
      let lastFlush = performance.now()
      const flush = () => {
        if (pendingStream !== undefined) cache.observe(pending, { stream: pendingStream, source })
        pending = []; pendingStream = undefined
        lastFlush = performance.now()
      }
      try {
        const result = await loader.load(topicId, {
          stream: complete ? undefined : state.stream,
          knownIds: known,
          signal: lifecycle.signal,
          maxPosts: selection.maxPosts,
          delayMs: selection.delayMs,
          onProgress: p => { pending = p.posts; pendingStream = p.stream; onProgress(p.loaded, p.total, p); if (performance.now() - lastFlush > FLUSH_MS) flush() },
        })
        pending = []; pendingStream = undefined
        cache.observe(result.posts, { stream: result.stream, source })
        return result
      } catch (error) { throw lifecycle.error(error) }
      finally {
        lifecycle.dispose()
        flush()
        await cache.flush()
      }
    },
    navigation: createPostNavigation(topicId, origin, () => session.get().scheme, document, accent),
    setBadges(next) { badges = next; if (next) paintBadges(); else clearBadges() },
  }

  // 帖子随滚动加载、Discourse 重新渲染会丢标注：观察 DOM 变化后重读并补标（去抖）
  const observer = new MutationObserver(records => {
    if (isOwnMutation(records)) return
    window.clearTimeout(refreshTimer)
    refreshTimer = window.setTimeout(refresh, 150)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  window.addEventListener('scroll', trackReading, { passive: true })
  const stopScheme = watchScheme((scheme, hostAccent) => { session.setScheme(scheme, hostAccent); paintBadges() })
  const stopLanguage = watchSiteLanguage(session.setSiteLanguage)
  trackReading()
  render(<Widget host={host} />, mountPoint)

  return {
    topicId,
    refresh,
    destroy() {
      render(null, mountPoint)
      cache.destroy()
      observer.disconnect()
      layout.stop()
      stopScheme()
      stopLanguage()
      window.clearTimeout(refreshTimer)
      if (frame !== undefined) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', trackReading)
      clearBadges()
      root.remove()
      clearPostCache()
      clearPhraseCache()
    },
  }
}

let current: ReturnType<typeof startTopic> | null = null

function syncRoute() {
  const topicId = ALLOWED_HOSTS.test(location.hostname) ? routeTopicId() : null
  if (topicId === null) { current?.destroy(); current = null; return }
  if (current?.topicId === topicId) { current.refresh(); return }
  current?.destroy()
  current = startTopic(topicId)
}

function boot() {
  if (!ALLOWED_HOSTS.test(location.hostname)) return
  // 重复注入或同页已有其他 ThreadMap 实例时，不再挂第二套界面、监听和加载入口。
  if (document.getElementById('threadmap-host-style')) return
  const style = document.createElement('style')
  style.id = 'threadmap-host-style'
  style.dataset.threadmapBuild = BUILD_INFO.id
  style.textContent = HOST_CSS
  document.head.appendChild(style)
  ensureBadgeStyle()
  onRouteChange(syncRoute)
  syncRoute()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
else boot()
