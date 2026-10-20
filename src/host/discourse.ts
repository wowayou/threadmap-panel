import { hasContent, isId, MAX_COOKED, parsePost, parseStream, type PostContext } from '../core/post-input'
import type { Post } from '../core/types'
import { OWNED } from './owner'

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

/** 当前账号只读查询：null 是宿主明确的匿名状态，undefined 是无法确认；不猜测用户名/头像。 */
export function readCurrentAccount(win: DiscourseWindow = window as DiscourseWindow): number | null | undefined {
  try {
    const user = win.Discourse?.__container__?.lookup('service:current-user')
    if (user === null) return null
    const id = user && typeof user === 'object' ? (user as { id?: unknown }).id : undefined
    return isId(id) ? id : undefined
  } catch { return undefined }
}

/**
 * Discourse 主题路由：`/t/{slug}/{id}[/{楼层}]` 或无标题段的 `/t/{id}[/{楼层}]`。
 * 两种形式都可能只有数字段，必须按段数区分：首段是数字且总共不超过两个数字段时，
 * 首段就是主题 ID（`/t/123/9` 是主题 123 的 9 楼，不是标题“123”下的主题 9）；
 * 否则首段是标题，主题 ID 在第二段。与 topicPermalink 保持往返一致。
 */
export function routeTopicId(pathname = location.pathname): number | null {
  const match = pathname.match(/^\/t\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/|$)/)
  if (!match) return null
  const numeric = (value: string | undefined) => value !== undefined && /^\d{1,12}$/.test(value)
  const [, first, second, third] = match
  const id = numeric(first) && !(numeric(second) && numeric(third)) ? first : numeric(second) ? second : undefined
  return id !== undefined && isId(Number(id)) ? Number(id) : null
}

/** 只由数字和受限的 slug 拼成同站路径，避免把地址栏里的任意内容带进跳转 */
export function topicPermalink(topicId: number, postNumber: number, pathname = location.pathname): string {
  const match = pathname.match(/^\/t\/([a-z0-9-]{1,100})\/(\d+)/i)
  const n = Math.max(1, Math.trunc(postNumber))
  return match && Number(match[2]) === topicId ? `/t/${match[1]}/${topicId}/${n}` : `/t/${topicId}/${n}`
}

/**
 * 只缓存合法解析结果，比较字段而不拼接长字符串。上下文也是缓存键的一部分；
 * 滚动重读保持对象引用，主题切换时由 clearPostCache 清空。
 */
const normalized = new Map<number, { key: unknown[]; post: Post }>()
function cachedPost(raw: unknown, ctx: PostContext, source: Snapshot['source']): Post | null {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const item = raw as Record<string, unknown>
    // 一次取得字段快照：坏访问器只影响这一项，不能使整个 store 回退。
    const input = { id: item.id, post_number: item.post_number, topic_id: item.topic_id, username: item.username, cooked: item.cooked, reply_to_post_number: item.reply_to_post_number, created_at: item.created_at, like_count: item.like_count }
    if (!isId(input.id) || (ctx.allowIds && !ctx.allowIds.has(input.id))) return null
    const key = [source, ctx.topicId, ctx.origin, input.post_number, input.topic_id, input.username, input.cooked, input.reply_to_post_number, input.created_at, input.like_count]
    const hit = normalized.get(input.id)
    if (hit && hit.key.every((value, i) => value === key[i])) return hit.post
    const post = parsePost(input, ctx)
    if (post) normalized.set(post.id, { key, post })
    return post
  } catch { return null }
}

export function clearPostCache() { normalized.clear() }

export function readStore(topicId: number, origin: string, win: DiscourseWindow = window as DiscourseWindow): Snapshot | null {
  try {
    const model = (win.Discourse?.__container__?.lookup('controller:topic') as { model?: { id?: unknown; postStream?: { stream?: unknown; posts?: unknown } } } | undefined)?.model
    if (!model || model.id !== topicId || !model.postStream) return null
    const stream = model.postStream.stream === undefined ? undefined : parseStream(model.postStream.stream)
    if (stream === null) return null
    const rawPosts = model.postStream.posts
    const list: unknown = Array.isArray(rawPosts) ? rawPosts : rawPosts === undefined ? [] : rawPosts && typeof (rawPosts as { toArray?: unknown }).toArray === 'function' ? (rawPosts as { toArray: () => unknown }).toArray() : null
    if (!Array.isArray(list)) return null
    const posts: Post[] = []
    for (const item of list) {
      const post = cachedPost(item, { topicId, origin }, 'store')
      if (post) posts.push(post)
    }
    return stream !== undefined || posts.length ? { posts, stream, source: 'store' } : null
  } catch { return null }
}

/** 正文只在惰性副本中剥离当前脚本的节点，同名类或错误令牌不是自有标注。 */
function cookedHtml(article: HTMLElement): string {
  const cooked = article.querySelector<HTMLElement>('.cooked, .post-content')
  if (!cooked) return ''
  const html = cooked.innerHTML
  if (html.length > MAX_COOKED) throw new RangeError('正文 HTML 超过处理上限')
  if (!cooked.querySelector(OWNED)) return html
  const copy = new DOMParser().parseFromString(html, 'text/html')
  copy.querySelectorAll(OWNED).forEach(node => node.remove())
  return copy.body.innerHTML
}

export function postElements(doc: Document = document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>('[data-post-number]')]
}

/** DOM 的数字属性是十进制字符串，不接受布尔值、科学计数法或楼层标记猜出的数据库 ID。 */
function domId(value: string | undefined): number | undefined {
  const number = value !== undefined && /^\d{1,16}$/.test(value.trim()) ? Number(value) : undefined
  return isId(number) ? number : undefined
}

function domTime(article: HTMLElement): string {
  const el = article.querySelector('time[datetime], .relative-date[data-time]')
  const datetime = el?.getAttribute('datetime')
  if (datetime) return datetime // parsePost 统一校验时间；坏时间不影响其他字段
  const timestamp = el?.getAttribute('data-time')
  if (!timestamp?.trim()) return ''
  const date = new Date(Number(timestamp))
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export function readDom(topicId: number, origin: string, doc: Document = document): Snapshot {
  const posts: Post[] = []
  for (const outer of postElements(doc)) {
    try {
      const article = outer.matches('article') ? outer : outer.querySelector<HTMLElement>('article')
      const postNumber = domId(outer.dataset.postNumber), id = domId(article?.dataset.postId)
      if (!article || id === undefined || postNumber === undefined) continue
      // SPA 切主题时两层标记都可能残留；给出归属就必须一致。
      if ([article.dataset.topicId, outer.dataset.topicId].some(value => value !== undefined && domId(value) !== topicId)) continue
      // 正文节点缺失、为空或只有空结构多半是 Discourse 的渲染占位，按“本次没看到正文”处理，不当成作者清空。
      const html = cookedHtml(article)
      const post = cachedPost({ id, post_number: postNumber, username: article.querySelector('.username, a[data-user-card]')?.textContent, created_at: domTime(article), cooked: hasContent(html) ? html : undefined }, { topicId, origin }, 'dom')
      // DOM 不提供可靠的 reply_to_post_number，保持 undefined（未知）。
      if (post) posts.push(post)
    } catch { /* 单楼不可解析/超限，不影响其他合法楼层，也不把前缀冒充完整正文。 */ }
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
