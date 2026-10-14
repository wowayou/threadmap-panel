import { h } from 'preact'
import { CEDICT_VERSION } from '../core/readings-data'
import type { AnnotateMode, DockSide, Prefs, ViewMode } from '../core/storage'

function Switch({ id, checked, label, onChange }: { id: string; checked: boolean; label: string; onChange: () => void }) {
  return <div class="tm-setting"><span id={`tm-${id}`}>{label}</span><button type="button" class="tm-switch" role="switch" aria-checked={checked} aria-labelledby={`tm-${id}`} onClick={onChange} /></div>
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <div class="tm-segmented" role="group" aria-label={label}>{options.map(([v, text]) => <button type="button" key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}</div>
}

export function RulesView({ prefs, qaMode, overrideCount, onPrefs }: { prefs: Prefs; qaMode: boolean; overrideCount: number; onPrefs: (next: Partial<Prefs>) => void }) {
  const { settings } = prefs
  return <>
    <section class="tm-card">
      <h2>工具模式</h2>
      <Segmented<ViewMode> label="工具模式" value={prefs.mode} options={[['auto', '自动'], ['chain', '接龙'], ['qa', '问答']]} onChange={mode => onPrefs({ mode })} />
      <p class="tm-note">“自动”在主题像成语接龙时用接龙模式，否则用问答模式（找出被重复问过的问题）。当前：{qaMode ? '问答' : '接龙'}。</p>
    </section>
    {!qaMode && <section class="tm-card">
      <h2>接龙规则</h2>
      <Switch id="homophone" label="允许同音字接" checked={settings.homophone} onChange={() => onPrefs({ settings: { ...settings, homophone: !settings.homophone } })} />
      {settings.homophone && <Switch id="tone" label="同音时要求同声调" checked={settings.tone} onChange={() => onPrefs({ settings: { ...settings, tone: !settings.tone } })} />}
      <div class="tm-setting"><label htmlFor="tm-window">往回找几个接龙帖</label><select id="tm-window" class="tm-select" value={settings.window} onChange={e => onPrefs({ settings: { ...settings, window: Number((e.currentTarget as HTMLSelectElement).value) } })}>{[3, 5, 8, 12, 20].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
      <p class="tm-note">新帖只和最近这些接龙帖的末字比对：没被接走的优先，其次同字优先于同音，其次更近的优先。超出范围才接上的标“回溯”，接不上的标“断链”；中间有楼没载入时标“前文未载入”，不下结论。</p>
    </section>}
    <section class="tm-card">
      <h2>原帖标注</h2>
      <Segmented<AnnotateMode> label="原帖标注" value={prefs.annotate} options={[['auto', '自动'], ['on', '总是'], ['off', '关闭']]} onChange={annotate => onPrefs({ annotate })} />
      <p class="tm-note">{qaMode ? '在被重复问过的提问上方显示“相似问题见 #12 · 3 条回答”这样的标记，点击查看。' : '在接龙帖正文上方显示“✓ 接 #120 · 同字”这样的标记，点击查看判断。“自动”只在主题看起来是接龙时标注。'}面板收起时标记保留。</p>
    </section>
    <section class="tm-card">
      <h2>停靠位置</h2>
      <Segmented<DockSide> label="停靠位置" value={prefs.dock.side} options={[['left', '左侧'], ['right', '右侧']]} onChange={side => onPrefs({ dock: { ...prefs.dock, side } })} />
      <p class="tm-note">收起后贴在屏幕边缘。也可以直接拖动贴边按钮，松手会吸附到较近的一侧。</p>
    </section>
    <section class="tm-card">
      <h2>数据与隐私</h2>
      <p class="tm-note">只读：不发帖、不写回论坛；只用当前浏览器的登录状态发起同源 GET 请求。帖子内容只在当前页面内存里。本地保存设置和 {overrideCount} 条本主题的手动纠正。</p>
      <p class="tm-note">读音数据来自 CC-CEDICT（{CEDICT_VERSION.slice(0, 10)}，MDBG，CC BY-SA 4.0）；界面使用 Preact（MIT）。完整声明见仓库 THIRD_PARTY_NOTICES.md。作者 wowayou，灵感来自 linux.do 的成语接龙主题。</p>
    </section>
  </>
}
