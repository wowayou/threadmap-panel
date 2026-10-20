import { h, type RefObject } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { defaultQaSettings, type QaResult, type QaSettings, type QuestionCluster } from '../core/questions'
import type { Post, PostNavigation } from '../core/types'
import { useI18n } from './I18n'
import { PostLink } from './PostLink'
import { PostPreview } from './PostPreview'
import { useRemembered, type ViewMemory } from './remembered'

const PAGE = 20
const SHOWN_FLOORS = 20
const excerpt = (text: string, max = 120) => text.length > max ? `${text.slice(0, max)}…` : text
interface ReaderTarget { questionId: number; postId: number | null }

interface Props {
  qa: QaResult
  byId: Map<number, Post>
  selected: number | null
  active?: boolean
  confirmingLoad?: boolean
  focusDetail: boolean
  onFocused: () => void
  onSelect: (id: number) => void
  navigation: PostNavigation
  missing: number
  settings?: QaSettings
  memory?: ViewMemory
  scrollContainer?: RefObject<HTMLDivElement>
}

/** 一步进入问题与回复，在同一滚动区阅读；返回而不是把多个卡片堆在列表上方。 */
export function QaView({ qa, byId, selected, active = true, confirmingLoad = false, focusDetail, onFocused, onSelect, navigation, missing, settings = defaultQaSettings, memory, scrollContainer }: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useRemembered(memory, 'qa.query', '')
  const [page, setPage] = useRemembered(memory, 'qa.page', 0)
  const [reader, setReader] = useRemembered<ReaderTarget | null>(memory, 'qa.reader', null)
  const [listScroll, setListScroll] = useRemembered(memory, 'qa.listScroll', 0)
  const queryInput = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const readerHeading = useRef<HTMLHeadingElement>(null)
  const readerRoot = useRef<HTMLElement>(null)
  const focusAction = useRef<'open' | 'back' | null>(null)
  const results = query.trim() ? qa.search(query) : []
  const current = reader ? qa.clusterOf.get(reader.questionId) : undefined
  const pages = Math.max(1, Math.ceil(qa.repeated.length / PAGE))
  const pageIndex = Math.min(page, pages - 1)

  const open = (cluster: QuestionCluster, questionId: number, source?: HTMLElement) => {
    if (!reader) setListScroll(scrollContainer?.current?.scrollTop ?? 0)
    trigger.current = source ?? null
    focusAction.current = 'open'
    const postId = reader && cluster.questionIds.includes(reader.questionId) ? reader.postId : cluster.answerIds[0] ?? null
    setReader({ questionId, postId })
    if (selected !== questionId) onSelect(questionId)
  }
  const back = () => { focusAction.current = 'back'; setReader(null) }
  // 原帖标注/小窗是显式阅读请求；普通阅读位置提示只更新选中，不自动展开或抢焦点。
  useLayoutEffect(() => {
    if (!active || !focusDetail || selected === null) return
    const cluster = qa.clusterOf.get(selected)
    if (cluster) open(cluster, selected)
    onFocused()
  }, [active, focusDetail, selected, qa])
  useLayoutEffect(() => {
    if (!active || !focusAction.current) return
    const action = focusAction.current
    // 外部标注的请求先安排阅读状态，再挂载标题；不能在 reader 仍为空的提交中消费动作。
    if ((action === 'open' && !reader) || (action === 'back' && reader)) return
    focusAction.current = null
    if (action === 'open' && reader) {
      readerHeading.current?.focus({ preventScroll: true })
      const body = scrollContainer?.current, root = readerRoot.current
      if (body && root) body.scrollTop += root.getBoundingClientRect().top - body.getBoundingClientRect().top
    } else if (action === 'back' && !reader) {
      const target = trigger.current?.isConnected ? trigger.current : queryInput.current
      target?.focus({ preventScroll: true })
      if (scrollContainer?.current) scrollContainer.current.scrollTop = listScroll
    }
  }, [reader])

  const summary = (cluster: QuestionCluster) => !settings.associateReplies ? t('qa.unlinked') : cluster.answerIds.length ? t('qa.replies', { count: cluster.answerIds.length }) : t('qa.noReplies')
  const row = (cluster: QuestionCluster) => {
    const first = byId.get(cluster.questionIds[0])
    return <li class="tm-topic-row" key={cluster.questionIds[0]}>
      <button type="button" class="tm-topic-button" aria-label={t('qa.readLabel', { number: first?.postNumber ?? '?' })} onClick={e => open(cluster, cluster.questionIds[0], e.currentTarget)}>
        <span class="tm-topic-meta">#{first?.postNumber} · {t('qa.asked', { count: cluster.questionIds.length })}</span>
        <strong>{excerpt(cluster.text)}</strong>
        <span class="tm-topic-meta">{summary(cluster)} <span aria-hidden="true">→</span></span>
      </button>
    </li>
  }

  return <div class="tm-stack tm-qa" onKeyDown={e => {
    if (active && reader && !confirmingLoad && e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); back() }
  }}>
    {/* 列表隐藏而非销毁；查询、分页、焦点入口与原滚动位置仍属于当前主题。 */}
    <div class="tm-stack" hidden={!!reader}>
      <section class="tm-field">
        <label htmlFor="tm-ask">{t('qa.searchLabel')}</label>
        <div class="tm-field-row">
          <input id="tm-ask" ref={queryInput} class="tm-input" value={query} maxLength={120} autocomplete="off" placeholder={t('qa.placeholder')} onInput={e => setQuery(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery('') } }} />
          {query && <button type="button" class="tm-button" onClick={() => { setQuery(''); queryInput.current?.focus() }}>{t('common.clear')}</button>}
        </div>
        <div class="tm-results" role="status" aria-live="polite">{query.trim() && !results.length && <p class="tm-result">{t('qa.noResults')}{missing ? t('qa.missing', { count: missing }) : ''}</p>}</div>
        {!!results.length && <ul class="tm-topics tm-search-results">{results.map(({ cluster }) => row(cluster))}</ul>}
      </section>
      <div class="tm-summary"><span>{t('qa.summary', { questions: qa.questions.size, repeated: qa.repeated.length })}</span></div>
      {qa.repeated.length
        ? <ul class="tm-topics tm-repeated">{qa.repeated.slice(pageIndex * PAGE, (pageIndex + 1) * PAGE).map(row)}</ul>
        : <div class="tm-empty"><strong>{t(qa.questions.size ? 'qa.noRepeated' : 'qa.noQuestions')}</strong>{qa.questions.size ? t('qa.detected', { count: qa.questions.size }) : t('qa.contextHint')}{!settings.approximate && t('qa.exactHint')}{t('qa.nextHint')}</div>}
      {pages > 1 && <nav class="tm-pager" aria-label={t('common.pages')}><button type="button" class="tm-button" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>{t('common.previousPage')}</button><span>{pageIndex + 1} / {pages}</span><button type="button" class="tm-button" disabled={pageIndex >= pages - 1} onClick={() => setPage(pageIndex + 1)}>{t('common.nextPage')}</button></nav>}
      <p class="tm-note">{t(settings.approximate ? 'qa.method' : 'qa.exactHint')}{t(settings.associateReplies ? 'qa.replyMethod' : 'qa.repliesOff')}</p>
    </div>

    {reader && <section class="tm-stack tm-reader" aria-label={t('reader.label')} ref={readerRoot}>
      <div class="tm-reader-nav"><button type="button" class="tm-button" onClick={back}>← {t('reader.back')}</button></div>
      <section class="tm-question-context" aria-label={t('reader.question')}>
        <h3 tabIndex={-1} ref={readerHeading}>{current ? current.text : t('reader.missingQuestion')}</h3>
        {current && <>
          <div class="tm-topic-meta">{t('qa.asked', { count: current.questionIds.length })} · {summary(current)}</div>
          <div class="tm-actions"><PostLink post={byId.get(current.questionIds[0])} navigation={navigation}>{t('reader.first')}</PostLink></div>
          <QuestionPosts cluster={current} byId={byId} selectedId={reader.questionId} navigation={navigation} />
        </>}
      </section>
      {current && (!settings.associateReplies ? <p class="tm-note">{t('reader.offHint')}</p>
        : reader.postId !== null ? <PostPreview ids={current.answerIds} byId={byId} selectedId={reader.postId} active={active} focusable={false} navigation={navigation} evidence={current.answerEvidence.get(reader.postId)} onSelect={postId => setReader({ ...reader, postId })} />
        : current.answerIds.length ? <button type="button" class="tm-button" onClick={() => { focusAction.current = 'open'; setReader({ ...reader, postId: current.answerIds[0] }) }}>{t('qa.readReplies', { count: current.answerIds.length })}</button>
        : <p class="tm-empty">{t('reader.noReplyHint')}</p>)}
    </section>}
  </div>
}

function QuestionPosts({ cluster, byId, selectedId, navigation }: { cluster: QuestionCluster; byId: Map<number, Post>; selectedId: number; navigation: PostNavigation }) {
  const { t } = useI18n()
  const shown = cluster.questionIds.slice(0, SHOWN_FLOORS)
  if (!shown.includes(selectedId) && cluster.questionIds.includes(selectedId)) shown.push(selectedId)
  const hidden = cluster.questionIds.length - shown.length
  return <details class="tm-question-posts">
    <summary>{t('reader.questionPosts', { count: cluster.questionIds.length })}</summary>
    <div class="tm-actions">{shown.map(id => <PostLink post={byId.get(id)} navigation={navigation} key={id} current={id === selectedId}>#{byId.get(id)?.postNumber}{id === selectedId ? t('reader.current') : ''}</PostLink>)}{hidden > 0 && <span class="tm-note">{t('reader.more', { count: hidden })}</span>}</div>
  </details>
}
