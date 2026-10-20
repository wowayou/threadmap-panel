import { formatText, i18n, message, type Locale, type Message, type Text } from '../i18n'
import { extractPhrases } from './phrases'
import type { Evidence, Override, Phrase, Post, Reading } from './types'

/**
 * 链头模型（chain-head model）
 *
 * 接龙是按楼层推进的状态机：新帖首字只和“仍在等人接”的链头比对，
 * 而不是和全部历史比对，旧帖末字碰巧相同不会制造歧义。
 *
 * 父楼选择顺序：
 *   1. 平台 Reply 指向的接龙帖（且符合规则）—— 作者显式意图
 *   2. 最近 window 个接龙帖：未被接走的优先，其次证据强，其次更近
 *   3. 更早的接龙帖 —— 标为“回溯”，放进问题列表供核对
 *   4. 都接不上 —— 断链（首个接龙帖为开局）
 *
 * 数据缺口：若相关范围内有未载入的楼，结论降级为“前文未载入”，不报断链或开局。
 */

export type ChainStatus = 'start' | 'continue' | 'fork' | 'backtrack' | 'pending' | 'break' | 'unknown' | 'manual' | 'excluded'
export type IssueKind = 'break' | 'fork' | 'pending' | 'backtrack' | 'repeat' | 'inner'

export interface ChainSettings { homophone: boolean; tone: boolean; window: number }
export const defaultChainSettings: ChainSettings = { homophone: true, tone: true, window: 8 }

export interface ChainVerdict {
  /** 在 order 中的位置，供界面 O(1) 计算距离 */
  seq: number
  postId: number
  postNumber: number
  status: ChainStatus
  phrases: Phrase[]
  first: Phrase
  last: Phrase
  parentId: number | null
  evidence?: Evidence
  /** 父楼由平台 Reply 指定 */
  viaReply: boolean
  /** 父楼与本楼之间被跳过的已载入接龙帖数量 */
  skipped: number
  /** 父楼与本楼之间未载入的楼数（可能藏着更近的父楼） */
  missingBetween: number
  /**
   * 同一父楼下更早的承接者（分叉）数量。它们就是 childrenOf.get(parentId) 的前 siblingCount 项；
   * 不再每楼复制一份兄弟数组，避免同父楼高分叉时 n² 的内存（见 siblingsOf）。
   */
  siblingCount: number
  /** 证据同样强、但未被选中的其他候选 */
  alternativeIds: number[]
  /** 词组在更早楼层出现过：最早的楼层号（本楼内重复时等于本楼） */
  repeatOf?: number
  innerBreaks: { previous: string; current: string; status: 'break' | 'ambiguous' }[]
  reason: Message[]
}

export interface ChainIssue { kind: IssueKind; postId: number; postNumber: number; text: Message[] }

/** 主题的已知楼层范围：stream 是平台给出的完整帖子 ID 顺序（可能比已载入的多） */
export interface TopicScope { stream?: number[]; totalCount?: number }

export interface ChainResult {
  verdicts: Map<number, ChainVerdict>
  /** 接龙帖，按楼层排序 */
  order: ChainVerdict[]
  childrenOf: Map<number, number[]>
  /** 尚无承接的接龙帖，最近的在前 */
  heads: ChainVerdict[]
  issues: ChainIssue[]
  gamePosts: number
  linked: number
  totalPosts: number
  /** 已知未载入的楼数；undefined 表示总量未知 */
  missing?: number
  /** 最后一个已载入楼之后还有多少楼未载入 */
  missingAfterLast?: number
  /** 结论因缺楼而降级的接龙帖数量 */
  unknownCount: number
}

/** 回溯时每个读音最多检查的更早帖子数，保证最坏情况下也有界 */
const BACKTRACK_SCAN = 3000
/** 分叉理由里列出的兄弟楼上限；完整数量始终写明，详情可逐楼查看 */
const REASON_SIBLINGS = 5

/** 某个分叉楼之前已接同一父楼的楼（楼层序），最多取 limit 个 */
export function siblingsOf(verdict: ChainVerdict, chain: Pick<ChainResult, 'childrenOf'>, limit = Infinity): number[] {
  if (verdict.parentId === null || !verdict.siblingCount) return []
  return (chain.childrenOf.get(verdict.parentId) || []).slice(0, Math.min(verdict.siblingCount, limit))
}

