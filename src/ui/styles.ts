import { colors, schemeVars, staticVars, type Scheme } from './tokens'

/**
 * 面板样式（注入 Shadow DOM）。规则：颜色、字号、字重、行高、间距、圆角、层级、时长
 * 只能用 --tm-* 变量；变量只在本文件开头的“基准区”由 tokens.ts 生成。
 * tests/design-contract.test.ts 会检查这一点。
 */

const prelude = `
:host{all:initial}
.tm-root{${staticVars()};${schemeVars('light')}}
.tm-root[data-scheme=dark]{${schemeVars('dark')}}
`

const rules = `
.tm-root{display:contents;font-family:var(--tm-font);font-size:var(--tm-fs-sm);line-height:var(--tm-lh-normal);color:var(--tm-c-ink)}
.tm-root *,.tm-root *::before,.tm-root *::after{box-sizing:border-box}
.tm-root button,.tm-root input,.tm-root select{font:inherit;color:inherit;letter-spacing:inherit}
.tm-root :focus-visible{outline:2px solid var(--tm-c-focus);outline-offset:2px}
.tm-root [hidden]{display:none!important}

/* ── 面板：固定于论坛 header 之下、编辑器之上 ── */
.tm-panel{position:fixed;z-index:var(--tm-z-widget);top:var(--tm-top,0px);bottom:var(--tm-bottom,0px);right:0;width:min(var(--tm-w,var(--tm-panel-width)),100vw);display:grid;grid-template-rows:var(--tm-header) var(--tm-tabs) var(--tm-status) minmax(0,1fr);background:var(--tm-c-canvas);border-left:1px solid var(--tm-c-line);box-shadow:var(--tm-shadow);animation:tm-in-right var(--tm-dur-normal) var(--tm-ease)}
.tm-panel[data-side=left]{right:auto;left:0;border-left:0;border-right:1px solid var(--tm-c-line);animation-name:tm-in-left}
.tm-panel[data-mode=full]{left:0;right:0;width:auto;border-left:0;border-right:0}
@media (max-width:600px){.tm-panel,.tm-panel[data-side=left]{left:0;right:0;width:auto;border-left:0;border-right:0}}
@keyframes tm-in-right{from{transform:translateX(var(--tm-space-5));opacity:0}to{transform:none;opacity:1}}
@keyframes tm-in-left{from{transform:translateX(calc(-1 * var(--tm-space-5)));opacity:0}to{transform:none;opacity:1}}

.tm-resize{position:absolute;top:0;bottom:0;left:0;width:var(--tm-resize-handle);cursor:ew-resize;z-index:var(--tm-z-widget);background:transparent;border:0;padding:0}
.tm-panel[data-side=left] .tm-resize{left:auto;right:0}
.tm-resize:hover,.tm-resize:focus-visible{background:var(--tm-c-accent-soft)}
.tm-panel[data-mode=full] .tm-resize{display:none}
@media (max-width:600px){.tm-resize{display:none}}

/* ── 固定区域 ── */
.tm-header{display:flex;align-items:center;gap:var(--tm-space-2);padding:0 var(--tm-space-2) 0 var(--tm-space-4);background:var(--tm-c-surface);border-bottom:1px solid var(--tm-c-line);min-width:0}
.tm-title{display:flex;align-items:baseline;gap:var(--tm-space-2);flex:1;min-width:0;margin:0;font-size:var(--tm-fs-lg);font-weight:var(--tm-fw-bold);line-height:var(--tm-lh-tight);white-space:nowrap}
.tm-title small{overflow:hidden;text-overflow:ellipsis;font-size:var(--tm-fs-xs);font-weight:var(--tm-fw-regular);color:var(--tm-c-muted)}
.tm-icon{display:inline-grid;place-items:center;width:var(--tm-target);height:var(--tm-target);flex:none;padding:0;border:0;border-radius:var(--tm-radius-sm);background:transparent;color:var(--tm-c-muted);font-size:var(--tm-fs-lg);line-height:var(--tm-lh-none);cursor:pointer}
.tm-icon:hover{background:var(--tm-c-sunken);color:var(--tm-c-ink)}
@media (max-width:600px){.tm-icon[data-action=full]{display:none}}

.tm-tabs{display:grid;grid-template-columns:repeat(3,1fr);background:var(--tm-c-surface);border-bottom:1px solid var(--tm-c-line)}
.tm-tab{position:relative;display:flex;align-items:center;justify-content:center;gap:var(--tm-space-1);padding:0;border:0;background:transparent;color:var(--tm-c-muted);font-size:var(--tm-fs-sm);font-weight:var(--tm-fw-medium);cursor:pointer}
.tm-tab:hover{color:var(--tm-c-ink);background:var(--tm-c-sunken)}
.tm-tab[aria-selected=true]{color:var(--tm-c-accent)}
.tm-tab[aria-selected=true]::after{content:"";position:absolute;left:var(--tm-space-4);right:var(--tm-space-4);bottom:-1px;height:2px;border-radius:var(--tm-radius-pill);background:var(--tm-c-accent)}
.tm-count{min-width:var(--tm-space-5);padding:0 var(--tm-space-1);border-radius:var(--tm-radius-pill);background:var(--tm-c-warn-bg);color:var(--tm-c-warn-fg);font-size:var(--tm-fs-xs);font-weight:var(--tm-fw-bold);line-height:var(--tm-lh-normal);text-align:center}

.tm-status{position:relative;display:flex;align-items:center;gap:var(--tm-space-2);padding:0 var(--tm-space-3) 0 var(--tm-space-4);background:var(--tm-c-canvas);border-bottom:1px solid var(--tm-c-line);font-size:var(--tm-fs-xs);color:var(--tm-c-muted);min-width:0}
.tm-status-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tm-status .tm-button{min-height:var(--tm-target-min);padding:0 var(--tm-space-2);font-size:var(--tm-fs-xs)}
.tm-progress{position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--tm-c-line)}
.tm-progress i{display:block;height:100%;background:var(--tm-c-accent);transition:width var(--tm-dur-fast) linear}

/* ── 内容区：唯一的滚动区域 ── */
.tm-body{overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:var(--tm-space-3) var(--tm-space-4) var(--tm-space-5);scrollbar-gutter:stable}
.tm-panel[data-mode=full] .tm-stack{max-width:var(--tm-panel-full-max);margin:0 auto}
.tm-stack{display:flex;flex-direction:column;gap:var(--tm-space-3)}

/* ── 通用组件 ── */
.tm-button{display:inline-flex;align-items:center;justify-content:center;gap:var(--tm-space-1);min-height:var(--tm-target);padding:0 var(--tm-space-3);border:1px solid var(--tm-c-control);border-radius:var(--tm-radius-sm);background:var(--tm-c-surface);color:var(--tm-c-accent);font-size:var(--tm-fs-sm);font-weight:var(--tm-fw-medium);white-space:nowrap;cursor:pointer;transition:background var(--tm-dur-fast),border-color var(--tm-dur-fast)}
.tm-button:hover{background:var(--tm-c-accent-soft)}
.tm-button[data-variant=primary]{background:var(--tm-c-accent);border-color:var(--tm-c-accent);color:var(--tm-c-on-accent)}
.tm-button[data-variant=primary]:hover{background:var(--tm-c-accent-hover);border-color:var(--tm-c-accent-hover)}
.tm-button:disabled{opacity:.5;cursor:not-allowed}
.tm-link{display:inline;padding:0;border:0;background:none;color:var(--tm-c-accent);font-weight:var(--tm-fw-medium);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.tm-actions{display:flex;flex-wrap:wrap;gap:var(--tm-space-2)}
.tm-note{margin:0;font-size:var(--tm-fs-xs);color:var(--tm-c-muted)}

.tm-card{display:flex;flex-direction:column;gap:var(--tm-space-2);padding:var(--tm-space-3);border:1px solid var(--tm-c-line);border-radius:var(--tm-radius-md);background:var(--tm-c-surface)}
.tm-card h2,.tm-card h3{margin:0;font-size:var(--tm-fs-md);font-weight:var(--tm-fw-bold);line-height:var(--tm-lh-tight)}
.tm-eyebrow{font-size:var(--tm-fs-xs);font-weight:var(--tm-fw-bold);color:var(--tm-c-accent)}

.tm-banner{display:flex;flex-direction:column;align-items:flex-start;gap:var(--tm-space-1);padding:var(--tm-space-2) var(--tm-space-3);border:1px solid var(--tm-c-neutral-line);border-radius:var(--tm-radius-md);background:var(--tm-c-neutral-bg);color:var(--tm-c-neutral-fg);font-size:var(--tm-fs-xs)}
.tm-banner[data-tone=warn]{border-color:var(--tm-c-warn-line);background:var(--tm-c-warn-bg);color:var(--tm-c-warn-fg)}
.tm-banner[data-tone=bad]{border-color:var(--tm-c-bad-line);background:var(--tm-c-bad-bg);color:var(--tm-c-bad-fg)}
.tm-banner b{font-weight:var(--tm-fw-bold)}

.tm-chip{display:inline-flex;align-items:center;gap:var(--tm-space-1);align-self:flex-start;padding:0 var(--tm-space-2);border:1px solid var(--tm-c-neutral-line);border-radius:var(--tm-radius-pill);background:var(--tm-c-neutral-bg);color:var(--tm-c-neutral-fg);font-size:var(--tm-fs-xs);font-weight:var(--tm-fw-medium);line-height:var(--tm-lh-normal)}
.tm-chip[data-tone=ok]{border-color:var(--tm-c-ok-line);background:var(--tm-c-ok-bg);color:var(--tm-c-ok-fg)}
.tm-chip[data-tone=warn]{border-color:var(--tm-c-warn-line);background:var(--tm-c-warn-bg);color:var(--tm-c-warn-fg)}
.tm-chip[data-tone=bad]{border-color:var(--tm-c-bad-line);background:var(--tm-c-bad-bg);color:var(--tm-c-bad-fg)}

/* 现在该接 */
.tm-next{display:grid;grid-template-columns:var(--tm-next-char) minmax(0,1fr);gap:var(--tm-space-3);align-items:center}
.tm-next-char{display:grid;place-items:center;width:var(--tm-next-char);height:var(--tm-next-char);border-radius:var(--tm-radius-lg);background:var(--tm-c-accent);color:var(--tm-c-on-accent);font-size:var(--tm-fs-xxl);font-weight:var(--tm-fw-bold);line-height:var(--tm-lh-none)}
.tm-next-info{display:flex;flex-direction:column;min-width:0}
.tm-next-info strong{font-size:var(--tm-fs-md);font-weight:var(--tm-fw-bold)}
.tm-next-info span{font-size:var(--tm-fs-xs);color:var(--tm-c-muted)}
.tm-parallel{display:flex;flex-direction:column;gap:var(--tm-space-2);padding-top:var(--tm-space-2);border-top:1px dashed var(--tm-c-line);font-size:var(--tm-fs-xs);color:var(--tm-c-muted)}
.tm-parallel ul{display:flex;flex-wrap:wrap;gap:var(--tm-space-2);margin:0;padding:0;list-style:none}
.tm-pill-button{display:inline-flex;align-items:center;gap:var(--tm-space-2);min-height:var(--tm-target);padding:0 var(--tm-space-2);border:1px solid var(--tm-c-control);border-radius:var(--tm-radius-sm);background:var(--tm-c-surface);color:var(--tm-c-muted);font-size:var(--tm-fs-xs);cursor:pointer}
.tm-pill-button b{font-size:var(--tm-fs-lg);color:var(--tm-c-accent)}
.tm-pill-button:hover{background:var(--tm-c-accent-soft)}

/* 试接 */
.tm-field{display:flex;flex-direction:column;gap:var(--tm-space-1)}
.tm-field label{font-size:var(--tm-fs-xs);font-weight:var(--tm-fw-medium);color:var(--tm-c-muted)}
.tm-field-row{display:flex;gap:var(--tm-space-2)}
.tm-input{flex:1;min-width:0;min-height:var(--tm-target);padding:0 var(--tm-space-3);border:1px solid var(--tm-c-control);border-radius:var(--tm-radius-sm);background:var(--tm-c-surface);color:var(--tm-c-ink);font-size:var(--tm-fs-md)}
.tm-input::placeholder{color:var(--tm-c-muted)}
.tm-results{display:flex;flex-direction:column;gap:var(--tm-space-1);margin:0;padding:0;list-style:none}
.tm-results:empty{display:none}
.tm-result{padding:var(--tm-space-1) var(--tm-space-2);border-radius:var(--tm-radius-sm);font-size:var(--tm-fs-xs);background:var(--tm-c-neutral-bg);color:var(--tm-c-neutral-fg)}
.tm-result[data-tone=ok]{background:var(--tm-c-ok-bg);color:var(--tm-c-ok-fg)}
.tm-result[data-tone=warn]{background:var(--tm-c-warn-bg);color:var(--tm-c-warn-fg)}
.tm-result[data-tone=bad]{background:var(--tm-c-bad-bg);color:var(--tm-c-bad-fg)}

/* 统计行 */
.tm-summary{display:flex;align-items:center;justify-content:space-between;gap:var(--tm-space-2);min-height:var(--tm-target);padding:var(--tm-space-1) var(--tm-space-1) var(--tm-space-1) var(--tm-space-3);border:1px solid var(--tm-c-line);border-radius:var(--tm-radius-md);background:var(--tm-c-surface);font-size:var(--tm-fs-xs);color:var(--tm-c-muted)}
.tm-good{padding-right:var(--tm-space-2);color:var(--tm-c-ok-fg);font-weight:var(--tm-fw-medium)}

/* 详情 */
.tm-detail-head{display:flex;align-items:center;justify-content:space-between;gap:var(--tm-space-2)}
.tm-detail-head h3:focus{outline:none}
.tm-detail-head h3:focus-visible{outline:2px solid var(--tm-c-focus);outline-offset:2px}
.tm-phrases{display:flex;flex-wrap:wrap;gap:var(--tm-space-1)}
.tm-phrases span{padding:0 var(--tm-space-2);border-radius:var(--tm-radius-sm);background:var(--tm-c-sunken);font-size:var(--tm-fs-md)}
.tm-reason{margin:0;font-size:var(--tm-fs-sm)}
.tm-facts{display:grid;grid-template-columns:auto 1fr;gap:var(--tm-space-1) var(--tm-space-3);margin:0;font-size:var(--tm-fs-xs)}
.tm-facts dt{color:var(--tm-c-muted)}
.tm-facts dd{margin:0}
.tm-inner{padding:var(--tm-space-2);border-radius:var(--tm-radius-sm);background:var(--tm-c-warn-bg);color:var(--tm-c-warn-fg);font-size:var(--tm-fs-xs)}
.tm-correct{display:flex;flex-wrap:wrap;gap:var(--tm-space-2);padding-top:var(--tm-space-3);border-top:1px solid var(--tm-c-line)}
.tm-pick{display:flex;flex-direction:column;gap:var(--tm-space-2);width:100%}
.tm-pick p{margin:0;font-size:var(--tm-fs-xs);font-weight:var(--tm-fw-medium);color:var(--tm-c-muted)}
.tm-pick ul{display:flex;flex-direction:column;gap:var(--tm-space-1);margin:0;padding:0;list-style:none}
.tm-pick-item{width:100%;min-height:var(--tm-target);padding:0 var(--tm-space-3);border:1px solid var(--tm-c-line);border-radius:var(--tm-radius-sm);background:var(--tm-c-surface);color:var(--tm-c-muted);font-size:var(--tm-fs-xs);text-align:left;cursor:pointer}
.tm-pick-item[data-match=true]{border-color:var(--tm-c-ok-line);color:var(--tm-c-ok-fg);font-weight:var(--tm-fw-medium)}
.tm-pick-item:hover{background:var(--tm-c-sunken)}

/* 分段选择（筛选、标注模式、停靠方向） */
.tm-segmented{display:flex;flex-wrap:wrap;gap:var(--tm-space-1)}
.tm-segmented button{min-height:var(--tm-target);padding:0 var(--tm-space-3);border:1px solid var(--tm-c-line);border-radius:var(--tm-radius-sm);background:var(--tm-c-surface);color:var(--tm-c-muted);font-size:var(--tm-fs-xs);cursor:pointer}
.tm-segmented button:hover{background:var(--tm-c-sunken)}
.tm-segmented button[aria-pressed=true]{border-color:var(--tm-c-accent);background:var(--tm-c-accent-soft);color:var(--tm-c-accent);font-weight:var(--tm-fw-bold)}

/* 问题列表 */
.tm-toolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--tm-space-2);font-size:var(--tm-fs-xs);color:var(--tm-c-muted)}
.tm-issues{display:flex;flex-direction:column;gap:var(--tm-space-2);margin:0;padding:0;list-style:none}
.tm-issue{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--tm-space-2);align-items:center;padding:var(--tm-space-2) var(--tm-space-2) var(--tm-space-2) var(--tm-space-3);border:1px solid var(--tm-c-line);border-left:3px solid var(--tm-c-warn-line);border-radius:var(--tm-radius-md);background:var(--tm-c-surface)}
.tm-issue[data-kind=break]{border-left-color:var(--tm-c-bad-line)}
.tm-issue[data-kind=repeat],.tm-issue[data-kind=inner]{border-left-color:var(--tm-c-neutral-line)}
.tm-issue-main{min-width:0}
.tm-issue-main b{font-size:var(--tm-fs-sm);font-weight:var(--tm-fw-bold)}
.tm-issue-main p{margin:0;font-size:var(--tm-fs-xs);color:var(--tm-c-muted)}
.tm-kind{display:inline-block;margin-right:var(--tm-space-1);padding:0 var(--tm-space-1);border-radius:var(--tm-radius-sm);background:var(--tm-c-sunken);color:var(--tm-c-muted);font-size:var(--tm-fs-xs);font-weight:var(--tm-fw-bold)}
.tm-issue-actions{display:flex;flex-direction:column;gap:var(--tm-space-1)}
.tm-issue-actions .tm-button{min-height:var(--tm-target-min);padding:0 var(--tm-space-2);font-size:var(--tm-fs-xs)}
.tm-pager{display:flex;align-items:center;justify-content:center;gap:var(--tm-space-3);font-size:var(--tm-fs-xs);color:var(--tm-c-muted)}

/* 规则 */
.tm-setting{display:flex;align-items:center;justify-content:space-between;gap:var(--tm-space-3);min-height:var(--tm-target);padding:var(--tm-space-1) 0;border-top:1px solid var(--tm-c-line)}
.tm-setting:first-of-type{border-top:0}
.tm-switch{position:relative;flex:none;width:var(--tm-switch-width);height:var(--tm-switch-height);padding:0;border:1px solid var(--tm-c-control);border-radius:var(--tm-radius-pill);background:var(--tm-c-sunken);cursor:pointer}
.tm-switch::after{content:"";position:absolute;top:2px;left:2px;width:calc(var(--tm-switch-height) - 6px);height:calc(var(--tm-switch-height) - 6px);border-radius:var(--tm-radius-pill);background:var(--tm-c-control);transition:transform var(--tm-dur-fast) var(--tm-ease)}
.tm-switch[aria-checked=true]{border-color:var(--tm-c-accent);background:var(--tm-c-accent)}
.tm-switch[aria-checked=true]::after{background:var(--tm-c-on-accent);transform:translateX(calc(var(--tm-switch-width) - var(--tm-switch-height)))}
.tm-select{min-height:var(--tm-target);padding:0 var(--tm-space-2);border:1px solid var(--tm-c-control);border-radius:var(--tm-radius-sm);background:var(--tm-c-surface);color:var(--tm-c-ink);font-size:var(--tm-fs-sm)}

.tm-empty{display:flex;flex-direction:column;gap:var(--tm-space-1);padding:var(--tm-space-5) var(--tm-space-4);border:1px dashed var(--tm-c-control);border-radius:var(--tm-radius-md);text-align:center;color:var(--tm-c-muted);font-size:var(--tm-fs-sm)}
.tm-empty strong{color:var(--tm-c-ink);font-size:var(--tm-fs-md)}

/* ── 贴边按钮 ── */
.tm-edge{position:fixed;z-index:var(--tm-z-widget);right:0;top:clamp(calc(var(--tm-top,0px) + var(--tm-edge-gap)),calc(var(--tm-top,0px) + var(--tm-edge-gap) + (100vh - var(--tm-top,0px) - var(--tm-bottom,0px) - var(--tm-edge-height) - 2 * var(--tm-edge-gap)) * var(--tm-edge-ratio,.4)),calc(100vh - var(--tm-bottom,0px) - var(--tm-edge-height) - var(--tm-edge-gap)));width:var(--tm-edge-width);height:var(--tm-edge-height);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--tm-space-1);padding:0;border:1px solid var(--tm-c-line);border-right:0;border-radius:var(--tm-radius-md) 0 0 var(--tm-radius-md);background:var(--tm-c-surface);color:var(--tm-c-accent);box-shadow:var(--tm-shadow);cursor:grab;touch-action:none;user-select:none;transition:background var(--tm-dur-fast)}
.tm-edge[data-side=left]{right:auto;left:0;border-right:1px solid var(--tm-c-line);border-left:0;border-radius:0 var(--tm-radius-md) var(--tm-radius-md) 0}
/* 悬停与聚焦只改颜色，不改尺寸（固定几何，见 ui-spec §3） */
.tm-edge:hover,.tm-edge:focus-visible{background:var(--tm-c-accent-soft)}
.tm-edge:focus-visible{outline-offset:-3px}
.tm-edge[data-dragging=true]{transition:none;cursor:grabbing;opacity:.9}
.tm-edge-char{font-size:var(--tm-fs-lg);font-weight:var(--tm-fw-bold);line-height:var(--tm-lh-none)}
.tm-edge .tm-count{min-width:0}

/* ── 钉住的小窗（参考 Xbox Game Bar 性能小组件；背景不透明，见 ui-spec §2） ── */
.tm-hud{position:fixed;z-index:var(--tm-z-widget);right:var(--tm-edge-gap);top:clamp(calc(var(--tm-top,0px) + var(--tm-edge-gap)),calc(var(--tm-top,0px) + var(--tm-edge-gap) + (100vh - var(--tm-top,0px) - var(--tm-bottom,0px) - var(--tm-hud-height) - 2 * var(--tm-edge-gap)) * var(--tm-edge-ratio,.4)),calc(100vh - var(--tm-bottom,0px) - var(--tm-hud-height) - var(--tm-edge-gap)));width:min(var(--tm-hud-width),calc(100vw - 2 * var(--tm-edge-gap)));height:var(--tm-hud-height);display:grid;grid-template-rows:var(--tm-hud-bar) var(--tm-hud-metrics) var(--tm-hud-foot);border:1px solid var(--tm-c-line);border-radius:var(--tm-radius-lg);background:var(--tm-c-surface);box-shadow:var(--tm-shadow);overflow:hidden;animation:tm-in-right var(--tm-dur-normal) var(--tm-ease)}
.tm-hud[data-side=left]{right:auto;left:var(--tm-edge-gap);animation-name:tm-in-left}
.tm-hud[data-dragging=true]{animation:none;opacity:.92}
.tm-hud-bar{display:flex;align-items:center;gap:var(--tm-space-1);padding:0 var(--tm-space-1) 0 var(--tm-space-3);background:var(--tm-c-sunken);cursor:grab;touch-action:none;user-select:none}
.tm-hud[data-dragging=true] .tm-hud-bar{cursor:grabbing}
.tm-hud-title{flex:1;min-width:0;font-size:var(--tm-fs-xs);font-weight:var(--tm-fw-bold);color:var(--tm-c-muted)}
.tm-hud-bar .tm-icon{width:var(--tm-target-min);height:var(--tm-target-min);font-size:var(--tm-fs-sm)}
.tm-hud-metrics{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid var(--tm-c-line)}
.tm-metric{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:var(--tm-space-1);min-width:0;padding:0 var(--tm-space-3);border:0;border-right:1px solid var(--tm-c-line);background:transparent;text-align:left;cursor:pointer}
.tm-metric:last-child{border-right:0}
.tm-metric:hover{background:var(--tm-c-accent-soft)}
.tm-metric b{font-size:var(--tm-fs-xl);font-weight:var(--tm-fw-bold);line-height:var(--tm-lh-none);color:var(--tm-c-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.tm-metric:first-child b{color:var(--tm-c-accent)}
.tm-metric span{font-size:var(--tm-fs-xs);color:var(--tm-c-muted);white-space:nowrap}
.tm-hud-foot{display:flex;align-items:center;gap:var(--tm-space-2);padding:0 var(--tm-space-2) 0 var(--tm-space-3);min-width:0}
.tm-hud-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--tm-fs-xs);color:var(--tm-c-muted)}
.tm-hud-foot .tm-button{min-height:var(--tm-target-min);padding:0 var(--tm-space-2);font-size:var(--tm-fs-xs)}

@media (prefers-reduced-motion:reduce){.tm-root *{animation:none!important;transition:none!important}}
`

