import { h, render } from 'preact'
import type { Badge } from './core/chain'
import type { Post } from './core/types'
import { createSession, type HostApi } from './core/session'
import { applyBadges, clearBadges, ensureBadgeStyle, flashPost, isOwnMutation } from './host/badges'
import { clearPostCache, onRouteChange, postElements, readSnapshot, routeTopicId, topicPermalink } from './host/discourse'
import { createLoader } from './host/loader'
import { detectScheme, watchScheme } from './host/theme'
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
const BATCH_DELAY_MS = 500
const FLUSH_MS = 1500

function startTopic(topicId: number) {
  const origin = location.origin
  const snapshot = readSnapshot(topicId, origin)
  const session = createSession({ origin, topicId, posts: [], stream: snapshot.stream, source: snapshot.source, scheme: detectScheme() })
  session.mergePosts(snapshot.posts)
  const loader = createLoader(fetch, origin)

  const root = document.createElement('div')
  root.id = 'threadmap-root'
  const shadow = root.attachShadow({ mode: 'open' })
  const mountPoint = document.createElement('div')
  shadow.appendChild(mountPoint)
  document.body.appendChild(root)

  let badges: Map<number, Badge> | null = null
  let refreshTimer: number | undefined
  let frame: number | undefined

  const focusPost = (postNumber: number) => session.focus(postNumber)
  const paintBadges = () => { if (badges) applyBadges(badges, focusPost, document, session.get().scheme) }
  const refresh = () => {
    const next = readSnapshot(topicId, origin)
    session.mergePosts(next.posts, { stream: next.stream, source: next.source })
    paintBadges()
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
    async loadAll(onProgress, signal) {
      const state = session.get()
      // “检查新楼层”时 stream 可能已过时：已经全部载入就重新拉取主题 JSON
      const known = new Set(state.posts.map(p => p.id))
      const complete = !!state.stream && state.stream.every(id => known.has(id))
      // 性能：每批都合并会让整条链在加载期间重算上百次。改为最多每 1.5 秒合并一次，结束（含出错、取消）时必定合并
      let pending: Post[] = []
      let lastFlush = performance.now()
      const flush = () => { if (pending.length) { session.mergePosts(pending); pending = [] } lastFlush = performance.now() }
      try {
        const result = await loader.load(topicId, {
          stream: complete ? undefined : state.stream,
          knownIds: known,
          signal,
          delayMs: BATCH_DELAY_MS,
          onProgress: p => { pending = p.posts; onProgress(p.loaded, p.total); if (performance.now() - lastFlush > FLUSH_MS) flush() },
        })
        pending = []
        session.mergePosts(result.posts, { stream: result.stream, source: state.source === 'dom' ? 'api' : state.source })
      } finally { flush() }
    },
    jump(post) {
      const el = document.querySelector<HTMLElement>(`[data-post-number="${post.postNumber}"]`)
      if (!el) { location.assign(topicPermalink(topicId, post.postNumber)); return }
      el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
      flashPost(el.querySelector<HTMLElement>('article') || el, session.get().scheme)
    },
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
  const stopScheme = watchScheme(scheme => { session.setScheme(scheme); paintBadges() })
  trackReading()
  render(<Widget host={host} />, mountPoint)

  return {
    topicId,
    refresh,
    destroy() {
      render(null, mountPoint)
      observer.disconnect()
      stopScheme()
      window.clearTimeout(refreshTimer)
      if (frame !== undefined) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', trackReading)
      clearBadges()
      root.remove()
      clearPostCache()
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
  const style = document.createElement('style')
  style.id = 'threadmap-host-style'
  style.textContent = HOST_CSS
  document.head.appendChild(style)
  ensureBadgeStyle()
  onRouteChange(syncRoute)
  syncRoute()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
else boot()