const rank: Record<Evidence, number> = { 'same-word': 3, 'same-sound-tone': 2, 'same-sound-different-tone': 1 }

const evidenceMessage = (evidence: Evidence) => message(evidence === 'same-word' ? 'chain.sameWord' : evidence === 'same-sound-tone' ? 'chain.sameTone' : 'chain.differentTone')
export function evidenceLabel(evidence?: Evidence, locale: Locale = 'zh-CN'): string {
  return evidence ? formatText(locale, evidenceMessage(evidence)) : ''
}

export interface LinkCheck { evidence: Evidence; uncertain: boolean }

/** 父词组末字能否接子词组首字。uncertain：结论依赖多音字中的某一个读音。 */
export function checkLink(parent: Phrase, child: Phrase, settings: Pick<ChainSettings, 'homophone' | 'tone'>): LinkCheck | null {
  if (parent.value.slice(-1) === child.value.slice(0, 1)) return { evidence: 'same-word', uncertain: false }
  if (!settings.homophone) return null
  const pairs = parent.exit.flatMap(a => child.entry.map(b => [a, b] as [Reading, Reading])).filter(([a, b]) => a.pinyin === b.pinyin)
  if (!pairs.length) return null
  const uncertain = parent.exit.length > 1 || child.entry.length > 1
  if (pairs.some(([a, b]) => a.tone === b.tone)) return { evidence: 'same-sound-tone', uncertain }
  if (settings.tone) return null
  return { evidence: 'same-sound-different-tone', uncertain }
}

/** 统计两个楼之间（不含两端）有多少未载入的楼 */
function gapCounter(sorted: Post[], scope: TopicScope) {
  const loaded = new Set(sorted.map(post => post.id))
  if (scope.stream?.length) {
    const position = new Map(scope.stream.map((id, index) => [id, index]))
    // prefix[i] = stream[0..i) 中未载入的数量
    const prefix = [0]
    scope.stream.forEach((id, index) => prefix.push(prefix[index] + (loaded.has(id) ? 0 : 1)))
    const at = (post: Post | null, end: boolean) => post === null ? (end ? scope.stream!.length : 0) : position.get(post.id)
    return {
      between: (a: Post | null, b: Post | null) => {
        const from = at(a, false), to = at(b, true)
        if (from === undefined || to === undefined) return 0
        return Math.max(0, prefix[to] - prefix[a === null ? 0 : from + 1])
      },
      total: prefix[prefix.length - 1],
    }
  }
  // 没有 stream 时只能用楼层号估计：楼层号不连续可能是未载入，也可能是已删除
  const last = sorted[sorted.length - 1]?.postNumber ?? 0
  const numbers = sorted.map(post => post.postNumber)
  const lowerBound = (x: number) => { let lo = 0, hi = numbers.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (numbers[mid] < x) lo = mid + 1; else hi = mid } return lo }
  return {
    between: (a: Post | null, b: Post | null) => {
      const from = a?.postNumber ?? 0
      const to = b?.postNumber ?? (scope.totalCount ?? last) + 1
      const loadedInside = lowerBound(to) - lowerBound(from + 1)
      return Math.max(0, to - from - 1 - loadedInside)
    },
    total: scope.totalCount === undefined ? undefined : Math.max(0, scope.totalCount - sorted.length),
  }
}

