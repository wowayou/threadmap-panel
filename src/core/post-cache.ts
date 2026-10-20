import { LocalizedError, message, type Text } from '../i18n'
import { hasContent, isId, MAX_COOKED, parsePost } from './post-input'
import type { Post } from './types'

/** 本地预算，不是浏览器承诺的磁盘配额；容量按字符串 UTF-16 与保守元数据开销估算。 */
export const cachePolicy = {
  ttlMs: 24 * 60 * 60_000,
  maxTopics: 3,
  maxPosts: 10_000,
  topicBytes: 8 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
  writeDelayMs: 750,
  storageTimeoutMs: 5_000,
  restoreSliceMs: 12,
} as const
export interface CacheIdentity { origin: string; accountId: number }
export interface CacheScope extends CacheIdentity { topicId: number }
export interface CacheConsent extends CacheIdentity { token: string }
export interface CachedPost {
  id: number; postNumber: number; username: string; createdAt: string; raw: string
  replyToPostNumber?: number | null; likeCount?: number; seenAt: number
}
export interface CachedTopic extends CacheScope { posts: CachedPost[]; bytes: number; updatedAt: number }
export interface CacheStatus { enabled: boolean; busy: boolean; saved: number; message: Text; error: boolean }
export interface PostCacheApi {
  get(): CacheStatus
  subscribe(listener: () => void): () => void
  enable(): Promise<void>
  disable(): Promise<void>
}
export const cacheBytes = (post: CachedPost) => 192 + 2 * (post.raw.length + post.username.length + post.createdAt.length)
const timestamp = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

function validPost(value: unknown, now: number): value is CachedPost {
  if (!record(value) || !isId(value.id) || !isId(value.postNumber) || !timestamp(value.seenAt) || value.seenAt > now || now - value.seenAt >= cachePolicy.ttlMs) return false
  return typeof value.raw === 'string' && value.raw.length <= MAX_COOKED && typeof value.username === 'string' && value.username.length <= 100 && typeof value.createdAt === 'string' && value.createdAt.length <= 64
    && (value.replyToPostNumber === undefined || value.replyToPostNumber === null || isId(value.replyToPostNumber))
    && (value.likeCount === undefined || (timestamp(value.likeCount)))
}

/** 只选明确允许的字段，不复制输入、HTML 页、凭据或派生文本。 */
export function cachePost(post: Post, scope: CacheScope, seenAt: number): CachedPost | null {
  // 没观测到正文的楼不是新事实，不能用空值覆盖或刷新已保存的记录。
  if (post.bodyMissing || post.origin !== scope.origin || post.topicId !== scope.topicId) return null
  const value = { id: post.id, postNumber: post.postNumber, username: post.username, createdAt: post.createdAt, raw: post.raw, seenAt,
    ...(post.replyToPostNumber !== undefined ? { replyToPostNumber: post.replyToPostNumber } : {}),
    ...(post.likeCount !== undefined ? { likeCount: post.likeCount } : {}),
  }
  return validPost(value, seenAt) ? value : null
}

/** 缓存也是不可信输入；容器/归属异常整条拒绝，过期/非法单楼不继续使用。 */
export function inspectTopic(value: unknown, scope: CacheScope, now: number): CachedTopic | undefined {
  if (value === undefined) return undefined
  if (!timestamp(now) || !record(value) || value.origin !== scope.origin || value.accountId !== scope.accountId || value.topicId !== scope.topicId || !Array.isArray(value.posts) || value.posts.length > cachePolicy.maxPosts || !timestamp(value.updatedAt) || value.updatedAt > now) throw new LocalizedError(message('cache.errorScope'))
  const posts: CachedPost[] = [], ids = new Set<number>(), floors = new Set<number>()
  let bytes = 256
  for (const input of value.posts) {
    if (!validPost(input, now)) continue
    if (ids.has(input.id) || floors.has(input.postNumber)) throw new LocalizedError(message('cache.errorConflict'))
    ids.add(input.id); floors.add(input.postNumber)
    bytes += cacheBytes(input)
    if (bytes > cachePolicy.topicBytes) throw new LocalizedError(message('cache.errorBudget'))
    // 明确复制白名单字段，不保留伪造字段或对象原型。
    posts.push({ id: input.id, postNumber: input.postNumber, username: input.username, createdAt: input.createdAt, raw: input.raw, seenAt: input.seenAt, replyToPostNumber: input.replyToPostNumber, likeCount: input.likeCount })
  }
  return { ...scope, posts, bytes, updatedAt: value.updatedAt }
}

export function mergeCachedTopic(scope: CacheScope, previous: CachedTopic | undefined, incoming: readonly CachedPost[], now: number) {
  const byId = new Map((previous?.posts ?? []).filter(p => validPost(p, now)).map(p => [p.id, p]))
  for (const post of incoming) if (validPost(post, now)) {
    const old = byId.get(post.id)
    if (!old || post.seenAt >= old.seenAt) byId.set(post.id, post)
  }
  // 较新的明确清空（正文无内容）是撤销：覆盖旧记录后不再保存，不留空壳冒充缓存楼层。
  const newest = [...byId.values()].filter(p => hasContent(p.raw)).sort((a, b) => b.seenAt - a.seenAt || b.postNumber - a.postNumber)
  const kept: CachedPost[] = [], floors = new Set<number>()
  let bytes = 256
  for (const post of newest) {
    if (kept.length >= cachePolicy.maxPosts || bytes + cacheBytes(post) > cachePolicy.topicBytes || floors.has(post.postNumber)) continue
    kept.push(post); floors.add(post.postNumber); bytes += cacheBytes(post)
  }
  const topic: CachedTopic = { ...scope, posts: kept.sort((a, b) => a.postNumber - b.postNumber), bytes, updatedAt: now }
  return { topic, limited: kept.length < newest.length }
}

/** 恢复不刷新 seenAt；实时楼层（包括空正文）优先，新 stream 排除已移除的旧帖子。 */
export function cachedCandidates(topic: CachedTopic, live: readonly Post[], stream?: readonly number[]): CachedPost[] {
  const ids = new Set(live.map(p => p.id)), floors = new Set(live.map(p => p.postNumber)), allowed = stream && new Set(stream)
  return topic.posts.filter(p => hasContent(p.raw) && !ids.has(p.id) && !floors.has(p.postNumber) && (!allowed || allowed.has(p.id)))
}
export function decodeCachedPost(p: CachedPost, topic: CacheScope): Post | null {
  return parsePost({ id: p.id, post_number: p.postNumber, topic_id: topic.topicId, username: p.username, created_at: p.createdAt, cooked: p.raw, reply_to_post_number: p.replyToPostNumber, like_count: p.likeCount }, topic)
}
export function restoreCachedPosts(topic: CachedTopic | undefined, live: readonly Post[], stream?: readonly number[]): Post[] {
  return topic ? cachedCandidates(topic, live, stream).map(p => decodeCachedPost(p, topic)).filter((p): p is Post => p !== null) : []
}
