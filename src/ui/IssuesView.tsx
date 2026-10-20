import { h } from 'preact'
import type { ChainIssue, IssueKind } from '../core/chain'
import type { ViewProps } from './ChainView'
import { useI18n } from './I18n'
import { PostLink } from './PostLink'
import { useRemembered } from './remembered'

const labels = { break: 'issue.break', fork: 'issue.fork', pending: 'issue.pending', backtrack: 'issue.backtrack', repeat: 'issue.repeat', inner: 'issue.inner' } as const
const PAGE = 20

export function issueCounts(issues: ChainIssue[]) {
  const counts: Partial<Record<IssueKind, number>> = {}
  issues.forEach(issue => { counts[issue.kind] = (counts[issue.kind] || 0) + 1 })
  return counts
}

/** 只列需要人看的楼；“下一个问题”从当前阅读位置往后找 */
export function IssuesView({ chain, byId, readingPosition, onSelect, navigation, onDetail, memory }: ViewProps & { readingPosition?: number; onDetail: (id: number) => void }) {
  const { t, format } = useI18n()
  const [filter, setFilter] = useRemembered<IssueKind | 'all'>(memory, 'chain.issues.filter', 'all')
  const [page, setPage] = useRemembered(memory, 'chain.issues.page', 0)
  if (!chain.issues.length) return <div class="tm-empty"><strong>{t('chain.good')}</strong>{t('issue.goodHint', { count: chain.gamePosts })}{chain.unknownCount ? t('issue.unknownHint', { count: chain.unknownCount }) : ''}</div>

  const counts = issueCounts(chain.issues)
  const kinds = (Object.keys(labels) as IssueKind[]).filter(kind => counts[kind])
  const list = chain.issues.filter(issue => filter === 'all' || issue.kind === filter)
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const current = Math.min(page, pages - 1)
  const next = list.find(issue => readingPosition === undefined || issue.postNumber > readingPosition) || list[0]
  const choose = (value: IssueKind | 'all') => { setFilter(value); setPage(0) }

  return <>
    <div class="tm-toolbar"><span>{t('chain.issueCount', { count: list.length })}</span>{next && <PostLink post={byId.get(next.postId)} navigation={navigation} primary onFollow={() => onSelect(next.postId)}>{t('issue.next', { number: next.postNumber })}</PostLink>}</div>
    <div class="tm-segmented" role="group" aria-label={t('issue.filter')}>
      <button type="button" aria-pressed={filter === 'all'} onClick={() => choose('all')}>{t('issue.all', { count: chain.issues.length })}</button>
      {kinds.map(kind => <button type="button" key={kind} aria-pressed={filter === kind} onClick={() => choose(kind)}>{t(labels[kind])} {counts[kind]}</button>)}
    </div>
    <ul class="tm-issues">{list.slice(current * PAGE, (current + 1) * PAGE).map((issue, i) => <li class="tm-issue" data-kind={issue.kind} key={`${issue.postId}-${issue.kind}-${i}`}>
      <div class="tm-issue-main"><span class="tm-kind">{t(labels[issue.kind])}</span><b>#{issue.postNumber} {byId.get(issue.postId)?.username}</b><p>{format(issue.text)}</p></div>
      <div class="tm-issue-actions">
        <PostLink post={byId.get(issue.postId)} navigation={navigation} ariaLabel={t('issue.locateLabel', { number: issue.postNumber })} onFollow={() => onSelect(issue.postId)}>{t('issue.locate')}</PostLink>
        <button type="button" class="tm-button" aria-label={t('issue.detailLabel', { number: issue.postNumber })} onClick={() => onDetail(issue.postId)}>{t('issue.details')}</button>
      </div>
    </li>)}</ul>
    {pages > 1 && <nav class="tm-pager" aria-label={t('common.pages')}><button type="button" class="tm-button" disabled={current === 0} onClick={() => setPage(current - 1)}>{t('common.previousPage')}</button><span>{current + 1} / {pages}</span><button type="button" class="tm-button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>{t('common.nextPage')}</button></nav>}
  </>
}
