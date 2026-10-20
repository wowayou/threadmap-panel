import type { Post } from './types'
import { isId, MAX_COOKED } from './post-input'

export interface QaSettings { approximate: boolean; associateReplies: boolean }
export const defaultQaSettings: QaSettings = { approximate: true, associateReplies: true }
/** 候选和单词索引有界；不是语义穷举，不为漏分自动请求更多帖子。 */
export const qaLimits = { candidates: 128, clustersPerToken: 128, membersCompared: 20 } as const

/**
 * 长帖重复提问：识别提问楼 → 按字词相似度归组 → 关联明确的回答（平台回复或引用）。
 * 全部在本地计算，不调用外部服务。相似度是字面相似，会有漏判和误判，界面必须说明。
 */

export interface ReplyEvidence { questionId: number; kind: 'reply' | 'quote' }

export interface QuestionCluster {
  id: number
  /** 提问楼（按楼层排序），第一个是最早的提问 */
  questionIds: number[]
  /** 明确回复或引用了这些提问的楼，按点赞数、楼层排序 */
  answerIds: number[]
  /** 归组时保留结构证据；展示/程序接口不再从正文重新猜测。 */
  answerEvidence: Map<number, ReplyEvidence[]>
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
const MAX_MEMBERS_COMPARED = qaLimits.membersCompared

/** 句子：以句末标点结尾的一段，或末尾没有标点的剩余部分。不用后行断言（Safari 16.4 以下不支持，会让整个脚本无法解析） */
const SENTENCE = /[^。！？!?；;\n]*[。！？!?；;\n]|[^。！？!?；;\n]+$/gu
const MARK = /[?？]/u
const ENDING = /[吗么呢嘛][\s~～。.!！…]*$/u
const WORDS = /(怎么|怎样|如何|为什么|为啥|咋|能否|能不能|可不可以|有没有|是否|求教|求助|请教|请问|在哪|哪里|哪儿|哪个|什么|多少|几[个天次]|怎么办|啥)/u
const EN_START = /^(how|why|what|when|where|which|who|can|could|does|do|is|are|should|will|would)\b/i
const RESOLVED = /(已经|搞定|解决了|知道了|会了|明白了|好了|谢谢|感谢)/u

/** 提取一楼里的提问句；没有提问句返回空字符串 */
export function questionText(text: string): string {
  const sentences = (text.match(SENTENCE) || []).map(s => s.trim()).filter(s => s.length >= 4 && s.length <= 200)
  const asked = sentences.filter(s => !RESOLVED.test(s) && (MARK.test(s) || ENDING.test(s) || WORDS.test(s) || EN_START.test(s)))
  return asked.join(' ').slice(0, 400)
}

/** 去掉只表示“在提问”的词，避免“怎么安装”和“怎么卸载”因为都有“怎么”而相似 */
const FILLER = /(请问|请教|求助|求教|求问|问下|问一下|想问|有人知道|有谁知道|有没有人|大佬们?|佬友们?|佬们|各位|大家|一下|谢谢|感谢|怎么办|怎么|怎样|如何|为什么|为啥|什么|是否|能否|能不能|可不可以|有没有|可以|在哪里|在哪儿|在哪|哪里|这个|那个|这种|我的|我们|需要|应该|要|去|吗|么|呢|吧|啊|呀|哈|嘛|的|了|是|我)/gu
const CJK_RUN = /[\u3400-\u9fff]+/gu
const LATIN = /[a-z0-9][a-z0-9._+-]*/g
/** 英文疑问词与虚词不应主导相似度；保留 not/no 等否定和 enable/disable 等操作词。 */
const LATIN_FILLER = new Set('how why what when where which who can could does do is are should will would to the an and or i we you my our your it this that please thanks thank me for of in on at'.split(' '))

export function tokens(text: string): string[] {
  const cleaned = text.toLowerCase().replace(FILLER, ' ')
  const out: string[] = []
  for (const run of cleaned.match(CJK_RUN) || []) {
    if (run.length === 1) out.push(run)
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2))
  }
  for (const word of cleaned.match(LATIN) || []) if (word.length >= 2 && !LATIN_FILLER.has(word)) out.push(word)
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

