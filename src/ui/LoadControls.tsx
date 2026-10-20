import { h } from 'preact'
import { useI18n } from './I18n'
import { loadPolicy } from '../core/load-policy'
import type { Prefs } from '../core/storage'

/** 数量只在本次确认里出现；无效输入不写入，提交时仍由原生表单阻止。 */
export function LoadControls({ id, prefs, onPrefs }: { id: string; prefs: Prefs; onPrefs: (next: Partial<Prefs>) => void }) {
  const { t } = useI18n()
  const change = (input: HTMLInputElement) => {
    if (input.validity.valid && Number.isSafeInteger(input.valueAsNumber)) onPrefs({ loadCount: input.valueAsNumber })
  }
  return <>
    <div class="tm-setting"><label htmlFor={`${id}-count`}>{t('load.count')}</label><input id={`${id}-count`} class="tm-number" type="number" required min={1} max={loadPolicy.maxPosts} step={1} value={prefs.loadCount} onInput={e => change(e.currentTarget)} /></div>
    <div class="tm-segmented" role="group" aria-label={t('load.presets')}>{[20, 50, 100].map(count => <button type="button" key={count} aria-pressed={prefs.loadCount === count} onClick={() => onPrefs({ loadCount: count })}>{t('load.posts', { count })}</button>)}</div>
    <p class="tm-note">{t('load.countHint', { max: loadPolicy.maxPosts })}</p>
  </>
}
