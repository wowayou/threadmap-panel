import { boundaryReadings, isKnownWord } from './readings'
import type { Phrase, Post } from './types'

/**
 * 正文里不属于作者本楼发言的部分：引用、代码、链接预览、投票、图片元信息。
 * ThreadMap 自己的标注在读取 DOM 时已按归属标记去掉（host/owner.ts）；正文里自带的同名类当普通内容处理。
 */
const EXCLUDED = 'script,style,aside.quote,blockquote,pre,code,aside.onebox,.poll,.lightbox-wrapper .meta'
const BLOCK = /^(P|DIV|LI|BR|H[1-6]|TR|TD|TH|DETAILS|SUMMARY)$/
/** 本项目的单楼处理预算（字符串长度按 UTF-16 代码单元计），不是论坛的正文上限。 */
export const MAX_COOKED = 200_000
export const MAX_NODES = 50_000
export const MAX_TEXT = 20_000

/**
 * 只返回完整的纯文本；超过任一预算则抛出 RangeError，不返回截断前缀。
 * 外部帖子由 parsePost 捕获并拒绝，避免截断改变接龙末词或问答含义。
 */
export function htmlToText(input: string): string {
  if (input.length > MAX_COOKED) throw new RangeError('正文 HTML 超过处理上限')
  if (!input) return ''
  let text = '', pending = '', pendingLength = 0, last = ''
  // 流式折叠空白并推迟尾部空白：恰好 MAX_TEXT 的正文不会因块级换行被误拒。
  // pending 只保存可能放得下的空白；超长尾部可丢弃，中间空白则在下一字符处报超限。
  const append = (value: string) => {
    for (let i = 0; i < value.length; i++) {
      const char = value[i] === '\t' ? ' ' : value[i]
      if ((char === ' ' || char === '\n') && last === char) continue
      last = char
      if (/\s/u.test(char)) {
        if (text) {
          pendingLength++
          if (text.length + pendingLength < MAX_TEXT) pending += char
        }
        continue
      }
      if (text.length + pendingLength + 1 > MAX_TEXT) throw new RangeError('正文文本超过处理上限')
      text += pending + char
      pending = ''; pendingLength = 0
    }
  }
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(input, 'text/html')
    // 每层只调度下一个兄弟节点，不一次收集整棵宽树；结束事件保留块级边界。
    const stack: { node: Node; end?: boolean }[] = doc.body.firstChild ? [{ node: doc.body.firstChild }] : []
    let visited = 0
    while (stack.length) {
      const { node, end } = stack.pop()!
      if (end) { append('\n'); continue }
      if (++visited > MAX_NODES) throw new RangeError('正文节点超过处理上限')
      if (node.nextSibling) stack.push({ node: node.nextSibling })
      if (node.nodeType === 3) { append(node.textContent || ''); continue }
      if (node.nodeType !== 1 || (node as Element).matches(EXCLUDED)) continue
      if (BLOCK.test((node as Element).tagName)) { append('\n'); stack.push({ node, end: true }) }
      if (node.firstChild) stack.push({ node: node.firstChild })
    }
  } else {
    // 非浏览器分支同样受输入/输出预算约束；不把结果作为 HTML 执行。
    append(input
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<aside[^>]*class=["'][^"']*(quote|onebox)[^"']*["'][\s\S]*?<\/aside>|<blockquote[\s\S]*?<\/blockquote>|<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/gi, '')
      .replace(/<[^>]+>/g, '\n'))
  }
  return text
}

