import type { TopicAnalysis } from './analysis'
import { isId } from './post-input'
import type { QuestionCluster } from './questions'
import { postCoverage, type SessionState } from './session'
import type { Post } from './types'

/**
 * 内部模块契约；没有 window/事件桥、插件执行、网络或存储能力。详见 docs/reader-api.md。
 */
export const readerApiVersion = 1 as const
export const readerLimits = Object.freeze({ queryChars: 120, searchResults: 10, posts: 20, postChars: 2_000, totalChars: 20_000, evidence: 8 })
export interface ReaderSource {
  state: SessionState
  analysis: TopicAnalysis
  /** 构建 analysis 时使用的帖子数组；不能拿新正文配旧分析结果。 */
  analyzedPosts: readonly Post[]
}
interface RequestBase { version: 1; topicId: number }
interface SnapshotRequest extends RequestBase { snapshot: number }
export type ReaderRequest =
  | RequestBase & { op: 'status' }
  | SnapshotRequest & { op: 'search'; query: string; limit?: number }
  | SnapshotRequest & { op: 'question'; questionId: number; offset?: number; limit?: number }
  | SnapshotRequest & { op: 'posts'; postIds: number[] }
export type ReaderErrorCode = 'invalid_request' | 'unsupported_version' | 'unavailable' | 'stale_snapshot' | 'wrong_topic' | 'mode_unavailable' | 'not_found' | 'aborted'
export class ReaderApiError extends Error {
  constructor(readonly code: ReaderErrorCode) { super(code); this.name = 'ReaderApiError' }
}
interface Metadata {
  version: 1
  snapshot: number
  topicId: number
  mode: TopicAnalysis['mode']
  source: SessionState['source']
  /** 不能逐楼确定来源时只报告整体，不能伪称这些正文均已重新核验。 */
  cachedPosts: number
  loaded: number
  total: number | null
  missing: number | null
  trust: 'untrusted-forum-content'
  method: 'local-rules-not-verified-answers'
}
interface QuestionSummary {
  questionId: number
  postNumber: number | null
  text: string
  questionCount: number
  replyCount: number
}
export type ReaderResponse = Metadata & (
  | { op: 'status' }
  | { op: 'search'; matches: QuestionSummary[] }
  | { op: 'question'; question: QuestionSummary; offset: number; hasMore: boolean; replies: { postId: number; postNumber: number | null; evidence: { questionId: number; kind: 'reply' | 'quote' }[]; evidenceTruncated: boolean }[] }
  | { op: 'posts'; posts: { id: number; postNumber: number; text: string; truncated: boolean }[]; missingIds: number[] }
)
const fail = (code: ReaderErrorCode): never => { throw new ReaderApiError(code) }
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) fail('aborted') }
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const keys = (value: Record<string, unknown>, allowed: string[]) => { if (Object.keys(value).some(key => !allowed.includes(key))) fail('invalid_request') }

/** 只接受已有契约的字段；调用者不能偷加加载、导航、写回或供应商参数。 */
function validate(value: unknown): ReaderRequest {
  if (!object(value)) return fail('invalid_request')
  if (value.version !== readerApiVersion) return fail('unsupported_version')
  if (!isId(value.topicId)) return fail('invalid_request')
  const base = ['version', 'topicId', 'op']
  if (value.op === 'status') { keys(value, base); return value as unknown as ReaderRequest }
  if (!isId(value.snapshot)) return fail('invalid_request')
  base.push('snapshot')
  if (value.op === 'search') {
    keys(value, [...base, 'query', 'limit'])
    if (typeof value.query !== 'string' || !value.query.trim() || value.query.length > readerLimits.queryChars || (value.limit !== undefined && !integer(value.limit, 1, readerLimits.searchResults))) return fail('invalid_request')
  } else if (value.op === 'question') {
    keys(value, [...base, 'questionId', 'offset', 'limit'])
    if (!isId(value.questionId) || (value.offset !== undefined && !integer(value.offset, 0, Number.MAX_SAFE_INTEGER)) || (value.limit !== undefined && !integer(value.limit, 1, readerLimits.posts))) return fail('invalid_request')
  } else if (value.op === 'posts') {
    keys(value, [...base, 'postIds'])
    if (!Array.isArray(value.postIds) || !value.postIds.length || value.postIds.length > readerLimits.posts || !value.postIds.every(isId) || new Set(value.postIds).size !== value.postIds.length) return fail('invalid_request')
  } else return fail('invalid_request')
  return value as unknown as ReaderRequest
}

/** UTF-16 上限，不截断代理对；截断永远在响应中声明，绝不冒充完整原帖。 */
function excerpt(text: string, max: number): string {
  const end = Math.min(max, text.length)
  return text.slice(0, end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) ? end - 1 : end)
}

