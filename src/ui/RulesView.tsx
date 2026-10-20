import { h } from 'preact'
import type { ToolMode } from '../core/analysis'
import type { PostCacheApi } from '../core/post-cache'
import { BUILD_INFO } from '../core/build-info'
import { CEDICT_VERSION } from '../core/readings-data'
import type { AnnotateMode, DockSide, Prefs, ViewMode } from '../core/storage'
import type { LanguagePreference } from '../i18n'
import { Segmented, Switch } from './Controls'
import { CacheControls } from './CacheControls'
import { useI18n } from './I18n'

export function RulesView({ prefs, tool, overrideCount, canLoad, cache, onPrefs }: { prefs: Prefs; tool: ToolMode; overrideCount: number; canLoad: boolean; cache?: PostCacheApi; onPrefs: (next: Partial<Prefs>) => void }) {
  const { t } = useI18n()
  const { settings, qa } = prefs
  const toolName = t(tool === 'qa' ? 'common.qa' : 'common.chain')
  return <>
    <section class="tm-card">
      <h2>{t('settings.language')}</h2>
      <div class="tm-setting"><label htmlFor="tm-language">{t('settings.language')}</label><select id="tm-language" class="tm-select" value={prefs.language} onChange={e => onPrefs({ language: e.currentTarget.value as LanguagePreference })}>
        <option value="auto">{t('settings.followSite')}</option><option value="zh-CN" lang="zh-CN">简体中文</option><option value="en" lang="en">English</option>
      </select></div>
      <p class="tm-note">{t('settings.languageHint')}</p>
    </section>
    <section class="tm-card">
      <h2>{t('settings.mode')}</h2>
      <Segmented<ViewMode> label={t('settings.mode')} value={prefs.mode} options={[[ 'auto', t('common.auto') ], [ 'chain', t('common.chain') ], [ 'qa', t('common.qa') ]]} onChange={mode => onPrefs({ mode })} />
      <p class="tm-note">{t('settings.modeHint', { tool: toolName })}</p>
    </section>
    {tool === 'chain' ? <section class="tm-card">
      <h2>{t('settings.chainRules')}</h2>
      <Switch id="homophone" label={t('settings.homophone')} checked={settings.homophone} onChange={() => onPrefs({ settings: { ...settings, homophone: !settings.homophone } })} />
      {settings.homophone && <Switch id="tone" label={t('settings.tone')} checked={settings.tone} onChange={() => onPrefs({ settings: { ...settings, tone: !settings.tone } })} />}
      <div class="tm-setting"><label htmlFor="tm-window">{t('settings.window')}</label><select id="tm-window" class="tm-select" value={settings.window} onChange={e => onPrefs({ settings: { ...settings, window: Number(e.currentTarget.value) } })}>{[3, 5, 8, 12, 20].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
      <p class="tm-note">{t('settings.chainHint')}</p>
    </section> : <section class="tm-card">
      <h2>{t('settings.qaRules')}</h2>
      <Switch id="qa-approximate" label={t('settings.approximate')} checked={qa.approximate} onChange={() => onPrefs({ qa: { ...qa, approximate: !qa.approximate } })} />
      <Switch id="qa-replies" label={t('settings.replies')} checked={qa.associateReplies} onChange={() => onPrefs({ qa: { ...qa, associateReplies: !qa.associateReplies } })} />
      <p class="tm-note">{t('settings.qaHint')}</p>
    </section>}
    <section class="tm-card">
      <h2>{t('settings.badges')}</h2>
      <Segmented<AnnotateMode> label={t('settings.badges')} value={prefs.annotate[tool]} options={[[ 'auto', t('common.auto') ], [ 'on', t('settings.always') ], [ 'off', t('settings.off') ]]} onChange={annotate => onPrefs({ annotate: { ...prefs.annotate, [tool]: annotate } })} />
      <p class="tm-note">{t('settings.badgesHint', { tool: toolName })}{t(tool === 'qa' ? 'settings.qaBadges' : 'settings.chainBadges')}</p>
    </section>
    <section class="tm-card">
      <h2>{t('settings.dock')}</h2>
      <Segmented<DockSide> label={t('settings.dock')} value={prefs.dock.side} options={[[ 'left', t('settings.left') ], [ 'right', t('settings.right') ]]} onChange={side => onPrefs({ dock: { ...prefs.dock, side } })} />
      <p class="tm-note">{t('settings.dockHint')}</p>
    </section>
    {canLoad && <section class="tm-card">
      <h2>{t('settings.load')}</h2>
      <Switch id="allow-load" label={t('settings.allowLoad')} checked={prefs.allowLoad} onChange={() => onPrefs({ allowLoad: !prefs.allowLoad })} />
      <p class="tm-note">{t('settings.loadHint')}</p>
    </section>}
    {cache && <CacheControls cache={cache} />}
    <section class="tm-card">
      <h2>{t('settings.privacy')}</h2>
      <p class="tm-note">{t('settings.privacyHint', { count: overrideCount })}</p>
      <p class="tm-note">{t('settings.build', { build: BUILD_INFO.packaged ? `${BUILD_INFO.version} · ${BUILD_INFO.id}` : t('settings.devBuild') })}</p>
      <p class="tm-note">{t('settings.credits', { date: CEDICT_VERSION.slice(0, 10) })}</p>
    </section>
  </>
}
