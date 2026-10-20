/**
 * 跟随论坛配色：Discourse 的 --secondary 是页面背景色，深色主题下亮度低；--tertiary 是强调色。
 * 读不到时退回系统偏好。论坛切换主题会替换样式表或改 <html> 属性，均会被观察到。
 */

import { rgbToHex } from '../ui/accent'

export type Scheme = 'light' | 'dark'

function luminance(color: string): number | null {
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)
  if (!m) return null
  const [r, g, b] = [m[1], m[2], m[3]].map(v => Number(v) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 把宿主 CSS 变量交给浏览器解析成 rgb()；不支持或未设置时返回空串。只读，不改宿主节点。 */
function resolvedColor(name: string, doc: Document): string {
  const raw = getComputedStyle(doc.documentElement).getPropertyValue(name).trim()
  if (!raw) return ''
  const probe = doc.createElement('span')
  probe.style.color = raw
  probe.style.display = 'none'
  doc.body.appendChild(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value
}

export function detectScheme(doc: Document = document): Scheme {
  const value = luminance(resolvedColor('--secondary', doc))
  if (value !== null) return value < 0.4 ? 'dark' : 'light'
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 论坛强调色（Discourse 的 --tertiary，链接与主要按钮色），规范成 #rrggbb。
 * 只作为推导单一强调色的输入；是否可用、是否需调整明度由 ui/accent.ts 按对比度决定。
 */
export function detectAccent(doc: Document = document): string | undefined {
  return rgbToHex(resolvedColor('--tertiary', doc)) ?? undefined
}

export function watchScheme(onChange: (scheme: Scheme, accent: string | undefined) => void, doc: Document = document): () => void {
  let timer: number | undefined
  const check = () => { window.clearTimeout(timer); timer = window.setTimeout(() => onChange(detectScheme(doc), detectAccent(doc)), 50) }
  const observer = new MutationObserver(check)
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-color-scheme'] })
  observer.observe(doc.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['media', 'href', 'disabled'] })
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  media?.addEventListener('change', check)
  return () => { window.clearTimeout(timer); observer.disconnect(); media?.removeEventListener('change', check) }
}
