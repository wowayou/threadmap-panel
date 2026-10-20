import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PANEL_WIDTH } from '../src/core/storage'
import { badgeCss, cssParts } from '../src/ui/styles'
import { colors, contrastPairs, fontSize, layout, zIndex } from '../src/ui/tokens'
import { accentPasses, contrast, deriveAccent, rgbToHex, type Accent } from '../src/ui/accent'

/**
 * 设计契约：防止 UI 漂移（docs/ui-spec.md §6）。
 * 规则区只能引用 --tm-* 变量；变量只在基准区由 tokens.ts 生成。
 */

const { prelude, rules } = cssParts
/** 由宿主或组件运行时提供、必须带回退值的变量 */
const RUNTIME_VARS = ['--tm-top', '--tm-bottom', '--tm-w', '--tm-edge-ratio', '--tm-dock-offset', '--tm-free-width']

const declarations = (prop: string) => [...rules.matchAll(new RegExp(`(?:^|[;{])\\s*${prop}\\s*:\\s*([^;}]+)`, 'g'))].map(m => m[1].trim().replace(/!important$/, ''))

describe('样式只引用基准变量', () => {
  it('规则区没有裸颜色', () => {
    expect(rules.match(/#[0-9a-f]{3,8}\b/gi) || []).toEqual([])
    expect(rules.match(/\b(rgba?|hsla?)\(/gi) || []).toEqual([])
  })

  it.each([
    ['font-size', /^(var\(--tm-fs-[a-z]+\)|inherit)$/],
    ['font-weight', /^var\(--tm-fw-[a-z]+\)$/],
    ['line-height', /^var\(--tm-lh-[a-z]+\)$/],
    ['z-index', /^var\(--tm-z-[a-z]+\)$/],
  ])('%s 只用基准值', (prop, allowed) => {
    const values = declarations(prop as string)
    expect(values.length).toBeGreaterThan(0)
    expect(values.filter(v => !(allowed as RegExp).test(v))).toEqual([])
  })

  it('圆角、内外边距、间隙只用刻度', () => {
    const token = /^(0|auto|var\(--tm-[a-z0-9-]+\)|calc\(.+\))$/
    for (const prop of ['border-radius', 'padding', 'padding-top', 'padding-right', 'margin', 'margin-right', 'gap'])
      for (const value of declarations(prop)) expect(value.split(/\s+(?![^(]*\))/).filter(part => !token.test(part)), `${prop}: ${value}`).toEqual([])
  })

  it('时长只用基准值', () => {
    expect(rules.match(/\b\d+(\.\d+)?m?s\b/g) || []).toEqual([])
  })

  it('引用的变量都已定义；运行时变量必须带回退值', () => {
    const defined = new Set([...prelude.matchAll(/(--tm-[a-z0-9-]+):/g)].map(m => m[1]))
    const used = [...rules.matchAll(/var\((--tm-[a-z0-9-]+)(,?)/g)]
    const undefinedVars = used.filter(([, name]) => !defined.has(name) && !RUNTIME_VARS.includes(name)).map(([, name]) => name)
    expect([...new Set(undefinedVars)]).toEqual([])
    expect(used.filter(([, name, comma]) => RUNTIME_VARS.includes(name) && !comma).map(([, name]) => name)).toEqual([])
  })
})

describe('基准本身', () => {
  const lum = (hex: string) => { const n = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

  it('两套配色键名一致', () => {
    expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort())
  })

  it.each(['light', 'dark'] as const)('%s 配色满足 WCAG 对比度（文字 4.5:1，控件与焦点 3:1）', scheme => {
    const failures = contrastPairs.map(([fg, bg, min]) => ({ pair: `${fg}/${bg}`, value: ratio(colors[scheme][fg], colors[scheme][bg]), min })).filter(r => r.value < r.min)
    expect(failures).toEqual([])
  })

  it('最小字号 12px，目标尺寸不小于 24px（WCAG 2.5.8）', () => {
    expect(Math.min(...Object.values(fontSize))).toBeGreaterThanOrEqual(12)
    expect(layout.targetMin).toBeGreaterThanOrEqual(24)
    expect(layout.target).toBeGreaterThanOrEqual(layout.targetMin)
    expect(Math.min(layout.edgeWidth, layout.edgeHeight, layout.switchHeight)).toBeGreaterThanOrEqual(24)
  })

  it('层级位于 Discourse header(1000) 与弹窗(1200) 之间', () => {
    expect(zIndex.widget).toBeGreaterThan(1000)
    expect(zIndex.widget).toBeLessThan(1200)
    expect(readFileSync(join(__dirname, '../src/userscript.tsx'), 'utf8')).toContain(`z-index:${zIndex.widget}`)
  })

  it('面板宽度范围与存储层一致', () => {
    expect(PANEL_WIDTH).toEqual({ min: layout.panelMin, max: layout.panelMax, default: layout.panelWidth })
  })

  it('原帖标注使用同一套语义色', () => {
    const css = badgeCss()
    for (const scheme of ['light', 'dark'] as const) for (const key of ['okBg', 'warnBg', 'badBg', 'neutralBg']) expect(css).toContain(colors[scheme][key])
  })
})

describe('单一强调色', () => {
  const ACCENT_KEYS = ['accent', 'accentHover', 'accentSoft', 'onAccent', 'focus', 'flash']
  const pick = (scheme: 'light' | 'dark') => Object.fromEntries(ACCENT_KEYS.map(k => [k, colors[scheme][k]])) as Accent

  it('焦点与到达描边就是强调色；中性提示是纯灰而非另一种色相', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const c = colors[scheme]
      expect([c.focus, c.flash]).toEqual([c.accent, c.accent])
      for (const key of ['neutralBg', 'neutralFg', 'neutralLine', 'canvas', 'surface', 'sunken', 'ink', 'muted', 'line', 'control']) {
        const [r, g, b] = [1, 3, 5].map(i => parseInt(c[key].slice(i, i + 2), 16))
        expect(Math.max(r, g, b) - Math.min(r, g, b), `${scheme}.${key}`).toBeLessThanOrEqual(3)
      }
    }
  })

  it('运行时校验与 contrastPairs 中涉及强调色的门槛一致，默认强调色也通过', () => {
    const involved = contrastPairs.filter(([fg, bg]) => ACCENT_KEYS.includes(fg) || ACCENT_KEYS.includes(bg))
    expect(involved.map(([fg, bg, min]) => `${fg}/${bg}/${min}`).sort()).toEqual(['accent/accentSoft/4.5', 'accent/canvas/4.5', 'accent/surface/4.5', 'focus/canvas/3', 'focus/surface/3', 'onAccent/accent/4.5', 'onAccent/accentHover/4.5'])
    for (const scheme of ['light', 'dark'] as const) expect(accentPasses(scheme, pick(scheme))).toBe(true)
  })

  it.each([
    '#0088cc', '#1a73e8', '#e45735', '#009900', '#ffcc00', '#00aeef', '#7e57c2', '#fafafa', '#111111', '#e5e5e5', '#d1f0ff', '#ff00ff',
  ])('论坛强调色 %s：按配色推导出满足同一对比度门槛的强调色，保留色相', host => {
    for (const scheme of ['light', 'dark'] as const) {
      const accent = deriveAccent(host, scheme)!
      expect(accent, scheme).not.toBeNull()
      expect(accentPasses(scheme, accent)).toBe(true)
      expect([accent.focus, accent.flash]).toEqual([accent.accent, accent.accent])
      for (const key of ['accent', 'accentHover', 'accentSoft', 'onAccent']) expect(accent[key as keyof Accent]).toMatch(/^#[0-9a-f]{6}$/)
      expect(contrast(accent.accent, colors[scheme].surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('已经合格的宿主色原样采用；无效输入不推导', () => {
    expect(deriveAccent('#0063a6', 'light')!.accent).toBe('#0063a6')
    expect(deriveAccent('#75c8ff', 'dark')!.accent).toBe('#75c8ff')
    for (const bad of [undefined, null, '', 'blue', '#fff', '#12345g', 'url(x)']) expect(deriveAccent(bad as string, 'light')).toBeNull()
    expect(rgbToHex('rgb(0, 136, 204)')).toBe('#0088cc')
    expect(rgbToHex('rgba(0, 136, 204, 0.5)')).toBeNull()
    expect(rgbToHex('rgba(0, 0, 0, 0)')).toBeNull()
    expect(rgbToHex('color(srgb 0 0 1)')).toBeNull()
  })
})

describe('组件只用已定义的类', () => {
  const dir = join(__dirname, '../src/ui')
  const source = readdirSync(dir).filter(f => f.endsWith('.tsx')).map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
  const used = new Set([...source.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)).filter(c => c.startsWith('tm-')))
  const styled = new Set([...rules.matchAll(/\.(tm-[a-z0-9-]+)/g)].map(m => m[1]))

  it('组件里的每个类都有样式', () => {
    expect([...used].filter(c => !styled.has(c))).toEqual([])
  })

  it('样式里没有无人使用的类', () => {
    expect([...styled].filter(c => !used.has(c))).toEqual([])
  })

  it('组件里没有内联视觉样式（只允许运行时变量与拖动位移）', () => {
    const inline = [...source.matchAll(/style=\{\{([^}]+)\}\}/g)].map(m => m[1])
    expect(inline.filter(s => !/^\s*('--tm-[a-z-]+'|width|\.\.\.\(offset)/.test(s))).toEqual([])
  })
})
