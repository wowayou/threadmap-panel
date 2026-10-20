import { normalizePost } from './phrases'
import type { Post } from './types'

/**
 * 信任边界：页面数据（store）、DOM 与接口返回的帖子都先经过这里，再进入会话。
 * 字段类型或归属不对的帖子直接丢弃（返回 null），不猜测修补；
 * 本函数不抛异常，单条异常数据不会影响其他楼层。
 */

export interface PostContext {
  topicId: number
  origin: string
  /** 只接受这些数据库 ID（分批请求时传入本批请求的 ID） */
  allowIds?: ReadonlySet<number>
}

/** 与文本提取共用预算，禁止在进入提取器前静默截断。 */
export { MAX_COOKED } from './phrases'
const MAX_USERNAME = 100

export const isId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** 所有入口（页面 store、调用方已知列表、主题 JSON）共用的 stream 条目上限。 */
export const MAX_STREAM = 500_000

/** stream 容器必须是数组且不超过 MAX_STREAM 项；合法 ID 稳定去重，缺失/错误/超限结构不伪造成空数组。 */
export function parseStream(value: unknown): number[] | null {
  return Array.isArray(value) && value.length <= MAX_STREAM ? [...new Set(value.filter(isId))] : null
}
export const streamTooLarge = (value: unknown) => Array.isArray(value) && value.length > MAX_STREAM

export function parsePost(raw: unknown, ctx: PostContext): Post | null {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !isId(ctx.topicId)) return null
    const item = raw as Record<string, unknown>
    const id = item.id, postNumber = item.post_number
    if (!isId(id) || !isId(postNumber)) return null
    if (ctx.allowIds && !ctx.allowIds.has(id)) return null
    // 接口给出了所属主题时必须一致；没给出时按请求的主题处理
    if (item.topic_id !== undefined && item.topic_id !== ctx.topicId) return null
    // 缺失正文是空观测（bodyMissing），不据此声称帖子已删除；空字符串是平台明确给出的空正文；类型不对视为异常
    const missing = item.cooked === undefined || item.cooked === null
    const cooked = missing ? '' : item.cooked
    if (typeof cooked !== 'string') return null
    const reply = item.reply_to_post_number
    if (reply !== undefined && reply !== null && !isId(reply)) return null
    const username = typeof item.username === 'string' && item.username.trim() ? item.username.trim().slice(0, MAX_USERNAME) : '未知用户'
    const createdAt = typeof item.created_at === 'string' && !Number.isNaN(Date.parse(item.created_at)) ? item.created_at : ''
    return {
      ...normalizePost({
        id, post_number: postNumber, username, created_at: createdAt,
        cooked,
        // 平台没给出回复字段时保持“未知”，不伪造成 null
        ...(reply !== undefined ? { reply_to_post_number: reply as number | null } : {}),
        like_count: item.like_count,
      }),
      topicId: ctx.topicId,
      origin: ctx.origin,
      ...(missing ? { bodyMissing: true as const } : {}),
    }
  } catch { return null }
}

/** 不含文字时仍算正文内容的元素（图片、媒体、嵌入）。 */
const MEDIA = 'img,picture,video,audio,iframe,embed,object,svg,canvas,math'
const MEDIA_TAG = /<(img|picture|video|audio|iframe|embed|object|svg|canvas|math)\b/i

/**
 * 正文 HTML 是否有真正内容：非空白文字或图片/媒体（含引用、代码，它们可能被分析文本排除）。
 * `<p></p>`、注释、只有空白或 &nbsp; 的结构不算。只在惰性文档里检查，不执行或加载任何资源。
 */
export function hasContent(html: string): boolean {
  if (!html.trim()) return false
  // 快速路径：去掉注释/标签后有不含实体的可见字符，即有文字。
  const text = html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, '')
  if (/\S/.test(text) && !text.includes('&')) return true
  if (typeof DOMParser === 'undefined') return MEDIA_TAG.test(html) || /\S/.test(text.replace(/&(nbsp|#160|#xa0);/gi, ' '))
  const body = new DOMParser().parseFromString(html, 'text/html').body
  body.querySelectorAll('script,style,template').forEach(node => node.remove())
  return /\S/.test(body.textContent || '') || !!body.querySelector(MEDIA)
}

const bodies = new WeakMap<Post, boolean>()
/** 当前观测确实带来了有内容的正文（含只有图片/代码、提取后纯文本为空的楼）。空占位与空结构不算。 */
export function hasBody(post: Post): boolean {
  if (post.bodyMissing) return false
  let value = bodies.get(post)
  if (value === undefined) { value = hasContent(post.raw); bodies.set(post, value) }
  return value
}
