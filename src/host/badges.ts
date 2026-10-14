import type { Badge } from '../core/chain'
import { badgeCss as badgeCssFor } from '../ui/styles'
import { postElements } from './discourse'
import type { Scheme } from './theme'

export const BADGE_CLASS = 'threadmap-badge'

/** 宿主页面里的标注样式由 ui/styles.ts 从同一套基准色生成 */
export const badgeCss = badgeCssFor(BADGE_CLASS)

export function ensureBadgeStyle(doc: Document = document) {
  if (doc.getElementById('threadmap-badge-style')) return
  const style = doc.createElement('style')
  style.id = 'threadmap-badge-style'
  style.textContent = badgeCss
  doc.head.appendChild(style)
}

export function badgeText(badge: Badge) { return `${badge.icon} ${badge.label}` }

/**
 * 幂等地同步标注：只有内容变化才改 DOM。Discourse 重新渲染帖子会丢掉标注，
 * 由宿主的 MutationObserver 再次调用即可补上。
 */
export function applyBadges(badges: Map<number, Badge> | null, onClick: (postNumber: number) => void, doc: Document = document, scheme: Scheme = 'light') {
  for (const outer of postElements(doc)) {
    const cooked = outer.querySelector<HTMLElement>('.cooked, .post-content')
    if (!cooked) continue
    const existing = cooked.querySelector<HTMLButtonElement>(`:scope > .${BADGE_CLASS}`)
    const postNumber = Number(outer.dataset.postNumber)
    const badge = badges?.get(postNumber)
    if (!badge) { existing?.remove(); continue }
    const node = existing || doc.createElement('button')
    const text = badgeText(badge), className = `${BADGE_CLASS} ${badge.tone}`
    if (node.textContent !== text) node.textContent = text
    if (node.className !== className) node.className = className
    if (node.title !== badge.title) node.title = badge.title
    if (node.dataset.scheme !== scheme) node.dataset.scheme = scheme
    const label = `ThreadMap：第 ${postNumber} 楼 ${badge.label}，点击查看判断`
    if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label)
    if (!existing) {
      node.type = 'button'
      node.dataset.threadmapPost = String(postNumber)
      node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); onClick(Number(node.dataset.threadmapPost)) })
      cooked.prepend(node)
    }
  }
}

export function clearBadges(doc: Document = document) {
  doc.querySelectorAll(`.${BADGE_CLASS}`).forEach(node => node.remove())
}

/** 变化是否只来自我们自己的标注（避免 observer 自激） */
export function isOwnMutation(records: MutationRecord[]) {
  return records.every(record => {
    if ((record.target as Element).closest?.(`.${BADGE_CLASS}`)) return true
    const nodes = [...record.addedNodes, ...record.removedNodes]
    return nodes.length > 0 && nodes.every(node => (node as Element).classList?.contains(BADGE_CLASS))
  })
}

/** 明确跳转后的到达反馈：目标楼短暂描边（docs/ui-spec.md §4 规则 1） */
export function flashPost(el: HTMLElement, scheme: Scheme = 'light') {
  el.dataset.threadmapScheme = scheme
  el.classList.add('threadmap-flash')
  window.setTimeout(() => el.classList.remove('threadmap-flash'), 1600)
}
