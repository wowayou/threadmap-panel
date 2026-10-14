import type { Post } from './types'

/**
 * 长帖重复提问：识别提问楼 → 按字词相似度归组 → 关联明确的回答（平台回复或引用）。
 * 全部在本地计算，不调用外部服务。相似度是字面相似，会有漏判和误判，界面必须说明。
 */

export interface QuestionCluster {
  id: number
  /** 提问楼（按楼层排序），第一个是最早的提问 */
  questionIds: number[]
  /** 明确回复或引用了这些提问的楼，按点赞数、楼层排序 */
  answerIds: number[]
  /** 代表性问题文本（最早一楼的提问句） */
  text: string
}

export interface QaResult {
  questions: Map<number, string>
  clusters: QuestionCluster[]
  clusterOf: Map<number, QuestionCluster>
  /** 被问过 2 次及以上的问题组，按次数、楼层排序 */
  repeated: QuestionCluster[]
  search: (query: string, limit?: number) => { cluster: QuestionCluster; score: number }[]
}

export const SIMILAR = 0.45
const SEARCH_MIN = 0.25
const MAX_MEMBERS_COMPARED = 20

const SENTENCE = /(?<=[。！？!?；;\n])/u
const MARK = /[?？]/u
const ENDING = /[吗么呢嘛][\s~～。.!！…]*$/u
const WORDS = /(怎么|怎样|如何|为什么|为啥|咋|能否|能不能|可不可以|有没有|是否|求教|求助|请教|请问|在哪|哪里|哪儿|哪个|什么|多少|几[个天次]|怎么办|啥)/u
const EN_START = /^(how|why|what|when|where|which|who|can|could|does|do|is|are|should|will|would)\b/i
const RESOLVED = /(已经|搞定|解决了|知道了|会了|明白了|好了|谢谢|感谢)/u

/** 提取一楼里的提问句；没有提问句返回空字符串 */
export function questionText(text: string): string {
  const sentences = text.split(SENTENCE).map(s => s.trim()).filter(s => s.length >= 4 && s.length <= 200)
  const asked = sentences.filter(s => !RESOLVED.test(s) && (MARK.test(s) || ENDING.test(s) || WORDS.test(s) || EN_START.test(s)))
  return asked.join(' ').slice(0, 400)
}

/** 去掉只表示“在提问”的词，避免“怎么安装”和“怎么卸载”因为都有“怎么”而相似 */
const FILLER = /(请问|请教|求助|求教|求问|问下|问一下|想问|有人知道|有谁知道|有没有人|大佬们?|佬友们?|佬们|各位|大家|一下|谢谢|感谢|怎么办|怎么|怎样|如何|为什么|为啥|什么|是否|能否|能不能|可不可以|有没有|可以|在哪里|在哪儿|在哪|哪里|这个|那个|这种|我的|我们|需要|应该|要|去|吗|么|呢|吧|啊|呀|哈|嘛|的|了|是|我)/gu
const CJK_RUN = /[\u3400-\u9fff]+/gu
const LATIN = /[a-z0-9][a-z0-9._+-]*/g

export function tokens(text: string): string[] {
  const cleaned = text.toLowerCase().replace(FILLER, ' ')
  const out: string[] = []
  for (const run of cleaned.match(CJK_RUN) || []) {
    if (run.length === 1) out.push(run)
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2))
  }
  for (const word of cleaned.match(LATIN) || []) if (word.length >= 2) out.push(word)
  return out
}

type Vector = Map<string, number>

function vectorize(list: string[], idf: (t: string) => number): Vector {
  const tf = new Map<string, number>()
  list.forEach(t => tf.set(t, (tf.get(t) || 0) + 1))
  const v: Vector = new Map()
  let norm = 0
  tf.forEach((count, t) => { const w = (1 + Math.log(count)) * idf(t); v.set(t, w); norm += w * w })
  norm = Math.sqrt(norm) || 1
  v.forEach((w, t) => v.set(t, w / norm))
  return v
}

function cosine(a: Vector, b: Vector): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  let sum = 0
  small.forEach((w, t) => { const o = large.get(t); if (o) sum += w * o })
  return sum
}

/** 引用：<aside class="quote" data-post="N" data-topic="T">，属性顺序不固定 */
function quotedPostNumbers(raw: string, topicId?: number): number[] {
  const out: number[] = []
  // 有界匹配：单个标签最多 600 字符，避免异常输入导致回溯过久
  for (const tag of raw.match(/<aside\b[^>]{0,600}>/g) || []) {
    if (!/\bclass="[^"]{0,200}\bquote\b/.test(tag)) continue
    const post = Number(tag.match(/\bdata-post="(\d{1,7})"/)?.[1])
    const topic = Number(tag.match(/\bdata-topic="(\d{1,12})"/)?.[1])
    if (Number.isSafeInteger(post) && post > 0 && (topicId === undefined || !topic || topic === topicId)) out.push(post)
  }
  return out
}