export function createReaderApi(readSource: () => ReaderSource | undefined) {
  let closed = false, revision = 0, previous: ReaderSource | undefined
  let byId = new Map<number, Post>()
  const snapshot = () => {
    if (closed) return fail('unavailable')
    const source = readSource()
    if (!source) { previous = undefined; byId.clear(); return fail('unavailable') }
    const { state, analysis } = source
    if (!previous || previous.state.origin !== state.origin || previous.state.topicId !== state.topicId || previous.state.posts !== state.posts || previous.state.stream !== state.stream || previous.state.source !== state.source || previous.state.cachedCount !== state.cachedCount || previous.analysis.mode !== analysis.mode || previous.analysis.result !== analysis.result) {
      revision++
      byId = new Map(state.posts.filter(post => post.origin === state.origin && post.topicId === state.topicId).map(post => [post.id, post]))
    }
    previous = source
    return { source, revision }
  }
  return {
    capabilities: Object.freeze({ version: readerApiVersion, operations: Object.freeze(['status', 'search', 'question', 'posts'] as const), limits: readerLimits }),
    async execute(input: unknown, signal?: AbortSignal): Promise<ReaderResponse> {
      checkAbort(signal)
      const request = validate(input)
      // 允许调用者在同一事件循环里取消；不启动任务、计时器或后台重试。
      await Promise.resolve()
      checkAbort(signal)
      const { source, revision: current } = snapshot(), { state, analysis } = source
      if (request.topicId !== state.topicId) return fail('wrong_topic')
      if ('snapshot' in request && request.snapshot !== current) return fail('stale_snapshot')
      const coverage = postCoverage(state.posts, state.stream)
      const meta: Metadata = { version: readerApiVersion, snapshot: current, topicId: state.topicId, mode: analysis.mode, source: state.source, cachedPosts: state.cachedCount ?? 0, loaded: coverage.loaded, total: coverage.total ?? null, missing: coverage.missing ?? null, trust: 'untrusted-forum-content', method: 'local-rules-not-verified-answers' }
      const summary = (cluster: QuestionCluster): QuestionSummary => ({ questionId: cluster.questionIds[0], postNumber: byId.get(cluster.questionIds[0])?.postNumber ?? null, text: excerpt(cluster.text, 400), questionCount: cluster.questionIds.length, replyCount: cluster.answerIds.length })
      let response: ReaderResponse
      if (request.op === 'status') response = { ...meta, op: 'status' }
      else if (request.op === 'posts') {
        let remaining = readerLimits.totalChars as number
        const posts: Extract<ReaderResponse, { op: 'posts' }>['posts'] = [], missingIds: number[] = []
        for (const id of request.postIds) {
          checkAbort(signal)
          const post = byId.get(id)
          if (!post) { missingIds.push(id); continue }
          const text = excerpt(post.text, Math.min(readerLimits.postChars, remaining))
          remaining -= text.length
          posts.push({ id, postNumber: post.postNumber, text, truncated: text.length !== post.text.length })
        }
        response = { ...meta, op: 'posts', posts, missingIds }
      } else {
        if (analysis.mode !== 'qa') return fail('mode_unavailable')
        if (source.analyzedPosts !== state.posts) return fail('stale_snapshot')
        if (request.op === 'search') response = { ...meta, op: 'search', matches: analysis.result.search(request.query, request.limit ?? readerLimits.searchResults).slice(0, readerLimits.searchResults).map(({ cluster }) => summary(cluster)) }
        else {
          const cluster = analysis.result.clusterOf.get(request.questionId)
          if (!cluster) return fail('not_found')
          const offset = request.offset ?? 0, limit = request.limit ?? readerLimits.posts
          const replies = cluster.answerIds.slice(offset, offset + limit).map(postId => {
            const evidence = cluster.answerEvidence.get(postId) ?? []
            return { postId, postNumber: byId.get(postId)?.postNumber ?? null, evidence: evidence.slice(0, readerLimits.evidence).map(item => ({ questionId: item.questionId, kind: item.kind })), evidenceTruncated: evidence.length > readerLimits.evidence }
          })
          response = { ...meta, op: 'question', question: summary(cluster), offset, hasMore: offset + replies.length < cluster.answerIds.length, replies }
        }
      }
      checkAbort(signal)
      if (snapshot().revision !== current) return fail('stale_snapshot')
      return response // 全部是白名单拷贝，不返回可修改的会话数组/Map/HTML/用户名。
    },
    close() { closed = true; previous = undefined; byId.clear() },
  }
}
export type ReaderApi = ReturnType<typeof createReaderApi>