/** 只认惰性文档中的真实引用节点；注释、代码、伪属性不能成为证据。 */
function quotedPostNumbers(raw: string, topicId?: number): number[] {
  if (typeof DOMParser === 'undefined' || raw.length > MAX_COOKED || !/<aside\b[^>]{0,600}>/i.test(raw)) return []
  const doc = new DOMParser().parseFromString(raw, 'text/html'), out: number[] = []
  const number = (value: string | null) => value !== null && /^\d{1,16}$/.test(value) && isId(Number(value)) ? Number(value) : undefined
  for (const quote of doc.querySelectorAll('aside.quote[data-post]')) {
    if (quote.parentElement?.closest('aside.quote,blockquote,pre,code,script,style,template')) continue
    const post = number(quote.getAttribute('data-post')), topic = quote.getAttribute('data-topic')
    if (post === undefined || (topic !== null && (number(topic) === undefined || (topicId !== undefined && number(topic) !== topicId)))) continue
    out.push(post)
  }
  return out
}

/** 未变化的帖子保持对象引用；重算问答时不重复解析同一楼的引用 HTML。 */
const quoteCache = new WeakMap<Post, { raw: string; topicId?: number; value: number[] }>()
function quotesOf(post: Post): number[] {
  const hit = quoteCache.get(post)
  if (hit && hit.raw === post.raw && hit.topicId === post.topicId) return hit.value
  const value = quotedPostNumbers(post.raw, post.topicId)
  quoteCache.set(post, { raw: post.raw, topicId: post.topicId, value })
  return value
}

/** 仅保护明确 HTTP/报错上下文里的代码，不声称理解所有数字、否定或语义。 */
function errorCodes(text: string): string {
  if (!/(?:http|状态码|错误码|报错|返回|error|status)/i.test(text) && !/^\s*[45]\d{2}\s*$/.test(text)) return ''
  return [...new Set(text.match(/\b[45]\d{2}\b/g) || [])].sort().join(',')
}
const compatibleCodes = (a: string, b: string) => !a || !b || a === b
const signature = (list: string[]) => JSON.stringify([...list].sort())
const exactQuestion = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim()

