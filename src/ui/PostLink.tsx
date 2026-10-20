import { h, type ComponentChildren } from 'preact'
import { useI18n } from './I18n'
import type { Post, PostNavigation } from '../core/types'

/** 所有原帖链接共用：本页可定位就滚动，否则原生新标签打开，绝不刷新分析页。 */
export function PostLink({ post, navigation, children, className = 'tm-button', ariaLabel, current, primary, onFollow }: {
  post: Post | undefined
  navigation: PostNavigation
  children: ComponentChildren
  className?: string
  ariaLabel?: string
  current?: boolean
  primary?: boolean
  onFollow?: () => void
}) {
  const { t } = useI18n()
  const href = post && navigation.href(post)
  if (!post || !href) return null
  const follow = (event: MouseEvent) => {
    event.stopPropagation() // 不让宿主的委托路由把新标签链接改为整页导航
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    onFollow?.()
    if (navigation.reveal(post)) event.preventDefault()
  }
  return <a class={className} href={href} target="_blank" rel="noopener noreferrer" aria-label={ariaLabel} aria-current={current ? 'true' : undefined} data-variant={primary ? 'primary' : undefined} title={t('common.originalHint')} onClick={follow}>{children}</a>
}
