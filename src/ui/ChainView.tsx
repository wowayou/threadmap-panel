import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { badgeFor, checkLink, evidenceLabel, looksLikeChainTopic, siblingsOf, tryPhrase, type ChainResult, type ChainSettings, type ChainVerdict } from '../core/chain'
import { formatReadings } from '../core/readings'
import type { AnnotateMode } from '../core/storage'
import type { Post, PostNavigation } from '../core/types'
import { useI18n } from './I18n'
import { PostLink } from './PostLink'
import { useRemembered, type ViewMemory } from './remembered'

export interface ViewProps {
  chain: ChainResult
  settings: ChainSettings
  byId: Map<number, Post>
  onSelect: (id: number) => void
  navigation: PostNavigation
  /** 主题级草稿；切换模式卸载视图后仍可恢复 */
  memory?: ViewMemory
}

export function BadgeChip({ verdict, chain }: { verdict: ChainVerdict; chain: ChainResult }) {
  const { locale } = useI18n()
  const badge = badgeFor(verdict, chain, locale)
  return <span class="tm-chip" data-tone={badge.tone === 'muted' ? undefined : badge.tone}><span aria-hidden="true">{badge.icon}</span>{badge.label}</span>
}

function Floor({ id, byId, onSelect }: { id: number; byId: Map<number, Post>; onSelect: (id: number) => void }) {
  return <button type="button" class="tm-link" onClick={() => onSelect(id)}>#{byId.get(id)?.postNumber ?? '?'}</button>
}

/** 详情里的楼层列表有界渲染：高分叉时只列前 FLOOR_LIMIT 个，并写明未列出的数量 */
const FLOOR_LIMIT = 20
function Floors({ ids, total, byId, onSelect }: { ids: number[]; total: number; byId: Map<number, Post>; onSelect: (id: number) => void }) {
  const { t } = useI18n()
  return <dd>{ids.map(id => <Floor key={id} id={id} byId={byId} onSelect={onSelect} />)}{total > ids.length && <span class="tm-note">{t('chain.floorsMore', { count: total - ids.length, total })}</span>}</dd>
}

const ruleHint = (s: ChainSettings) => !s.homophone ? 'chain.onlyWord' : s.tone ? 'chain.allowTone' : 'chain.allowSound'