export function buildQa(posts: Post[], settings: QaSettings = defaultQaSettings): QaResult {
  const sorted = [...posts].sort((a, b) => a.postNumber - b.postNumber)
  const byNumber = new Map(sorted.map(p => [p.postNumber, p]))
  const questions = new Map<number, string>(), tokenLists = new Map<number, string[]>(), codes = new Map<number, string>()
  for (const post of sorted) {
    if (post.postNumber === 1) continue
    const q = questionText(post.text), list = q ? tokens(q) : []
    if (list.length >= 2) { questions.set(post.id, q); tokenLists.set(post.id, list); codes.set(post.id, errorCodes(q)) }
  }

  // 重复副本不应改变词权重，否则越多人重复，原本同组的改写反而会被拆散。
  const uniqueLists = new Map([...tokenLists.values()].map(list => [signature(list), list]))
  const df = new Map<string, number>()
  uniqueLists.forEach(list => new Set(list).forEach(t => df.set(t, (df.get(t) || 0) + 1)))
  const n = uniqueLists.size
  const idf = (t: string) => Math.log((n + 1) / ((df.get(t) || 0) + 1)) + 1
  const vectors = new Map<number, Vector>()
  tokenLists.forEach((list, id) => vectors.set(id, vectorize(list, idf)))

  const clusters: QuestionCluster[] = [], clusterOf = new Map<number, QuestionCluster>()
  const clusterCodes = new Map<QuestionCluster, string>(), fingerprints = new Map<string, QuestionCluster>()
  const commonDf = Math.max(20, Math.ceil(n * 0.05)), postings = new Map<string, Set<QuestionCluster>>()
  const candidatesFor = (v: Vector) => {
    const found = new Set<QuestionCluster>(), terms = [...v.keys()].sort((a, b) => (df.get(a) || 0) - (df.get(b) || 0) || a.localeCompare(b))
    const collect = (common: boolean) => {
      for (const t of terms) {
        if (((df.get(t) || 0) > commonDf) !== common) continue
        for (const c of postings.get(t) || []) { found.add(c); if (found.size >= qaLimits.candidates) return }
      }
    }
    collect(false)
    // 全是常见词仍可能是最常被重复的问题，不能直接排除；回退同样有硬上界。
    if (!found.size) collect(true)
    return found
  }
  const similarity = (v: Vector, c: QuestionCluster, code: string) => {
    if (!compatibleCodes(code, clusterCodes.get(c) || '')) return 0
    let best = 0
    for (const m of c.questionIds.slice(0, MAX_MEMBERS_COMPARED)) best = Math.max(best, cosine(v, vectors.get(m)!))
    return best
  }
  for (const [id, v] of vectors) {
    const key = settings.approximate ? signature(tokenLists.get(id)!) : exactQuestion(questions.get(id)!)
    const code = codes.get(id) || ''
    let best = fingerprints.get(key) || null, bestScore = SIMILAR
    if (best && !compatibleCodes(code, clusterCodes.get(best) || '')) best = null
    if (!best && settings.approximate) for (const c of candidatesFor(v)) {
      const score = similarity(v, c, code)
      if (score > bestScore || (score === bestScore && best && c.id < best.id)) { best = c; bestScore = score }
    }
    if (!best) { best = { id: clusters.length + 1, questionIds: [], answerIds: [], answerEvidence: new Map(), text: questions.get(id)! }; clusters.push(best) }
    best.questionIds.push(id)
    clusterOf.set(id, best); fingerprints.set(key, best)
    if (code) clusterCodes.set(best, code)
    if (best.questionIds.length <= MAX_MEMBERS_COMPARED) v.forEach((_, t) => {
      let set = postings.get(t)
      if (!set) { set = new Set(); postings.set(t, set) }
      if (set.size < qaLimits.clustersPerToken) set.add(best!)
    })
  }

  // 结构性关联，不判断回答质量；Set 去重避免大回复组的平方级 includes 扫描。
  const answers = new Map<QuestionCluster, Set<number>>()
  if (settings.associateReplies) for (const post of sorted) {
    const targets = new Map<number, ReplyEvidence['kind']>(quotesOf(post).map(number => [number, 'quote']))
    if (post.replyToPostNumber) targets.set(post.replyToPostNumber, 'reply')
    for (const [number, kind] of targets) {
      const target = byNumber.get(number), cluster = target && clusterOf.get(target.id)
      if (!target || !cluster || post.postNumber <= target.postNumber || post.username === target.username || clusterOf.get(post.id) === cluster) continue
      if ((post.topicId !== undefined && target.topicId !== undefined && post.topicId !== target.topicId) || (post.origin && target.origin && post.origin !== target.origin)) continue
      let set = answers.get(cluster)
      if (!set) { set = new Set(); answers.set(cluster, set) }
      set.add(post.id)
      const evidence = cluster.answerEvidence.get(post.id) ?? []
      evidence.push({ questionId: target.id, kind }); cluster.answerEvidence.set(post.id, evidence)
    }
  }
  const postById = new Map(sorted.map(p => [p.id, p]))
  clusters.forEach(c => { c.answerIds = [...(answers.get(c) || [])].sort((a, b) => (postById.get(b)?.likeCount || 0) - (postById.get(a)?.likeCount || 0) || postById.get(a)!.postNumber - postById.get(b)!.postNumber) })

  const repeated = clusters.filter(c => c.questionIds.length > 1).sort((a, b) => b.questionIds.length - a.questionIds.length || postById.get(a.questionIds[0])!.postNumber - postById.get(b.questionIds[0])!.postNumber)

  return {
    questions, clusters, clusterOf, repeated,
    search(query, limit = 5) {
      const list = tokens(query)
      if (!list.length) return []
      const v = vectorize(list, idf), code = errorCodes(query), pool = candidatesFor(v)
      const exact = fingerprints.get(settings.approximate ? signature(list) : exactQuestion(query))
      if (exact) pool.add(exact) // 精确指纹不被候选裁剪丢掉；最多额外一个组
      return [...pool]
        .map(cluster => ({ cluster, score: similarity(v, cluster, code) }))
        .filter(r => r.score >= SEARCH_MIN)
        .sort((a, b) => b.score - a.score || b.cluster.answerIds.length - a.cluster.answerIds.length || a.cluster.id - b.cluster.id)
        .slice(0, limit)
    },
  }
}
