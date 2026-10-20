import { isId } from '../core/post-input'
import type { Post, PostNavigation } from '../core/types'
import { flashPost } from './badges'
import { postElements, routeTopicId, topicPermalink } from './discourse'
import type { Scheme } from './theme'

/**
 * 只负责安全链接和已显示楼层的定位，不请求数据、不改选中项、不销毁会话。
 * 不使用 location.assign 或 DiscourseURL.routeTo：后者也可能强制整页刷新。
 * 未显示的楼层交给带 target=_blank 的原生链接，原页数据留在内存。
 */
export function createPostNavigation(topicId: number, origin: string, scheme: () => Scheme, doc: Document = document, accent: () => string | undefined = () => undefined): PostNavigation {
  const href = (post: Post): string | undefined => {
    if (!isId(topicId) || !isId(post.id) || !isId(post.postNumber) || (post.topicId !== undefined && post.topicId !== topicId) || (post.origin !== undefined && post.origin !== origin)) return undefined
    try {
      const url = new URL(topicPermalink(topicId, post.postNumber, doc.location?.pathname || ''), origin)
      return url.origin === origin && (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : undefined
    } catch { return undefined }
  }
  return {
    href,
    reveal(post) {
      if (!href(post) || routeTopicId(doc.location?.pathname || '') !== topicId) return false
      const el = postElements(doc).find(outer => {
        const article = outer.matches('article') ? outer : outer.querySelector<HTMLElement>('article')
        return outer.dataset.postNumber === String(post.postNumber) && article?.dataset.postId === String(post.id)
          && [outer.dataset.topicId, article.dataset.topicId].every(value => value === undefined || value === String(topicId))
      })
      if (!el || typeof el.scrollIntoView !== 'function') return false
      const article = el.querySelector<HTMLElement>('article') || el
      const rect = article.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false // 隐藏节点/空占位不能冒充已经显示的正文
      const smooth = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === false
      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' })
      flashPost(article, scheme(), accent())
      return true
    },
  }
}
