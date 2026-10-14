import { boundaryReadings, isKnownWord } from './readings'
import type { Phrase, Post } from './types'

/** 正文里不属于作者本楼发言的部分：引用、代码、链接预览、投票、图片元信息、ThreadMap 自己的标注 */
const EXCLUDED = 'script,style,aside.quote,blockquote,pre,code,aside.onebox,.poll,.lightbox-wrapper .meta,.threadmap-badge'
const BLOCK = /^(P|DIV|LI|BR|H[1-6]|TR|TD|TH|DETAILS|SUMMARY)$/

export function htmlToText(input: string): string {
  if (!input) return ''
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(input, 'text/html')
    doc.querySelectorAll(EXCLUDED).forEach(node => node.remove())
    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
      if (node.nodeType !== Node.ELEMENT_NODE) return ''
      const el = node as HTMLElement
      const block = BLOCK.test(el.tagName)
      return (block ? '\n' : '') + [...el.childNodes].map(walk).join('') + (block ? '\n' : '')
    }
    return walk(doc.body).replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
  }
  return input
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<aside[^>]*class=["'][^"']*(quote|onebox)[^"']*["'][\s\S]*?<\/aside>|<blockquote[\s\S]*?<\/blockquote>|<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/gi, '')
    .replace(/<[^>]+>/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
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

const cache = new Map<string, Phrase[]>()

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
    const previous = phrases.at(-1)
    if (candidate.kind === 'piece' && previous && !looseLink(previous.value, candidate.value)) continue
    phrases.push({ value: candidate.value, ...boundaryReadings(candidate.value) })
  }
  // 按文本缓存；上限按“一个超长主题的帖子数”设定，超过才整体清空
  if (cache.size > 50000) cache.clear()
  cache.set(text, phrases)
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

/** 部分观察（如 DOM）合并进更完整的记录时，不能抹掉已知事实 */
export function mergePost(existing: Post | undefined, incoming: Post): Post {
  if (!existing) return incoming
  const merged = { ...existing, ...incoming }
  if (incoming.replyToPostNumber === undefined && existing.replyToPostNumber !== undefined) merged.replyToPostNumber = existing.replyToPostNumber
  if (!incoming.createdAt && existing.createdAt) merged.createdAt = existing.createdAt
  if (!incoming.raw && existing.raw) merged.raw = existing.raw
  if (!incoming.text && existing.text) merged.text = existing.text
  if (!incoming.origin && existing.origin) merged.origin = existing.origin
  if (incoming.topicId === undefined && existing.topicId !== undefined) merged.topicId = existing.topicId
  if (incoming.likeCount === undefined && existing.likeCount !== undefined) merged.likeCount = existing.likeCount
  return merged
}

function samePost(a: Post, b: Post) {
  return a.id === b.id && a.postNumber === b.postNumber && a.text === b.text && a.username === b.username && a.replyToPostNumber === b.replyToPostNumber && a.createdAt === b.createdAt && a.likeCount === b.likeCount
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