export function buildQa(posts: Post[]): QaResult {
  const sorted = [...posts].sort((a, b) => a.postNumber - b.postNumber)
  const byNumber = new Map(sorted.map(p => [p.postNumber, p]))
  const questions = new Map<number, string>()
  const tokenLists = new Map<number, string[]>()
  for (const post of sorted) {
    if (post.postNumber === 1) continue
    const q = questionText(post.text)
    const list = q ? tokens(q) : []
    if (list.length >= 2) { questions.set(post.id, q); tokenLists.set(post.id, list) }
  }

  const df = new Map<string, number>()
  tokenLists.forEach(list => new Set(list).forEach(t => df.set(t, (df.get(t) || 0) + 1)))
  const n = tokenLists.size
  const idf = (t: string) => Math.log((n + 1) / ((df.get(t) || 0) + 1)) + 1
  const vectors = new Map<number, Vector>()
  tokenLists.forEach((list, id) => vectors.set(id, vectorize(list, idf)))

  // 单遍归组：与已有组中任意一楼（最多比较 20 楼）足够相似即并入。
  // 性能：用倒排索引只比较“共享至少一个不常见词”的组；出现在超过 5% 提问里的词不建索引，
  // 只共享常见词的两句话加权后相似度很低，不会达到阈值。
  const clusters: QuestionCluster[] = []
  const clusterOf = new Map<number, QuestionCluster>()
  const commonDf = Math.max(20, Math.ceil(n * 0.05))
  const postings = new Map<string, Set<QuestionCluster>>()
  const candidatesFor = (v: Vector) => {
    const found = new Set<QuestionCluster>()
    v.forEach((_, t) => { if ((df.get(t) || 0) <= commonDf) postings.get(t)?.forEach(c => found.add(c)) })
    return found
  }
  const similarity = (v: Vector, c: QuestionCluster) => {
    let best = 0
    for (const m of c.questionIds.slice(0, MAX_MEMBERS_COMPARED)) best = Math.max(best, cosine(v, vectors.get(m)!))
    return best
  }
  for (const [id, v] of vectors) {
    let best: QuestionCluster | null = null, bestScore = SIMILAR
    for (const c of candidatesFor(v)) {
      const score = similarity(v, c)
      if (score > bestScore || (score === bestScore && best && c.id < best.id)) { best = c; bestScore = score }
    }
    if (!best) { best = { id: clusters.length + 1, questionIds: [], answerIds: [], text: questions.get(id)! }; clusters.push(best) }
    best.questionIds.push(id)
    clusterOf.set(id, best)
    if (best.questionIds.length <= MAX_MEMBERS_COMPARED) v.forEach((_, t) => { if ((df.get(t) || 0) <= commonDf) { const set = postings.get(t); if (set) set.add(best!); else postings.set(t, new Set([best!])) } })
  }

  // 明确的回答：平台回复或引用了某个提问楼，且不是提问者本人、自身不是同组的提问
  const askerOf = new Map(sorted.map(p => [p.id, p.username]))
  for (const post of sorted) {
    const targets = [post.replyToPostNumber ?? undefined, ...quotedPostNumbers(post.raw, post.topicId)].filter((x): x is number => typeof x === 'number')
    for (const number of new Set(targets)) {
      const target = byNumber.get(number)
      const cluster = target && clusterOf.get(target.id)
      if (!cluster || post.username === askerOf.get(target.id) || cluster.questionIds.includes(post.id) || cluster.answerIds.includes(post.id)) continue
      cluster.answerIds.push(post.id)
    }
  }
  const postById = new Map(sorted.map(p => [p.id, p]))
  clusters.forEach(c => c.answerIds.sort((a, b) => (postById.get(b)?.likeCount || 0) - (postById.get(a)?.likeCount || 0) || postById.get(a)!.postNumber - postById.get(b)!.postNumber))

  const repeated = clusters.filter(c => c.questionIds.length > 1).sort((a, b) => b.questionIds.length - a.questionIds.length || postById.get(a.questionIds[0])!.postNumber - postById.get(b.questionIds[0])!.postNumber)

  return {
    questions, clusters, clusterOf, repeated,
    search(query, limit = 5) {
      const list = tokens(query)
      if (!list.length) return []
      const v = vectorize(list, idf)
      // 查询很短时可能只含常见词：候选为空就退回全量比较（一次查询，代价可接受）
      const pool = candidatesFor(v)
      return [...(pool.size ? pool : clusters)]
        .map(cluster => ({ cluster, score: similarity(v, cluster) }))
        .filter(r => r.score >= SEARCH_MIN)
        .sort((a, b) => b.score - a.score || b.cluster.answerIds.length - a.cluster.answerIds.length || a.cluster.id - b.cluster.id)
        .slice(0, limit)
    },
  }
}
