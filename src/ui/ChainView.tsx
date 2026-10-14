import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { badgeFor, checkLink, evidenceLabel, looksLikeChainTopic, tryPhrase, type ChainResult, type ChainSettings, type ChainVerdict } from '../core/chain'
import { formatReadings } from '../core/readings'
import type { AnnotateMode } from '../core/storage'
import type { Post } from '../core/types'

export interface ViewProps {
  chain: ChainResult
  settings: ChainSettings
  byId: Map<number, Post>
  onSelect: (id: number) => void
  onJump: (id: number) => void
}

export function BadgeChip({ verdict, chain }: { verdict: ChainVerdict; chain: ChainResult }) {
  const badge = badgeFor(verdict, chain)
  return <span class="tm-chip" data-tone={badge.tone === 'muted' ? undefined : badge.tone}><span aria-hidden="true">{badge.icon}</span>{badge.label}</span>
}

function Floor({ id, byId, onSelect }: { id: number; byId: Map<number, Post>; onSelect: (id: number) => void }) {
  return <button type="button" class="tm-link" onClick={() => onSelect(id)}>#{byId.get(id)?.postNumber ?? '?'}</button>
}

const ruleHint = (s: ChainSettings) => !s.homophone ? '只接受同字' : s.tone ? '同字，或同音同调' : '同字，或同音（不限声调）'

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
  const { chain, settings, byId, selected, annotate, onSelect, onJump } = props
  const [input, setInput] = useState('')
  if (!chain.gamePosts) return <div class="tm-empty"><strong>没有识别到四字接龙</strong>已载入的 {chain.totalPosts} 楼里没有四字短句。普通讨论请使用论坛自带的回复视图。</div>

  const latest = chain.heads[0]
  const parallel = latest ? chain.heads.slice(1, 1 + settings.window).filter(head => latest.seq - head.seq < settings.window).slice(0, 3) : []
  const tried = input.trim() ? tryPhrase(input, chain, settings, 1 + parallel.length) : null
  const verdict = selected === null ? undefined : chain.verdicts.get(selected)
  const post = selected === null ? undefined : byId.get(selected)
  const breaks = chain.issues.filter(i => i.kind === 'break').length

  return <>
    {!looksLikeChainTopic(chain) && annotate === 'auto' && <div class="tm-banner" data-tone="warn"><b>这个主题不太像接龙</b>只有 {chain.gamePosts} 个四字帖、{chain.linked} 处接上，所以没有在原帖上标注。<button type="button" class="tm-button" onClick={props.onForceAnnotate}>仍然标注</button></div>}

    {latest && <section class="tm-card" aria-labelledby="tm-next-title">
      <span class="tm-eyebrow" id="tm-next-title">现在该接</span>
      <div class="tm-next">
        <div class="tm-next-char" aria-hidden="true">{latest.last.value.slice(-1)}</div>
        <div class="tm-next-info">
          <strong>#{latest.postNumber} · {byId.get(latest.postId)?.username}</strong>
          <span>「{latest.last.value}」末字读 {formatReadings(latest.last.exit)}</span>
          <span>{ruleHint(settings)}</span>
        </div>
      </div>
      {chain.missingAfterLast ? <p class="tm-note">后面还有 {chain.missingAfterLast} 楼未载入，链头可能已经被接走。</p> : null}
      <div class="tm-actions"><button type="button" class="tm-button" data-variant="primary" onClick={() => onJump(latest.postId)}>跳到 #{latest.postNumber}</button><button type="button" class="tm-button" onClick={() => onSelect(latest.postId)}>查看判断</button></div>
      {parallel.length > 0 && <div class="tm-parallel">另有 {parallel.length} 条并行链也在等人接：<ul>{parallel.map(head => <li key={head.postId}><button type="button" class="tm-pill-button" onClick={() => onSelect(head.postId)}><b>{head.last.value.slice(-1)}</b>#{head.postNumber}「{head.last.value}」</button></li>)}</ul></div>}
    </section>}

    <section class="tm-field">
      <label htmlFor="tm-try">试接一个词（只在本地检查，不会发帖）</label>
      <div class="tm-field-row">
        <input id="tm-try" class="tm-input" value={input} maxLength={8} autocomplete="off" placeholder={latest ? `以“${latest.last.value.slice(-1)}”开头的四字词` : '四字词组'} onInput={e => setInput((e.currentTarget as HTMLInputElement).value)} onKeyDown={e => { if (e.key === 'Escape' && input) { e.preventDefault(); setInput('') } }} />
        {input && <button type="button" class="tm-button" onClick={() => setInput('')}>清除</button>}
      </div>
      <ul class="tm-results" role="status" aria-live="polite">{tried && (!tried.phrase
        ? <li class="tm-result" data-tone="bad">需要正好四个汉字</li>
        : <>
          {tried.matches.map(({ head, link }) => <li class="tm-result" data-tone={link ? 'ok' : 'bad'} key={head.postId}>{link
            ? `✓ 能接 #${head.postNumber}「${head.last.value}」· ${evidenceLabel(link.evidence)}${link.uncertain && link.evidence !== 'same-word' ? '（依赖多音字读音）' : ''}`
            : `✕ 接不上 #${head.postNumber}「${head.last.value}」：首字“${tried.phrase!.value[0]}”读 ${formatReadings(tried.phrase!.entry)}`}</li>)}
          {tried.repeatOf !== undefined && <li class="tm-result" data-tone="warn">⚠ 「{tried.phrase.value}」在 #{tried.repeatOf} 用过了</li>}
        </>)}</ul>
    </section>

    <div class="tm-summary"><span>{chain.gamePosts} 个接龙帖 · {chain.linked} 处接上{chain.unknownCount ? ` · ${chain.unknownCount} 处无法判断` : ''}</span>{chain.issues.length ? <button type="button" class="tm-button" onClick={props.onShowIssues}>{chain.issues.length} 个问题{breaks ? ` · 断链 ${breaks}` : ''}</button> : <span class="tm-good">没有发现问题</span>}</div>

    {post && <Detail {...props} post={post} verdict={verdict} />}
  </>
}

function Detail({ post, verdict, chain, settings, byId, focusDetail, onFocused, onSelect, onJump, onOverride, onRestore, hasOverride }: ViewProps & { post: Post; verdict?: ChainVerdict; focusDetail: boolean; onFocused: () => void; onOverride: (childId: number, parentId: number | null) => void; onRestore: (childId: number) => void; hasOverride: (childId: number) => boolean }) {
  const [picking, setPicking] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (focusDetail) { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'nearest' }); onFocused() } }, [focusDetail, post.id])
  useEffect(() => setPicking(false), [post.id])
  const head = <div class="tm-detail-head"><h3 tabIndex={-1} ref={heading}>#{post.postNumber} · {post.username}</h3><button type="button" class="tm-button" onClick={() => onJump(post.id)}>跳到原帖</button></div>
  if (!verdict) return <section class="tm-card" aria-label={`第 ${post.postNumber} 楼的判断`}>{head}<p class="tm-note">这楼不是接龙帖（没有识别到四字短句），不参与判断。</p></section>

  const index = verdict.seq
  const earlier = chain.order.slice(Math.max(0, index - 12), index).filter(v => v.status !== 'excluded').reverse()
  const children = chain.childrenOf.get(post.id) || []
  return <section class="tm-card" aria-label={`第 ${post.postNumber} 楼的判断`}>
    {head}
    <div class="tm-phrases">{verdict.phrases.map((p, i) => <span key={i}>{p.value}</span>)}</div>
    <BadgeChip verdict={verdict} chain={chain} />
    <p class="tm-reason">{verdict.reason}</p>
    <dl class="tm-facts">
      <dt>首字</dt><dd>{verdict.first.value[0]} · {formatReadings(verdict.first.entry)}{verdict.first.entry.length > 1 ? '（多音）' : ''}</dd>
      <dt>末字</dt><dd>{verdict.last.value.slice(-1)} · {formatReadings(verdict.last.exit)}{verdict.last.exit.length > 1 ? '（多音）' : ''}</dd>
      <dt>读音来源</dt><dd>{verdict.first.source === 'word' ? '成语词典' : verdict.first.source === 'char' ? '单字读音' : '无'}</dd>
      {verdict.parentId !== null && <><dt>接的是</dt><dd><Floor id={verdict.parentId} byId={byId} onSelect={onSelect} />{verdict.skipped > 0 && verdict.status !== 'backtrack' ? ` 中间隔了 ${verdict.skipped} 个接龙帖` : ''}</dd></>}
      {verdict.siblingIds.length > 0 && <><dt>同楼还有</dt><dd>{verdict.siblingIds.map(id => <Floor key={id} id={id} byId={byId} onSelect={onSelect} />)}</dd></>}
      {verdict.alternativeIds.length > 0 && <><dt>也能接</dt><dd>{verdict.alternativeIds.map(id => <Floor key={id} id={id} byId={byId} onSelect={onSelect} />)}</dd></>}
      {children.length > 0 && <><dt>被接</dt><dd>{children.map(id => <Floor key={id} id={id} byId={byId} onSelect={onSelect} />)}</dd></>}
      {post.replyToPostNumber ? <><dt>平台回复</dt><dd>#{post.replyToPostNumber}</dd></> : null}
    </dl>
    {verdict.innerBreaks.length > 0 && <div class="tm-inner">{verdict.innerBreaks.map((b, i) => <div key={i}>帖内「{b.previous}」→「{b.current}」{b.status === 'break' ? '接不上' : '依赖多音字'}</div>)}</div>}
    <div class="tm-correct">
      {!picking
        ? <><button type="button" class="tm-button" onClick={() => setPicking(true)}>手动指定</button>{verdict.status !== 'excluded' && <button type="button" class="tm-button" onClick={() => onOverride(post.id, null)}>不算接龙</button>}{hasOverride(post.id) && <button type="button" class="tm-button" onClick={() => onRestore(post.id)}>恢复自动</button>}</>
        : <div class="tm-pick"><p>它接的是哪一楼？</p>{earlier.length ? <ul>{earlier.map(v => { const link = checkLink(v.last, verdict.first, settings); return <li key={v.postId}><button type="button" class="tm-pick-item" data-match={link ? 'true' : undefined} onClick={() => { onOverride(post.id, v.postId); setPicking(false) }}>#{v.postNumber}「{v.last.value}」{link ? ` · ${evidenceLabel(link.evidence)}` : ''}</button></li> })}</ul> : <p class="tm-note">前面没有接龙帖。</p>}<div class="tm-actions"><button type="button" class="tm-button" onClick={() => setPicking(false)}>取消</button></div></div>}
    </div>
  </section>
}
