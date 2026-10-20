import type { LayoutRequest, Placement } from '../core/types'
import { layout, space } from '../ui/tokens'

/** 不改宿主布局：保护正文（含头像/操作区）、原生进度轴及侧栏的横向范围。 */
const CONTENT = '.topic-post, #topic-title, .topic-map, .topic-footer-main-buttons'
const CONTROLS = '.timeline-container, .topic-timeline, .sidebar-wrapper, .sidebar-container'
interface Span { left: number; right: number }

/** 自动并排必须真的有空白；放不下时使用贴边临时抽屉，不为进度轴盲目左移。 */
export function choosePlacement(request: LayoutRequest, width: number, content: Span[], controls: Span[]): Placement {
  const fallback: Placement = { kind: request.mode === 'full' ? 'full' : request.mode === 'open' ? 'drawer' : 'floating', side: request.side, offset: 0, available: width }
  if (request.mode === 'full' || !content.length || (request.mode === 'open' && width <= layout.narrow)) return fallback
  const needed = request.mode === 'open' ? layout.panelMin : request.mode === 'hud' ? layout.hudWidth + 2 * layout.edgeGap : layout.edgeWidth
  const obstacles = [...content, ...controls].map(r => ({ left: Math.max(0, r.left - space[2]), right: Math.min(width, r.right + space[2]) })).filter(r => r.right > r.left).sort((a, b) => a.left - b.left)
  const gaps: Span[] = []
  let end = 0
  for (const rect of obstacles) {
    if (rect.left - end >= needed) gaps.push({ left: end, right: rect.left })
    end = Math.max(end, rect.right)
  }
  if (width - end >= needed) gaps.push({ left: end, right: width })
  if (!gaps.length) return fallback
  // 优先指定侧的空白，再使用另一侧；不把保存的左右偏好悄悄改掉。
  const sideOf = (gap: Span) => (gap.left + gap.right) / 2 < width / 2 ? 'left' : 'right'
  gaps.sort((a, b) => Number(sideOf(b) === request.side) - Number(sideOf(a) === request.side) || (request.side === 'right' ? b.right - a.right : a.left - b.left))
  const gap = gaps[0], side = sideOf(gap)
  return { kind: 'sidecar', side, offset: Math.ceil(side === 'left' ? gap.left : width - gap.right), available: Math.floor(gap.right - gap.left) }
}

function bounds(doc: Document, selector: string, controls = false): Span[] {
  const win = doc.defaultView!, out: Span[] = []
  for (const el of doc.querySelectorAll<HTMLElement>(selector)) {
    if (controls && el.closest('.timeline-fullscreen')) continue
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height || rect.right <= 0 || rect.left >= win.innerWidth || (controls && (rect.bottom <= 0 || rect.top >= win.innerHeight))) continue
    const style = win.getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') continue
    out.push({ left: rect.left, right: rect.right })
  }
  return out
}

/** 帧合并宿主测量；交互变更在布局阶段立即计算，避免先按小按钮空位绘制大面板。 */
export function watchNativeLayout(root: HTMLElement, onChange: (placement: Placement) => void, doc: Document = document) {
  const win = doc.defaultView!
  let frame: number | undefined
  let request: LayoutRequest = { mode: 'collapsed', side: 'right', width: layout.panelWidth }
  const raf = typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame.bind(win) : (fn: FrameRequestCallback) => win.setTimeout(() => fn(win.performance.now()), 16)
  const cancel = typeof win.cancelAnimationFrame === 'function' ? win.cancelAnimationFrame.bind(win) : win.clearTimeout.bind(win)
  const measure = () => {
    const next = choosePlacement(request, win.innerWidth, bounds(doc, CONTENT), bounds(doc, CONTROLS, true))
    root.style.setProperty('--tm-dock-offset', `${next.offset}px`)
    root.style.setProperty('--tm-free-width', `${next.available}px`)
    root.toggleAttribute('data-edge-inset', next.offset > 0)
    onChange(next)
  }
  const schedule = () => {
    if (frame !== undefined) return
    frame = raf(() => { frame = undefined; measure() })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] })
  if (doc.body) observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] })
  win.addEventListener('resize', schedule, { passive: true })
  win.addEventListener('scroll', schedule, { passive: true })
  schedule()
  return {
    configure(next: LayoutRequest) { request = next; measure() },
    schedule,
    stop() {
      if (frame !== undefined) cancel(frame)
      frame = undefined
      observer.disconnect()
      win.removeEventListener('resize', schedule)
      win.removeEventListener('scroll', schedule)
      root.style.removeProperty('--tm-dock-offset')
      root.style.removeProperty('--tm-free-width')
      root.removeAttribute('data-edge-inset')
    },
  }
}
