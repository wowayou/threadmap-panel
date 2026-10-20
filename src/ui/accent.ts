import { colors, type Scheme } from './tokens'

/**
 * 跟随论坛的单一强调色。只取宿主强调色的色相/饱和度，再按本面板的表面色调整明度，
 * 直到所有用到强调色的组合都满足 tokens.contrastPairs 的同一门槛（不放宽）。
 * 调整不到合格明度（或输入不是颜色）时返回 null，调用方使用 tokens 里的默认强调色。
 */

export type AccentKey = 'accent' | 'accentHover' | 'accentSoft' | 'onAccent' | 'focus' | 'flash'
export type Accent = Record<AccentKey, string>

const HEX = /^#[0-9a-f]{6}$/i

export function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const toHex = (rgb: number[]) => '#' + rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
function hsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, s, l]
}
function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return toHex([r, g, b].map(v => (v + m) * 255))
}
const mix = (a: string, b: string, weight: number) => toHex([1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16) * weight + parseInt(b.slice(i, i + 2), 16) * (1 - weight)))

/** 解析浏览器计算后的 rgb()/rgba() 颜色；透明或不透明度过低视为没有可用强调色。 */
export function rgbToHex(value: string): string | null {
  const m = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/)
  if (!m) return null
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])
  return alpha >= 0.99 ? toHex([m[1], m[2], m[3]].map(Number)) : null
}

/** 强调色需要满足的组合，与 tokens.contrastPairs 中涉及强调色的条目一致（测试核对两者同步）。 */
export function accentPasses(scheme: Scheme, a: Accent): boolean {
  const c = colors[scheme]
  return contrast(a.accent, c.surface) >= 4.5 && contrast(a.accent, c.canvas) >= 4.5 && contrast(a.accent, a.accentSoft) >= 4.5
    && contrast(a.onAccent, a.accent) >= 4.5 && contrast(a.onAccent, a.accentHover) >= 4.5
    && contrast(a.focus, c.surface) >= 3 && contrast(a.focus, c.canvas) >= 3
}

export function deriveAccent(host: string | null | undefined, scheme: Scheme): Accent | null {
  if (!host || !HEX.test(host)) return null
  const [h, s, start] = hsl(host.toLowerCase())
  const surface = colors[scheme].surface
  // 浅色从宿主明度往暗处找、深色往亮处找，取第一个合格值：尽量少偏离宿主颜色。
  const step = scheme === 'light' ? -0.01 : 0.01
  // 先试宿主原色（合格就原样采用），再按整数百分比步进，避免浮点累积误差。
  const from = Math.round(Math.min(0.92, Math.max(0.08, start)) * 100), candidates = [start]
  for (let i = from; i >= 8 && i <= 92; i += step > 0 ? 1 : -1) candidates.push(i / 100)
  for (const l of candidates) {
    const accent = l === start ? host.toLowerCase() : fromHsl(h, s, l)
    const hover = fromHsl(h, s, Math.min(0.95, Math.max(0.05, l + step * 8)))
    const onAccent = contrast('#ffffff', accent) >= contrast('#101418', accent) ? '#ffffff' : '#101418'
    const value: Accent = { accent, accentHover: hover, accentSoft: mix(accent, surface, scheme === 'light' ? 0.1 : 0.22), onAccent, focus: accent, flash: accent }
    if (accentPasses(scheme, value)) return value
  }
  return null
}

const kebab = (key: string) => key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())
/** 运行时覆盖的 --tm-c-* 变量；只含强调色相关键，表面与状态色仍来自 tokens。 */
export function accentVars(accent: Accent | null): Record<string, string> {
  return accent ? Object.fromEntries(Object.entries(accent).map(([k, v]) => [`--tm-c-${kebab(k)}`, v])) : {}
}