const HAN4 = /^[\u3400-\u9fff]{4}$/u
const HAN_RUN = /[\u3400-\u9fff]+/gu
/** 强分隔：换行、句末标点、空白。整段恰好四个汉字即为短句。 */
const STRONG = /[\n。！？!?；;\s\u3000]+/u
/** 弱分隔：逗号、顿号等。只在“全是四字词的列表”里拆分，避免把普通长句切出四字片段。 */
const WEAK = /[，,、/|·~～—-]+/u
const WRAPPERS = /^[「『“"'‘【\[（(《<]+|[」』”"'’】\]）)》>,，、.。~～…]+$/gu

/** 宽松承接（同字或同音，不看声调）：只用来判断一段文字是不是同一串接龙，不代表规则判断 */
function looseLink(a: string, b: string) {
  if (a.slice(-1) === b[0]) return true
  const exit = boundaryReadings(a).exit, entry = boundaryReadings(b).entry
  return exit.some(x => entry.some(y => x.pinyin === y.pinyin))
}

type Candidate = { value: string; kind: 'line' | 'list' | 'piece' }

function candidates(text: string): Candidate[] {
  const out: Candidate[] = []
  for (const raw of text.split(STRONG)) {
    const segment = raw.replace(WRAPPERS, '')
    if (!segment) continue
    // 1. 整段四字：「一心一意」、一心一意！
    if (HAN4.test(segment)) { out.push({ value: segment, kind: 'line' }); continue }
    // 2. 逗号分隔的四字列表：人仰马翻，翻天覆地，低声下气，气冲斗牛
    const parts = segment.split(WEAK).map(part => part.replace(WRAPPERS, '')).filter(Boolean)
    if (parts.length > 1 && parts.every(part => HAN4.test(part))) {
      const chained = parts.every((part, i) => i === 0 || looseLink(parts[i - 1], part))
      const known = parts.filter(isKnownWord).length
      if (chained || known * 2 > parts.length) { parts.forEach(value => out.push({ value, kind: 'list' })); continue }
    }
    // 3. 与英文、表情、其他文字混排时，只认词典里的四字词：名扬四海sogasoga
    for (const run of segment.match(HAN_RUN) || []) if (run.length === 4 && isKnownWord(run)) out.push({ value: run, kind: 'piece' })
  }
  return out
}

/**
 * 按文本缓存词组：同一主题重算接龙时命中。键就是整段正文，所以同时按条数和字符预算限制，
 * 超出时按写入顺序淘汰最早的；离开主题时由 clearPhraseCache 整体释放，不跨主题保留全文。
 */
export const PHRASE_CACHE = { entries: 50_000, chars: 2_000_000 } as const
const cache = new Map<string, Phrase[]>()
let cachedChars = 0
export function clearPhraseCache() { cache.clear(); cachedChars = 0 }
export const phraseCacheSize = () => ({ entries: cache.size, chars: cachedChars })
function remember(text: string, phrases: Phrase[]) {
  if (text.length > PHRASE_CACHE.chars) return
  cache.set(text, phrases); cachedChars += text.length
  for (const key of cache.keys()) {
    if (cache.size <= PHRASE_CACHE.entries && cachedChars <= PHRASE_CACHE.chars) break
    cache.delete(key); cachedChars -= key.length
  }
}

/**
 * 提取一楼里参与接龙的四字短句，按出现顺序。
 * 混排里认出的词典词（第 3 类）只有在作为第一个短句、或能宽松接上前一个短句时才保留，
 * 这样“海纳百川\n接得很点题嘛”“名扬四海sogasoga，原来如此”只取真正接龙的那一个。
 */
export function extractPhrases(text: string): Phrase[] {
  const cached = cache.get(text)
  if (cached) return cached
  const phrases: Phrase[] = []
  for (const candidate of candidates(text)) {
    const previous = phrases[phrases.length - 1]
    if (candidate.kind === 'piece' && previous && !looseLink(previous.value, candidate.value)) continue
    phrases.push({ value: candidate.value, ...boundaryReadings(candidate.value) })
  }
  remember(text, phrases)
  return phrases
}

type PostInput = Partial<Post> & { id: number; post_number?: number; cooked?: string; raw?: string; username?: string; created_at?: string; reply_to_post_number?: number | null; like_count?: unknown }

export function normalizePost(input: PostInput): Post {
  const raw = input.raw || input.cooked || ''
  const hasCamel = Object.prototype.hasOwnProperty.call(input, 'replyToPostNumber')
  const hasReply = hasCamel || Object.prototype.hasOwnProperty.call(input, 'reply_to_post_number')
  const replyToPostNumber = hasCamel ? input.replyToPostNumber : input.reply_to_post_number
  return {
    id: input.id,
    postNumber: input.postNumber ?? input.post_number ?? input.id,
    username: input.username || '未知用户',
    createdAt: input.createdAt || input.created_at || '',
    raw,
    text: input.text || htmlToText(raw),
    ...(hasReply ? { replyToPostNumber: replyToPostNumber ?? null } : {}),
    origin: input.origin,
    topicId: input.topicId,
    ...(likes(input.likeCount ?? input.like_count) !== undefined ? { likeCount: likes(input.likeCount ?? input.like_count) } : {}),
  }
}

const likes = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined

/**
 * 部分观察（如 DOM）合并进更完整的记录时，不能抹掉已知事实。
 * 正文只在本次观测没带正文（bodyMissing）时沿用旧值；平台明确给出的空正文是新事实，必须替换旧正文。
 */
export function mergePost(existing: Post | undefined, incoming: Post): Post {
  if (!existing) return incoming
  const merged = { ...existing, ...incoming }
  if (incoming.replyToPostNumber === undefined && existing.replyToPostNumber !== undefined) merged.replyToPostNumber = existing.replyToPostNumber
  if (!incoming.createdAt && existing.createdAt) merged.createdAt = existing.createdAt
  // 正文观测状态只由本次输入决定：缺失时沿用旧正文及其状态；带来正文时清除旧的缺失标记。
  if (incoming.bodyMissing) {
    merged.raw = existing.raw; merged.text = existing.text
    if (!existing.bodyMissing) delete merged.bodyMissing
  } else delete merged.bodyMissing
  if (!incoming.origin && existing.origin) merged.origin = existing.origin
  if (incoming.topicId === undefined && existing.topicId !== undefined) merged.topicId = existing.topicId
  if (incoming.likeCount === undefined && existing.likeCount !== undefined) merged.likeCount = existing.likeCount
  return merged
}

export function samePost(a: Post, b: Post) {
  return a.id === b.id && a.postNumber === b.postNumber && a.text === b.text && a.raw === b.raw && a.origin === b.origin && a.topicId === b.topicId && a.username === b.username && a.replyToPostNumber === b.replyToPostNumber && a.createdAt === b.createdAt && a.likeCount === b.likeCount && a.bodyMissing === b.bodyMissing
}

/** 合并后按楼层排序。内容没变的帖子保留原对象，内容都没变时返回原数组，便于下游缓存。 */
export function mergePosts(current: Post[], incoming: Post[]): Post[] {
  const map = new Map(current.map(post => [post.id, post]))
  let changed = false
  for (const post of incoming) {
    const before = map.get(post.id)
    const after = mergePost(before, post)
    if (!before || !samePost(before, after)) { map.set(post.id, after); changed = true }
  }
  return changed ? [...map.values()].sort((a, b) => a.postNumber - b.postNumber) : current
}
