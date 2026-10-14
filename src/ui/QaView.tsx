import { h } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { QaResult, QuestionCluster } from '../core/questions'
import type { Post } from '../core/types'

const PAGE = 20
const excerpt = (text: string, max = 60) => text.length > max ? `${text.slice(0, max)}…` : text

interface Props {
  qa: QaResult
  byId: Map<number, Post>
  selected: number | null
  focusDetail: boolean
  onFocused: () => void
  onSelect: (id: number) => void
  onJump: (id: number) => void
  missing: number
}

/** 问答页：先查再问 → 选中楼所在的问题组 → 重复问题列表（docs/ui-spec.md §5） */
export function QaView({ qa, byId, selected, focusDetail, onFocused, onSelect, onJump, missing }: Props) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const results = query.trim() ? qa.search(query) : []
  const current = selected === null ? undefined : qa.clusterOf.get(selected)
  const pages = Math.max(1, Math.ceil(qa.repeated.length / PAGE))
  const pageIndex = Math.min(page, pages - 1)

  return <>
    <section class="tm-field">
      <label htmlFor="tm-ask">想问什么？先在本帖里查一下（只在本地检查）</label>
      <div class="tm-field-row">
        <input id="tm-ask" class="tm-input" value={query} maxLength={120} autocomplete="off" placeholder="例如：脚本怎么安装" onInput={e => setQuery((e.currentTarget as HTMLInputElement).value)} onKeyDown={e => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery('') } }} />
        {query && <button type="button" class="tm-button" onClick={() => setQuery('')}>清除</button>}
      </div>
      <ul class="tm-results" role="status" aria-live="polite">
        {query.trim() && !results.length && <li class="tm-result">已载入的楼层里没有找到相似的提问{missing ? `（还有 ${missing} 楼未载入）` : ''}。</li>}
        {results.map(({ cluster }) => <li class="tm-result" data-tone={cluster.answerIds.length ? 'ok' : undefined} key={cluster.id}>
          #{byId.get(cluster.questionIds[0])?.postNumber} 问过 {cluster.questionIds.length} 次 · {cluster.answerIds.length ? `${cluster.answerIds.length} 条回答` : '没有明确回答'}：{excerpt(cluster.text, 40)}{' '}
          <button type="button" class="tm-link" onClick={() => onSelect(cluster.questionIds[0])}>查看</button>
        </li>)}
      </ul>
    </section>

    {current && <ClusterCard cluster={current} byId={byId} focus={focusDetail} onFocused={onFocused} onJump={onJump} selectedId={selected} />}

    <div class="tm-summary"><span>{qa.questions.size} 楼在提问 · {qa.repeated.length} 个问题被重复问过</span></div>

    {qa.repeated.length
      ? <ul class="tm-issues">{qa.repeated.slice(pageIndex * PAGE, (pageIndex + 1) * PAGE).map(cluster => {
          const first = byId.get(cluster.questionIds[0])
          return <li class="tm-issue" data-kind="repeat" key={cluster.id}>
            <div class="tm-issue-main"><span class="tm-kind">问过 {cluster.questionIds.length} 次</span><b>#{first?.postNumber} {first?.username}</b><p>{excerpt(cluster.text)}</p></div>
            <div class="tm-issue-actions">
              <button type="button" class="tm-button" aria-label={`查看第 ${first?.postNumber} 楼的问题组`} onClick={() => onSelect(cluster.questionIds[0])}>查看</button>
              {cluster.answerIds.length ? <button type="button" class="tm-button" aria-label={`跳到第 ${byId.get(cluster.answerIds[0])?.postNumber} 楼的回答`} onClick={() => onJump(cluster.answerIds[0])}>回答</button> : null}
            </div>
          </li>
        })}</ul>
      : <div class="tm-empty"><strong>没有发现重复提问</strong>已载入的楼层里，每个问题都只被问过一次。</div>}
    {pages > 1 && <nav class="tm-pager" aria-label="问题分页"><button type="button" class="tm-button" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>上一页</button><span>{pageIndex + 1} / {pages}</span><button type="button" class="tm-button" disabled={pageIndex >= pages - 1} onClick={() => setPage(pageIndex + 1)}>下一页</button></nav>}
    <p class="tm-note">按字面相似度归组：意思相同但用词不同的问题可能认不出来，也可能把不相关的问题归在一起。回答只算明确回复或引用了提问的楼，按点赞排序。</p>
  </>
}

function ClusterCard({ cluster, byId, focus, onFocused, onJump, selectedId }: { cluster: QuestionCluster; byId: Map<number, Post>; focus: boolean; onFocused: () => void; onJump: (id: number) => void; selectedId: number | null }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (focus) { heading.current?.focus(); heading.current?.scrollIntoView({ block: 'nearest' }); onFocused() } }, [focus, cluster.id])
  const floor = (id: number) => <button type="button" class="tm-link" key={id} aria-current={id === selectedId ? 'true' : undefined} onClick={() => onJump(id)}>#{byId.get(id)?.postNumber}{id === selectedId ? ' 当前' : ''}</button>
  return <section class="tm-card" aria-label="问题组">
    <div class="tm-detail-head"><h3 tabIndex={-1} ref={heading}>问过 {cluster.questionIds.length} 次</h3><button type="button" class="tm-button" onClick={() => onJump(cluster.questionIds[0])}>跳到首问</button></div>
    <p class="tm-reason">{excerpt(cluster.text, 160)}</p>
    <dl class="tm-facts">
      <dt>提问楼</dt><dd class="tm-actions">{cluster.questionIds.map(floor)}</dd>
      <dt>回答</dt><dd class="tm-actions">{cluster.answerIds.length ? cluster.answerIds.slice(0, 8).map(id => <span key={id}>{floor(id)}{byId.get(id)?.likeCount ? ` ♥${byId.get(id)!.likeCount}` : ''}</span>) : '没有找到明确回复或引用这些提问的楼'}</dd>
    </dl>
  </section>
}
