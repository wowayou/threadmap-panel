/**
 * 跟随论坛配色：Discourse 的 --secondary 是页面背景色，深色主题下亮度低。
 * 读不到时退回系统偏好。论坛切换主题会替换样式表或改 <html> 属性，均会被观察到。
 */

export type Scheme = 'light' | 'dark'

function luminance(color: string): number | null {
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)
  if (!m) return null
  const [r, g, b] = [m[1], m[2], m[3]].map(v => Number(v) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function detectScheme(doc: Document = document): Scheme {
  const raw = getComputedStyle(doc.documentElement).getPropertyValue('--secondary').trim()
  if (raw) {
    // 把任意 CSS 颜色写法交给浏览器解析成 rgb()
    const probe = doc.createElement('span')
    probe.style.color = raw
    probe.style.display = 'none'
    doc.body.appendChild(probe)
    const value = luminance(getComputedStyle(probe).color)
    probe.remove()
    if (value !== null) return value < 0.4 ? 'dark' : 'light'
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function watchScheme(onChange: (scheme: Scheme) => void, doc: Document = document): () => void {
  let timer: number | undefined
  const check = () => { window.clearTimeout(timer); timer = window.setTimeout(() => onChange(detectScheme(doc)), 50) }
  const observer = new MutationObserver(check)
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-color-scheme'] })
  observer.observe(doc.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['media', 'href', 'disabled'] })
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  media?.addEventListener('change', check)
  return () => { window.clearTimeout(timer); observer.disconnect(); media?.removeEventListener('change', check) }
}
