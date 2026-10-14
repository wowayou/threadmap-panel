/**
 * ThreadMap 设计基准：所有视觉数值的唯一来源。约束见 docs/ui-spec.md，
 * 由 tests/design-contract.test.ts 检查（样式只能引用这里生成的 --tm-* 变量）。
 */

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24 } as const
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const
export const fontSize = { xs: 12, sm: 13, md: 14, lg: 16, xl: 20, xxl: 28 } as const
export const fontWeight = { regular: 400, medium: 600, bold: 700 } as const
export const leading = { none: 1, tight: 1.3, normal: 1.55 } as const
export const motion = { fast: 120, normal: 200 } as const
export const font = 'Inter,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif'

/** 布局尺寸（px） */
export const layout = {
  panelWidth: 380, panelMin: 320, panelMax: 480, panelFullMax: 720,
  header: 48, tabs: 40, status: 36,
  edgeWidth: 36, edgeHeight: 76, edgeGap: 12,
  /** 钉住的小窗（参考 Xbox Game Bar 性能小组件）：标题栏 / 读数 / 底栏，总高固定 */
  hudWidth: 272, hudBar: 32, hudMetrics: 64, hudFoot: 40, hudHeight: 138,
  /** 视口窄于此值时面板占满宽度 */
  narrow: 600,
  target: 32, targetMin: 24,
  nextChar: 56, switchWidth: 40, switchHeight: 24, resizeHandle: 6,
} as const

/** 与 Discourse $z-layers 对齐：header 1000 < ThreadMap < modal overlay 1200 */
export const zIndex = { widget: 1100 } as const

export type Scheme = 'light' | 'dark'

/** 语义色。两套配色键名必须一致；对比度要求见 contrastPairs。 */
export const colors: Record<Scheme, Record<string, string>> = {
  light: {
    canvas: '#f5f8f6', surface: '#ffffff', sunken: '#eef3f0',
    ink: '#1b2f2a', muted: '#4d6660',
    line: '#d5e2db', control: '#7d948d',
    accent: '#0f6b5f', accentHover: '#0b5a50', accentSoft: '#e3f4ec', onAccent: '#ffffff',
    focus: '#a8681a',
    okBg: '#e3f4ec', okFg: '#0d5f54', okLine: '#9fd3c2',
    warnBg: '#fdf0d8', warnFg: '#7a4f0e', warnLine: '#e8c486',
    badBg: '#fbe5df', badFg: '#9a3519', badLine: '#e9ab98',
    neutralBg: '#edf1ef', neutralFg: '#4a5a56', neutralLine: '#c9d4d0',
    shadow: 'rgba(23,59,50,.16)', flash: '#a8681a',
  },
  dark: {
    canvas: '#151b19', surface: '#1c2422', sunken: '#232d2a',
    ink: '#e6efeb', muted: '#a3b5af',
    line: '#33413d', control: '#768a83',
    accent: '#5fd0bc', accentHover: '#7fdcca', accentSoft: '#173a33', onAccent: '#0b1714',
    focus: '#f0b45a',
    okBg: '#173a33', okFg: '#8fe3d1', okLine: '#2f6b5e',
    warnBg: '#3d2e14', warnFg: '#f4cf8e', warnLine: '#7a5a22',
    badBg: '#43221a', badFg: '#f7b4a2', badLine: '#84412f',
    neutralBg: '#262f2d', neutralFg: '#b9c7c2', neutralLine: '#3f4c48',
    shadow: 'rgba(0,0,0,.45)', flash: '#f0b45a',
  },
}

/** [前景, 背景, 最低对比度]。文字 4.5:1，控件边框与焦点环 3:1（WCAG 1.4.3 / 1.4.11） */
export const contrastPairs: [string, string, number][] = [
  ['ink', 'surface', 4.5], ['ink', 'canvas', 4.5], ['muted', 'surface', 4.5], ['muted', 'canvas', 4.5], ['muted', 'sunken', 4.5],
  ['accent', 'surface', 4.5], ['accent', 'canvas', 4.5], ['accent', 'accentSoft', 4.5], ['onAccent', 'accent', 4.5], ['onAccent', 'accentHover', 4.5],
  ['okFg', 'okBg', 4.5], ['warnFg', 'warnBg', 4.5], ['badFg', 'badBg', 4.5], ['neutralFg', 'neutralBg', 4.5],
  ['control', 'surface', 3], ['control', 'canvas', 3], ['focus', 'surface', 3], ['focus', 'canvas', 3],
]

const kebab = (key: string) => key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())

export function schemeVars(scheme: Scheme): string {
  return Object.entries(colors[scheme]).map(([k, v]) => `--tm-c-${kebab(k)}:${v}`).join(';')
}

export function staticVars(): string {
  const entries: [string, string | number][] = [
    ...Object.entries(space).map(([k, v]) => [`space-${k}`, `${v}px`] as [string, string]),
    ...Object.entries(radius).map(([k, v]) => [`radius-${k}`, `${v}px`] as [string, string]),
    ...Object.entries(fontSize).map(([k, v]) => [`fs-${k}`, `${v}px`] as [string, string]),
    ...Object.entries(fontWeight).map(([k, v]) => [`fw-${k}`, v] as [string, number]),
    ...Object.entries(leading).map(([k, v]) => [`lh-${k}`, v] as [string, number]),
    ...Object.entries(motion).map(([k, v]) => [`dur-${k}`, `${v}ms`] as [string, string]),
    ...Object.entries(layout).map(([k, v]) => [kebab(k), `${v}px`] as [string, string]),
    ['z-widget', zIndex.widget],
    ['font', font],
    ['ease', 'cubic-bezier(.2,0,0,1)'],
    ['shadow', '0 8px 28px var(--tm-c-shadow)'],
  ]
  return entries.map(([k, v]) => `--tm-${k}:${v}`).join(';')
}
