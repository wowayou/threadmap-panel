import { h } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { resolvePostPreview } from '../core/post-preview'
import type { ReplyEvidence } from '../core/questions'
import type { Post, PostNavigation } from '../core/types'
import { useI18n } from './I18n'
import { PostLink } from './PostLink'

const SHOWN_EVIDENCE = 8

/** 只显示已载入内容。游标用稳定 ID；顶部切换，不必滚完长回复才找到下一条。 */
export function PostPreview({ ids, byId, selectedId, active = true, focusable = true, navigation, evidence = [], onSelect, onClose }: {
  ids: readonly number[]
  byId: ReadonlyMap<number, Post>
  selectedId: number
  active?: boolean
  /** 恢复视图不自动聚焦；显式点上一条/下一条仍聚焦本次的内容标题。 */
  focusable?: boolean
  navigation: PostNavigation
  evidence?: readonly ReplyEvidence[]
  onSelect: (id: number) => void
  onClose?: () => void
}) {
  const { t } = useI18n()
  const view = resolvePostPreview(ids, byId, selectedId)
  const heading = useRef<HTMLHeadingElement>(null)
  const moveFocus = useRef(false)
  useLayoutEffect(() => {
    if (active && (focusable || moveFocus.current)) { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView?.({ block: 'nearest' }) }
    moveFocus.current = false
  }, [view?.post.id])
  const move = (id: number | undefined) => { if (id !== undefined) { moveFocus.current = true; onSelect(id) } }
  if (!view) return <section class="tm-card" aria-label={t('reader.preview')}><p>{t('reader.unavailable')}</p>{onClose && <button type="button" class="tm-button" onClick={onClose}>{t('reader.close')}</button>}</section>
  const { post, previousId, nextId } = view
  return <section class="tm-post-preview" aria-label={t('reader.preview')}>
    <nav class="tm-reply-nav" aria-label={t('reader.replyPosition', { index: view.index + 1, total: view.total })}>
      <button type="button" class="tm-button" disabled={previousId === undefined} onClick={() => move(previousId)}>{t('reader.previous')}</button>
      <span role="status" aria-live="polite">{view.index + 1} / {view.total}</span>
      <button type="button" class="tm-button" disabled={nextId === undefined} onClick={() => move(nextId)}>{t('reader.next')}</button>
    </nav>
    <div class="tm-post-heading"><span class="tm-avatar" aria-hidden="true">{post.username.slice(0, 1).toUpperCase()}</span><h3 tabIndex={-1} ref={heading}>#{post.postNumber} · {post.username}</h3>{onClose && <button type="button" class="tm-button" onClick={onClose}>{t('reader.close')}</button>}</div>
    {!!evidence.length && <div class="tm-reply-evidence">{evidence.slice(0, SHOWN_EVIDENCE).map(item => <span class="tm-note" key={item.questionId}>{t(item.kind === 'reply' ? 'reader.replyTo' : 'reader.quoteOf', { number: byId.get(item.questionId)?.postNumber ?? '?' })}</span>)}{evidence.length > SHOWN_EVIDENCE && <span class="tm-note">{t('reader.moreEvidence', { count: evidence.length - SHOWN_EVIDENCE })}</span>}</div>}
    <p class="tm-post-text">{post.text || t('reader.empty')}</p>
    {!!post.likeCount && <p class="tm-note">{t('reader.likes', { count: post.likeCount })}</p>}
    <div class="tm-actions"><PostLink post={post} navigation={navigation}>{t('common.original')}</PostLink></div>
    <p class="tm-note">{t('reader.previewHint')}</p>
  </section>
}