export const panelCss = prelude + rules
/** 仅供设计契约测试读取：基准区与规则区分开检查 */
export const cssParts = { prelude, rules }

/** 宿主页面（论坛正文）中的标注样式：不在 Shadow DOM 内，直接使用基准色值 */
export function badgeCss(prefix = 'threadmap-badge'): string {
  const tone = (scheme: Scheme, name: 'ok' | 'warn' | 'bad' | 'neutral') => {
    const c = colors[scheme]
    return `background:${c[name + 'Bg']};color:${c[name + 'Fg']};border-color:${c[name + 'Line']}`
  }
  const block = (scheme: Scheme, sel: string) => `
${sel}.${prefix}.ok{${tone(scheme, 'ok')}}
${sel}.${prefix}.warn{${tone(scheme, 'warn')}}
${sel}.${prefix}.bad{${tone(scheme, 'bad')}}
${sel}.${prefix}.muted{${tone(scheme, 'neutral')}}`
  return `
.${prefix}{display:inline-flex;align-items:center;gap:4px;margin:0 0 8px;padding:0 8px;border:1px solid transparent;border-radius:999px;font:600 12px/1.55 ${'Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif'};cursor:pointer;user-select:none}
.${prefix}:focus-visible{outline:2px solid ${colors.light.focus};outline-offset:2px}
.${prefix}[data-scheme=dark]:focus-visible{outline-color:${colors.dark.focus}}
${block('light', '')}
${block('dark', '[data-scheme=dark]')}
.threadmap-flash{outline:2px solid ${colors.light.flash}!important;outline-offset:4px;border-radius:${8}px;transition:outline-color 1.6s}
.threadmap-flash[data-threadmap-scheme=dark]{outline-color:${colors.dark.flash}!important}
`
}