export function buildChain(posts: Post[], settings: ChainSettings = defaultChainSettings, overrides: Override[] = [], scope: TopicScope = {}): ChainResult {
  const sorted = [...posts].sort((a, b) => a.postNumber - b.postNumber)
  const byNumber = new Map(sorted.map(post => [post.postNumber, post]))
  const postById = new Map(sorted.map(post => [post.id, post]))
  const gaps = gapCounter(sorted, scope)
  const overrideFor = new Map(overrides.map(o => [`${o.origin}:${o.topicId}:${o.childId}`, o]))
  const verdicts = new Map<number, ChainVerdict>()
  const order: ChainVerdict[] = []
  const active: ChainVerdict[] = []
  /** 性能：位置索引与按末字/末字读音的倒排，避免逐个扫描历史（见 tests/perf.test.ts） */
  const activeIndex = new Map<number, number>()
  const byExitChar = new Map<string, ChainVerdict[]>()
  const byExitPinyin = new Map<string, ChainVerdict[]>()
  const bucket = (map: Map<string, ChainVerdict[]>, key: string, v: ChainVerdict) => { const list = map.get(key); if (list) list.push(v); else map.set(key, [v]) }
  const childrenOf = new Map<number, number[]>()
  const firstUse = new Map<string, number>()
  const window = Math.max(1, settings.window)

  for (const post of sorted) {
    const phrases = extractPhrases(post.text)
    if (!phrases.length) continue
    const first = phrases[0], last = phrases[phrases.length - 1]
    const verdict: ChainVerdict = { seq: 0, postId: post.id, postNumber: post.postNumber, status: 'start', phrases, first, last, parentId: null, viaReply: false, skipped: 0, missingBetween: 0, siblingCount: 0, alternativeIds: [], innerBreaks: [], reason: [] }

    for (let i = 1; i < phrases.length; i++) {
      const link = checkLink(phrases[i - 1], phrases[i], settings)
      if (!link) verdict.innerBreaks.push({ previous: phrases[i - 1].value, current: phrases[i].value, status: 'break' })
      else if (link.uncertain && link.evidence !== 'same-word') verdict.innerBreaks.push({ previous: phrases[i - 1].value, current: phrases[i].value, status: 'ambiguous' })
    }
    const seen = new Set<string>()
    for (const phrase of phrases) {
      const earlier = firstUse.get(phrase.value)
      if (verdict.repeatOf === undefined && (earlier !== undefined || seen.has(phrase.value))) verdict.repeatOf = earlier ?? post.postNumber
      seen.add(phrase.value)
      if (!firstUse.has(phrase.value)) firstUse.set(phrase.value, post.postNumber)
    }

    const adopt = (parent: ChainVerdict | null) => {
      verdict.seq = order.length
      verdicts.set(post.id, verdict); order.push(verdict)
      if (verdict.status !== 'excluded') {
        activeIndex.set(post.id, active.length); active.push(verdict)
        bucket(byExitChar, verdict.last.value.slice(-1), verdict)
        new Set(verdict.last.exit.map(r => r.pinyin)).forEach(p => bucket(byExitPinyin, p, verdict))
      }
      if (parent) {
        verdict.parentId = parent.postId
        const list = childrenOf.get(parent.postId) || []
        list.push(post.id); childrenOf.set(parent.postId, list)
      }
    }
    const postOf = (v: ChainVerdict) => postById.get(v.postId)!

    const override = overrideFor.get(`${post.origin || 'demo'}:${post.topicId || 0}:${post.id}`)
    if (override) {
      if (override.parentId === null) { verdict.status = 'excluded'; verdict.reason = [message('reason.excluded')]; adopt(null); continue }
      const parent = verdicts.get(override.parentId)
      if (parent && parent.status !== 'excluded' && parent.postNumber < post.postNumber) {
        verdict.status = 'manual'
        verdict.skipped = active.length - 1 - activeIndex.get(parent.postId)!
        verdict.siblingCount = childrenOf.get(parent.postId)?.length ?? 0
        verdict.reason = [message('reason.manual', { number: parent.postNumber })]
        adopt(parent); continue
      }
      verdict.reason.push(message('reason.staleOverride'))
    }

    if (!active.length) {
      const before = gaps.between(null, post)
      verdict.status = before ? 'unknown' : 'start'
      verdict.reason.push(before ? message('reason.missingBefore', { count: before }) : message('reason.start'))
      adopt(null); continue
    }

    type Candidate = { parent: ChainVerdict; link: LinkCheck; age: number }
    const consider = (parent: ChainVerdict, age: number): Candidate | null => {
      const link = checkLink(parent.last, first, settings)
      return link ? { parent, link, age } : null
    }

    let chosen: Candidate | null = null
    let alternatives: Candidate[] = []
    let backtrack = false

    if (post.replyToPostNumber) {
      const target = byNumber.get(post.replyToPostNumber)
      const parent = target ? verdicts.get(target.id) : undefined
      if (parent && parent.status !== 'excluded') {
        chosen = consider(parent, active.length - 1 - activeIndex.get(parent.postId)!)
        verdict.viaReply = !!chosen
      }
    }

    if (!chosen) {
      const recent = active.slice(-window).reverse()
      const candidates = recent.map((parent, age) => consider(parent, age)).filter((c): c is Candidate => !!c)
      if (candidates.length) {
        const free = (c: Candidate) => !childrenOf.has(c.parent.postId)
        candidates.sort((a, b) => Number(free(b)) - Number(free(a)) || rank[b.link.evidence] - rank[a.link.evidence] || a.age - b.age)
        chosen = candidates[0]
        alternatives = candidates.slice(1).filter(c => free(c) === free(chosen!) && c.link.evidence === chosen!.link.evidence)
      }
    }

    // 窗口最早一楼到本楼之间若有未载入的楼，窗口外的“回溯”和“断链”都不可信
    const windowStart = active[Math.max(0, active.length - window)]
    const missingInWindow = gaps.between(postOf(windowStart), post)

    // 窗口外回溯：只看末字相同、或末字读音与本楼首字读音相同的更早帖子，取最近的一个能接上的
    if (!chosen) {
      const cutoff = active.length - window
      const latestOlder = (list: ChainVerdict[] | undefined) => {
        if (!list) return null
        for (let i = list.length - 1, scanned = 0; i >= 0 && scanned < BACKTRACK_SCAN; i--) {
          const idx = activeIndex.get(list[i].postId)!
          if (idx >= cutoff) continue
          scanned++
          const found = consider(list[i], active.length - 1 - idx)
          if (found) return found
        }
        return null
      }
      const options = [latestOlder(byExitChar.get(first.value[0])), ...(settings.homophone ? [...new Set(first.entry.map(r => r.pinyin))].map(p => latestOlder(byExitPinyin.get(p))) : [])]
      for (const option of options) if (option && (!chosen || option.age < chosen.age)) chosen = option
      backtrack = !!chosen
    }

    if (!chosen || (backtrack && missingInWindow)) {
      const previous = active[active.length - 1]
      if (missingInWindow) {
        verdict.status = 'unknown'
        verdict.reason.push(message('reason.missingWindow', { count: missingInWindow }))
      } else {
        verdict.status = 'break'
        verdict.reason.push(message('reason.break', { phrase: first.value, number: previous.postNumber, previous: previous.last.value }))
      }
      adopt(null); continue
    }

    const parent = chosen.parent
    verdict.skipped = active.length - 1 - activeIndex.get(parent.postId)!
    verdict.missingBetween = gaps.between(postOf(parent), post)
    const earlierChildren = childrenOf.get(parent.postId) || []
    verdict.siblingCount = earlierChildren.length
    verdict.alternativeIds = alternatives.map(c => c.parent.postId)
    verdict.evidence = chosen.link.evidence
    const uncertain = chosen.link.uncertain && chosen.link.evidence !== 'same-word'
    verdict.status = uncertain ? 'pending' : backtrack ? 'backtrack' : verdict.siblingCount ? 'fork' : 'continue'
    const link = message('reason.link', { evidence: evidenceMessage(chosen.link.evidence), number: parent.postNumber, phrase: parent.last.value, reply: verdict.viaReply ? message('reason.reply') : '' })
    let siblings: Text = ''
    if (verdict.status === 'fork') {
      const list = earlierChildren.slice(0, REASON_SIBLINGS).map(id => '#' + verdicts.get(id)?.postNumber).join(', ')
      siblings = verdict.siblingCount > REASON_SIBLINGS ? message('reason.siblingsMore', { list, count: verdict.siblingCount }) : list
    }
    verdict.reason.push(verdict.status === 'pending' ? message('reason.pending', { link })
      : verdict.status === 'backtrack' ? message('reason.backtrack', { link, count: verdict.skipped })
      : verdict.status === 'fork' ? message('reason.fork', { link, siblings })
      : message('reason.continue', { link }))
    if (verdict.missingBetween) verdict.reason.push(message('reason.missingBetween', { count: verdict.missingBetween }))
    adopt(parent)
  }

  const heads = active.filter(v => !childrenOf.has(v.postId)).reverse()
  const issues: ChainIssue[] = []
  for (const v of order) {
    const push = (kind: IssueKind, text: Message[]) => issues.push({ kind, postId: v.postId, postNumber: v.postNumber, text })
    if (v.status === 'break' || v.status === 'fork' || v.status === 'pending' || v.status === 'backtrack') push(v.status, v.reason)
    if (v.repeatOf !== undefined) push('repeat', [v.repeatOf === v.postNumber ? message('reason.repeatHere') : message('reason.repeat', { number: v.repeatOf })])
    v.innerBreaks.forEach(b => push('inner', [message('reason.inner', { previous: b.previous, current: b.current, result: message(b.status === 'break' ? 'chain.cannotLink' : 'reason.ambiguous') })]))
  }
  const lastPost = sorted[sorted.length - 1] ?? null
  return {
    verdicts, order, childrenOf, heads, issues,
    gamePosts: order.length,
    linked: order.filter(v => v.parentId !== null).length,
    totalPosts: sorted.length,
    missing: gaps.total,
    missingAfterLast: lastPost && (scope.stream?.length || scope.totalCount !== undefined) ? gaps.between(lastPost, null) : undefined,
    unknownCount: order.filter(v => v.status === 'unknown').length,
  }
}

