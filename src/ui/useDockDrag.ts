import { useRef, useState } from 'preact/hooks'
import type { Prefs } from '../core/storage'

const CLICK_SLOP = 5

/**
 * 贴边按钮与小窗共用的拖动：跟随指针，松手吸附到较近一侧并换算纵向位置（0–1）。
 * 换算与样式里的 top 公式互逆：top = 上沿 + gap + (可用高度) × ratio。
 * 位移小于 5px 视为点击；拖动结束后浏览器仍会派发一次 click，需要忽略。
 */
export function useDockDrag(onDock: (dock: Prefs['dock']) => void) {
  const target = useRef<HTMLElement | null>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null)
  const suppressClick = useRef(false)
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest('button:not([data-drag-handle])')) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP) return
    d.moved = true
    setOffset({ x: dx, y: dy })
  }
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (!d.moved || !target.current) { setOffset(null); return }
    suppressClick.current = true
    const el = target.current
    const style = getComputedStyle(el)
    const top = parseFloat(style.getPropertyValue('--tm-top')) || 0
    const bottom = parseFloat(style.getPropertyValue('--tm-bottom')) || 0
    const gap = parseFloat(style.getPropertyValue('--tm-edge-gap')) || 0
    const usable = window.innerHeight - top - bottom - el.offsetHeight - 2 * gap
    const draggedTop = el.getBoundingClientRect().top
    onDock({ side: e.clientX < window.innerWidth / 2 ? 'left' : 'right', ratio: usable > 0 ? Math.min(1, Math.max(0, (draggedTop - top - gap) / usable)) : 0.4 })
    setOffset(null)
  }
  const onPointerCancel = () => { drag.current = null; setOffset(null) }
  /** 包装点击处理：刚拖动结束时忽略这次点击 */
  const guardClick = (handler: () => void) => () => { if (suppressClick.current) { suppressClick.current = false; return } handler() }
  const dragStyle = offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : {}

  return { target, offset, dragStyle, guardClick, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } }
}