/** “接龙”页。区块顺序固定：提示 → 现在该接 → 试接 → 统计 → 详情（docs/ui-spec.md §5） */
export function ChainView(props: ViewProps & {
  selected: number | null
  annotate: AnnotateMode
  focusDetail: boolean
  onFocused: () => void
  onOverride: (childId: number, parentId: number | null) => void
  onRestore: (childId: number) => void
  hasOverride: (childId: number) => boolean
  onShowIssues: () => void
  onForceAnnotate: () => void
}) {
  const { t, locale } = useI18n()
  const { chain, settings, byId, selected, annotate, onSelect, navigation, memory } = props
  const [input, setInput] = useRemembered(memory, 'chain.try', '')
  if (!chain.gamePosts) return <div class="tm-empty"><strong>{t('chain.none')}</strong>{t('chain.noneHint', { count: chain.totalPosts })}</div>

  const latest = chain.heads[0]
  const parallel = latest ? chain.heads.slice(1, 1 + settings.window).filter(head => latest.seq - head.seq < settings.window).slice(0, 3) : []
  const tried = input.trim() ? tryPhrase(input, chain, settings, 1 + parallel.length) : null
  const verdict = selected === null ? undefined : chain.verdicts.get(selected)
  const post = selected === null ? undefined : byId.get(selected)
  const breaks = chain.issues.filter(i => i.kind === 'break').length

  return <>
    {!looksLikeChainTopic(chain) && annotate === 'auto' && <div class="tm-banner" data-tone="warn"><b>{t('chain.unlikely')}</b>{t('chain.unlikelyHint', { posts: chain.gamePosts, linked: chain.linked })}<button type="button" class="tm-button" onClick={props.onForceAnnotate}>{t('chain.forceBadges')}</button></div>}
    {latest && <section class="tm-card" aria-labelledby="tm-next-title">
      <span class="tm-eyebrow" id="tm-next-title">{t('hud.next')}</span>
      <div class="tm-next">
        <div class="tm-next-char" aria-hidden="true">{latest.last.value.slice(-1)}</div>
        <div class="tm-next-info">
          <strong>#{latest.postNumber} · {byId.get(latest.postId)?.username}</strong>
          <span>{t('chain.lastSound', { phrase: latest.last.value, reading: formatReadings(latest.last.exit, locale) })}</span>
          <span>{t(ruleHint(settings))}</span>
        </div>
      </div>
      {chain.missingAfterLast ? <p class="tm-note">{t('chain.missingAfter', { count: chain.missingAfterLast })}</p> : null}
      <div class="tm-actions"><PostLink post={byId.get(latest.postId)} navigation={navigation} primary>{t('common.jump', { number: latest.postNumber })}</PostLink><button type="button" class="tm-button" onClick={() => onSelect(latest.postId)}>{t('chain.verdict')}</button></div>
      {parallel.length > 0 && <div class="tm-parallel">{t('chain.parallel', { count: parallel.length })}<ul>{parallel.map(head => <li key={head.postId}><button type="button" class="tm-pill-button" onClick={() => onSelect(head.postId)}><b>{head.last.value.slice(-1)}</b>#{head.postNumber}「{head.last.value}」</button></li>)}</ul></div>}
    </section>}

    <section class="tm-field">
      <label htmlFor="tm-try">{t('chain.try')}</label>
      <div class="tm-field-row">
        <input id="tm-try" class="tm-input" value={input} maxLength={8} autocomplete="off" placeholder={latest ? t('chain.placeholder', { char: latest.last.value.slice(-1) }) : t('chain.fourChars')} onInput={e => setInput(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Escape' && input) { e.preventDefault(); setInput('') } }} />
        {input && <button type="button" class="tm-button" onClick={() => setInput('')}>{t('common.clear')}</button>}
      </div>
      <ul class="tm-results" role="status" aria-live="polite">{tried && (!tried.phrase
        ? <li class="tm-result" data-tone="bad">{t('chain.exactlyFour')}</li>
        : <>
          {tried.matches.map(({ head, link }) => <li class="tm-result" data-tone={link ? 'ok' : 'bad'} key={head.postId}>{link
            ? t('chain.fits', { number: head.postNumber, phrase: head.last.value, evidence: evidenceLabel(link.evidence, locale), uncertain: link.uncertain && link.evidence !== 'same-word' ? t('chain.uncertainSuffix') : '' })
            : t('chain.notFit', { number: head.postNumber, phrase: head.last.value, char: tried.phrase!.value[0], reading: formatReadings(tried.phrase!.entry, locale) })}</li>)}
          {tried.repeatOf !== undefined && <li class="tm-result" data-tone="warn">{t('chain.used', { phrase: tried.phrase.value, number: tried.repeatOf })}</li>}
        </>)}</ul>
    </section>

    <div class="tm-summary"><span>{t('chain.summary', { posts: chain.gamePosts, linked: chain.linked })}{chain.unknownCount ? t('chain.unknownSuffix', { count: chain.unknownCount }) : ''}</span>{chain.issues.length ? <button type="button" class="tm-button" onClick={props.onShowIssues}>{t('chain.issueCount', { count: chain.issues.length })}{breaks ? t('chain.breakSuffix', { count: breaks }) : ''}</button> : <span class="tm-good">{t('chain.good')}</span>}</div>
    {post && <Detail {...props} post={post} verdict={verdict} />}
  </>
}

function Detail({ post, verdict, chain, settings, byId, focusDetail, onFocused, onSelect, navigation, onOverride, onRestore, hasOverride }: ViewProps & { post: Post; verdict?: ChainVerdict; focusDetail: boolean; onFocused: () => void; onOverride: (childId: number, parentId: number | null) => void; onRestore: (childId: number) => void; hasOverride: (childId: number) => boolean }) {
  const { t, format, locale } = useI18n()
  const [picking, setPicking] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (focusDetail) { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'nearest' }); onFocused() } }, [focusDetail, post.id])
  useEffect(() => setPicking(false), [post.id])
  const head = <div class="tm-detail-head"><h3 tabIndex={-1} ref={heading}>#{post.postNumber} · {post.username}</h3><PostLink post={post} navigation={navigation}>{t('chain.jumpOriginal')}</PostLink></div>
  if (!verdict) return <section class="tm-card" aria-label={t('chain.detail', { number: post.postNumber })}>{head}<p class="tm-note">{t('chain.notChain')}</p></section>

  const index = verdict.seq
  const earlier = chain.order.slice(Math.max(0, index - 12), index).filter(v => v.status !== 'excluded').reverse()
  const children = chain.childrenOf.get(post.id) || []
  return <section class="tm-card" aria-label={t('chain.detail', { number: post.postNumber })}>
    {head}
    <div class="tm-phrases">{verdict.phrases.map((p, i) => <span key={i}>{p.value}</span>)}</div>
    <BadgeChip verdict={verdict} chain={chain} />
    <p class="tm-reason">{format(verdict.reason)}</p>
    <dl class="tm-facts">
      <dt>{t('chain.firstChar')}</dt><dd>{verdict.first.value[0]} · {formatReadings(verdict.first.entry, locale)}{verdict.first.entry.length > 1 ? t('chain.polyphonic') : ''}</dd>
      <dt>{t('chain.lastChar')}</dt><dd>{verdict.last.value.slice(-1)} · {formatReadings(verdict.last.exit, locale)}{verdict.last.exit.length > 1 ? t('chain.polyphonic') : ''}</dd>
      <dt>{t('chain.readingSource')}</dt><dd>{t(verdict.first.source === 'word' ? 'chain.dictionary' : verdict.first.source === 'char' ? 'chain.character' : 'chain.noSource')}</dd>
      {verdict.parentId !== null && <><dt>{t('chain.parent')}</dt><dd><Floor id={verdict.parentId} byId={byId} onSelect={onSelect} />{verdict.skipped > 0 && verdict.status !== 'backtrack' ? t('chain.skippedHint', { count: verdict.skipped }) : ''}</dd></>}
      {verdict.siblingCount > 0 && <><dt>{t('chain.siblings')}</dt><Floors ids={siblingsOf(verdict, chain, FLOOR_LIMIT)} total={verdict.siblingCount} byId={byId} onSelect={onSelect} /></>}
      {verdict.alternativeIds.length > 0 && <><dt>{t('chain.alternatives')}</dt><dd>{verdict.alternativeIds.map(id => <Floor key={id} id={id} byId={byId} onSelect={onSelect} />)}</dd></>}
      {children.length > 0 && <><dt>{t('chain.children')}</dt><Floors ids={children.slice(0, FLOOR_LIMIT)} total={children.length} byId={byId} onSelect={onSelect} /></>}
      {post.replyToPostNumber ? <><dt>{t('chain.platformReply')}</dt><dd>#{post.replyToPostNumber}</dd></> : null}
    </dl>
    {verdict.innerBreaks.length > 0 && <div class="tm-inner">{verdict.innerBreaks.map((b, i) => <div key={i}>{t('chain.innerHint', { previous: b.previous, current: b.current, result: t(b.status === 'break' ? 'chain.cannotLink' : 'chain.ambiguousLink') })}</div>)}</div>}
    <div class="tm-correct">
      {!picking
        ? <><button type="button" class="tm-button" onClick={() => setPicking(true)}>{t('chain.assign')}</button>{verdict.status !== 'excluded' && <button type="button" class="tm-button" onClick={() => onOverride(post.id, null)}>{t('chain.exclude')}</button>}{hasOverride(post.id) && <button type="button" class="tm-button" onClick={() => onRestore(post.id)}>{t('chain.restore')}</button>}</>
        : <div class="tm-pick"><p>{t('chain.pick')}</p>{earlier.length ? <ul>{earlier.map(v => { const link = checkLink(v.last, verdict.first, settings); return <li key={v.postId}><button type="button" class="tm-pick-item" data-match={link ? 'true' : undefined} onClick={() => { onOverride(post.id, v.postId); setPicking(false) }}>#{v.postNumber}「{v.last.value}」{link ? ` · ${evidenceLabel(link.evidence, locale)}` : ''}</button></li> })}</ul> : <p class="tm-note">{t('chain.noEarlier')}</p>}<div class="tm-actions"><button type="button" class="tm-button" onClick={() => setPicking(false)}>{t('common.cancel')}</button></div></div>}
    </div>
  </section>
}