/** 用户想发的词组能接哪些链头、是否用过。只做本地检查。 */
export function tryPhrase(input: string, chain: ChainResult, settings: ChainSettings, headLimit = 4) {
  const phrase = extractPhrases(input.trim()).find(p => p.value === input.trim())
  const matches = phrase ? chain.heads.slice(0, headLimit).map(head => ({ head, link: checkLink(head.last, phrase, settings) })) : []
  const repeatOf = phrase ? chain.order.find(v => v.phrases.some(p => p.value === phrase.value))?.postNumber : undefined
  return { phrase, matches, repeatOf }
}

/** 至少 3 个接龙帖且实际接上 2 次才视为接龙主题，避免普通讨论里零星的四字回复被误判 */
export function looksLikeChainTopic(chain: ChainResult) {
  return chain.gamePosts >= 3 && chain.linked >= 2
}

export type BadgeTone = 'ok' | 'warn' | 'bad' | 'muted'
export interface Badge { icon: string; label: string; tone: BadgeTone; title: string }

export function badgeFor(verdict: ChainVerdict, chain: ChainResult, locale: Locale = 'zh-CN'): Badge {
  const { t, format } = i18n(locale)
  const number = verdict.parentId === null ? '?' : chain.verdicts.get(verdict.parentId)?.postNumber ?? '?'
  const skip = verdict.skipped > 0 && verdict.status !== 'backtrack' ? t('chainBadge.skip', { count: verdict.skipped }) : ''
  const extra = verdict.repeatOf !== undefined ? t('chainBadge.repeat') : verdict.innerBreaks.some(b => b.status === 'break') ? t('chainBadge.inner') : ''
  const okTone: BadgeTone = extra ? 'warn' : 'ok'
  const evidence = evidenceLabel(verdict.evidence, locale)
  const title = format(verdict.reason)
  switch (verdict.status) {
    case 'start': return { icon: '●', label: t('chainBadge.start', { extra }), tone: okTone, title }
    case 'continue': return { icon: '✓', label: t('chainBadge.continue', { number, evidence, skip, extra }), tone: okTone, title }
    case 'manual': return { icon: '✓', label: t('chainBadge.manual', { number, extra }), tone: okTone, title }
    case 'fork': return { icon: '⑂', label: t('chainBadge.fork', { number, extra }), tone: 'warn', title }
    case 'backtrack': return { icon: '↶', label: t('chainBadge.backtrack', { number, extra }), tone: 'warn', title }
    case 'pending': return { icon: '?', label: t('chainBadge.pending', { number, extra }), tone: 'warn', title }
    case 'break': return { icon: '✕', label: t('chainBadge.break', { extra }), tone: 'bad', title }
    case 'unknown': return { icon: '…', label: t('chainBadge.unknown', { extra }), tone: 'muted', title }
    case 'excluded': return { icon: '–', label: t('chainBadge.excluded'), tone: 'muted', title }
  }
}
