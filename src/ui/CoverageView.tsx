import { h } from 'preact'
import { useI18n } from './I18n'
import type { PostCoverage } from '../core/session'

/** 显示证据范围，不冒充论坛阅读进度；每格是平台顺序的一段，不可点击或用于导航。 */
export function CoverageView({ coverage }: { coverage: PostCoverage }) {
  const { t } = useI18n()
  const { loaded, total, missing, bands } = coverage
  const summary = total === undefined ? t('coverage.unknown', { loaded }) : t('coverage.known', { loaded, total, missing: missing ?? 0 })
  return <section class="tm-card tm-coverage" aria-label={t('coverage.title')}>
    <details>
      <summary>{t('coverage.title')} · {loaded} / {total ?? '?'}</summary>
      <p class="tm-note">{summary}</p>
      {bands.length > 0 && <p class="tm-note">{t('coverage.legend')}</p>}
      {(total === undefined || !!missing || !loaded) && <p class="tm-note">{t('coverage.hint')}</p>}
    </details>
    {bands.length > 0 && <div class="tm-range" role="img" aria-label={t('coverage.description', { summary })}>{bands.map(band => <span key={band.start} data-state={band.loaded === 0 ? 'empty' : band.loaded === band.total ? 'full' : 'partial'} title={t('coverage.band', band)} />)}</div>}
  </section>
}
