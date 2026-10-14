import { h } from 'preact'
import { useState } from 'preact/hooks'
import type { ChainIssue, IssueKind } from '../core/chain'
import type { ViewProps } from './ChainView'

const labels: Record<IssueKind, string> = { break: '断链', fork: '分叉', pending: '待确认', backtrack: '回溯', repeat: '重复', inner: '帖内' }
const PAGE = 20

export function issueCounts(issues: ChainIssue[]) {
  const counts: Partial<Record<IssueKind, number>> = {}
  issues.forEach(issue => { counts[issue.kind] = (counts[issue.kind] || 0) + 1 })
  return counts
}

/** 只列需要人看的楼；“下一个问题”从当前阅读位置往后找 */
export function IssuesView({ chain, byId, readingPosition, onSelect, onJump, onDetail }: ViewProps & { readingPosition?: number; onDetail: (id: number) => void }) {
  const [filter, setFilter] = useState<IssueKind | 'all'>('all')
  const [page, setPage] = useState(0)
  if (!chain.issues.length) return <div class="tm-empty"><strong>没有发现问题</strong>{chain.gamePosts} 个接龙帖都按当前规则接上了。{chain.unknownCount ? `另有 ${chain.unknownCount} 处因缺楼无法判断。` : ''}</div>

  const counts = issueCounts(chain.issues)
  const kinds = (Object.keys(labels) as IssueKind[]).filter(kind => counts[kind])
  const list = chain.issues.filter(issue => filter === 'all' || issue.kind === filter)
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const current = Math.min(page, pages - 1)
  const next = list.find(issue => readingPosition === undefined || issue.postNumber > readingPosition) || list[0]
  const choose = (value: IssueKind | 'all') => { setFilter(value); setPage(0) }

  return <>
    <div class="tm-toolbar"><span>{list.length} 个问题</span>{next && <button type="button" class="tm-button" data-variant="primary" onClick={() => { onSelect(next.postId); onJump(next.postId) }}>下一个问题 #{next.postNumber}</button>}</div>
    <div class="tm-segmented" role="group" aria-label="按问题类型筛选">
      <button type="button" aria-pressed={filter === 'all'} onClick={() => choose('all')}>全部 {chain.issues.length}</button>
      {kinds.map(kind => <button type="button" key={kind} aria-pressed={filter === kind} onClick={() => choose(kind)}>{labels[kind]} {counts[kind]}</button>)}
    </div>
    <ul class="tm-issues">{list.slice(current * PAGE, (current + 1) * PAGE).map((issue, i) => <li class="tm-issue" data-kind={issue.kind} key={`${issue.postId}-${issue.kind}-${i}`}>
      <div class="tm-issue-main"><span class="tm-kind">{labels[issue.kind]}</span><b>#{issue.postNumber} {byId.get(issue.postId)?.username}</b><p>{issue.text}</p></div>
      <div class="tm-issue-actions">
        <button type="button" class="tm-button" aria-label={`定位第 ${issue.postNumber} 楼`} onClick={() => { onSelect(issue.postId); onJump(issue.postId) }}>定位</button>
        <button type="button" class="tm-button" aria-label={`查看第 ${issue.postNumber} 楼详情`} onClick={() => onDetail(issue.postId)}>详情</button>
      </div>
    </li>)}</ul>
    {pages > 1 && <nav class="tm-pager" aria-label="问题分页"><button type="button" class="tm-button" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button><span>{current + 1} / {pages}</span><button type="button" class="tm-button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>下一页</button></nav>}
  </>
}
