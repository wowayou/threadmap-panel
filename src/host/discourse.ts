import { normalizePost } from '../core/phrases'
import type { Post } from '../core/types'

/**
 * Discourse 宿主适配层。
 *
 * 优先读取页面里 Discourse 已加载的数据（postStream：完整帖子 ID 顺序 + 已加载帖子的
 * cooked 与 reply_to_post_number），不发请求；读不到时退回解析页面 DOM。
 * 前者依赖 Discourse 内部模块，任何异常都按“不可用”处理。
 */

export interface Snapshot { posts: Post[]; stream?: number[]; source: 'store' | 'dom' }

type DiscourseWindow = Window & {
  Discourse?: { __container__?: { lookup: (name: string) => unknown } }
  require?: (name: string) => unknown
}

export function routeTopicId(pathname = location.pathname): number | null {
  const match = pathname.match(/^\/t\/(?:[^/]+\/)?(\d{1,12})(?:\/|$)/)
  return match ? Number(match[1]) : null
}

/** 只由数字和受限的 slug 拼成同站路径，避免把地址栏里的任意内容带进跳转 */
export function topicPermalink(topicId: number, postNumber: number, pathname = location.pathname): string {
  const match = pathname.match(/^\/t\/([a-z0-9-]{1,100})\/(\d+)/i)
  const n = Math.max(1, Math.trunc(postNumber))
  return match && Number(match[2]) === topicId ? `/t/${match[1]}/${topicId}/${n}` : `/t/${topicId}/${n}`
}

/**
 * 归一化结果按 id 缓存，逐字段比较（不拼接长字符串）：滚动时重复读取不会重新解析 HTML，
 * 未变化的帖子保持同一对象。主题切换时由 clearPostCache 清空，不设上限，避免长帖反复重建。
 */
const normalized = new Map<number, { key: unknown[]; post: Post }>()
function cachedPost(id: number, key: unknown[], build: () => Post): Post {
  const hit = normalized.get(id)
  if (hit && hit.key.length === key.length && hit.key.every((v, i) => v === key[i])) return hit.post
  const post = build()
  normalized.set(id, { key, post })
  return post
}

export function clearPostCache() { normalized.clear() }

type StorePost = { id?: unknown; post_number?: unknown; username?: unknown; cooked?: unknown; reply_to_post_number?: unknown; created_at?: unknown; like_count?: unknown }

export function readStore(topicId: number, origin: string, win: DiscourseWindow = window as DiscourseWindow): Snapshot | null {
  try {
    const model = (win.Discourse?.__container__?.lookup('controller:topic') as { model?: { id?: unknown; postStream?: { stream?: unknown; posts?: unknown } } } | undefined)?.model
    if (!model || Number(model.id) !== topicId) return null
    const stream = Array.isArray(model.postStream?.stream) ? (model.postStream!.stream as unknown[]).map(Number).filter(n => Number.isSafeInteger(n) && n > 0) : undefined
    const rawPosts = model.postStream?.posts
    const list: StorePost[] = Array.isArray(rawPosts) ? rawPosts : rawPosts && typeof (rawPosts as { toArray?: unknown }).toArray === 'function' ? (rawPosts as { toArray: () => StorePost[] }).toArray() : []
    const posts: Post[] = []
    for (const item of list) {
      const id = Number(item.id), postNumber = Number(item.post_number)
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(postNumber) || postNumber < 1 || typeof item.cooked !== 'string') continue
      const reply = typeof item.reply_to_post_number === 'number' ? item.reply_to_post_number : null
      const username = typeof item.username === 'string' ? item.username : '未知用户'
      const createdAt = typeof item.created_at === 'string' ? item.created_at : ''
      const likes = item.like_count
      posts.push(cachedPost(id, ['s', postNumber, reply, username, likes, createdAt, item.cooked], () => ({ ...normalizePost({ id, post_number: postNumber, username, cooked: item.cooked as string, created_at: createdAt, reply_to_post_number: reply, like_count: likes }), topicId, origin })))
    }
    return stream?.length || posts.length ? { posts, stream, source: 'store' } : null
  } catch { return null }
}

/** 正文 HTML，去掉 ThreadMap 自己插入的标注 */
function cookedHtml(article: HTMLElement): string {
  const cooked = article.querySelector<HTMLElement>('.cooked, .post-content')
  if (!cooked) return ''
  const html = cooked.innerHTML
  if (!cooked.querySelector('.threadmap-badge')) return html
  // 在惰性文档里去掉标注：DOMParser 生成的文档不执行脚本、不加载图片
  const copy = new DOMParser().parseFromString(html, 'text/html')
  copy.querySelectorAll('.threadmap-badge').forEach(node => node.remove())
  return copy.body.innerHTML
}

export function postElements(doc: Document = document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>('[data-post-number]')]
}

export function readDom(topicId: number, origin: string, doc: Document = document): Snapshot {
  const posts: Post[] = []
  for (const outer of postElements(doc)) {
    const article = outer.matches('article') ? outer : outer.querySelector<HTMLElement>('article')
    const postNumber = Number(outer.dataset.postNumber)
    const id = Number(article?.dataset.postId || article?.id?.match(/post_?(\d+)/)?.[1])
    if (!article || !Number.isSafeInteger(postNumber) || postNumber < 1 || !Number.isSafeInteger(id) || id < 1) continue
    // SPA 切换主题时旧主题的 DOM 可能还在页面上，按 data-topic-id 过滤
    const owner = article.dataset.topicId || outer.dataset.topicId
    if (owner && Number(owner) !== topicId) continue
    const username = article.querySelector('.username, a[data-user-card]')?.textContent?.trim() || '未知用户'
    const html = cookedHtml(article)
    const createdAt = article.querySelector('time[datetime], .relative-date[data-time]')
    const time = createdAt?.getAttribute('datetime') || (createdAt?.getAttribute('data-time') ? new Date(Number(createdAt.getAttribute('data-time'))).toISOString() : '')
    // DOM 不提供可靠的 reply_to_post_number，保持 undefined（未知），不伪造成 null
    posts.push(cachedPost(id, ['d', postNumber, username, time, html], () => ({ ...normalizePost({ id, post_number: postNumber, username, cooked: html, created_at: time }), topicId, origin })))
  }
  return { posts, source: 'dom' }
}

export function readSnapshot(topicId: number, origin: string): Snapshot {
  return readStore(topicId, origin) || readDom(topicId, origin)
}

/**
 * 路由变化：优先用 Discourse 插件接口的 onPageChange；不可用时退回监听 history。
 * 返回取消函数（插件接口无法注销，因此用开关让回调失效）。
 */
export function onRouteChange(callback: () => void): () => void {
  let active = true
  const run = () => { if (active) callback() }
  const win = window as DiscourseWindow
  try {
    const mod = win.require?.('discourse/lib/plugin-api') as { withPluginApi?: (version: string, fn: (api: { onPageChange: (cb: () => void) => void }) => void) => void } | undefined
    if (mod?.withPluginApi) {
      mod.withPluginApi('1.0.0', api => api.onPageChange(run))
      return () => { active = false }
    }
  } catch { /* 退回 history 监听 */ }
  const push = history.pushState, replace = history.replaceState
  history.pushState = function (...args) { const out = push.apply(this, args); run(); return out }
  history.replaceState = function (...args) { const out = replace.apply(this, args); run(); return out }
  window.addEventListener('popstate', run)
  return () => { active = false; window.removeEventListener('popstate', run) }
}
