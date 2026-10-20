/**
 * 归属标记：ThreadMap 插入宿主页面的节点（原帖标注）都带上本次页面随机生成的令牌。
 * 清理、跳过自身变化、重读正文时只认这个令牌，不认类名，避免误认正文里的同名类/属性。
 * 令牌不是同页脚本间的安全边界：页面脚本可以读取并复制它。
 */

export const OWNER_ATTR = 'data-threadmap-owner'

function randomToken(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

export const OWNER_TOKEN = randomToken()
export const OWNED = `[${OWNER_ATTR}="${OWNER_TOKEN}"]`

export function markOwned(el: Element) { el.setAttribute(OWNER_ATTR, OWNER_TOKEN) }
export function isOwned(node: Node | null | undefined): boolean {
  return !!node && node.nodeType === 1 && (node as Element).getAttribute(OWNER_ATTR) === OWNER_TOKEN
}
