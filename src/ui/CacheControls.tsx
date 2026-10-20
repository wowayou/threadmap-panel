import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { cachePolicy, type PostCacheApi } from '../core/post-cache'
import { useI18n } from './I18n'
import { Switch } from './Controls'

export function useCacheState(cache: PostCacheApi | undefined) {
  const [state, set] = useState(() => cache?.get())
  useEffect(() => { if (!cache) return; const sync = () => set(cache.get()); const off = cache.subscribe(sync); sync(); return off }, [cache])
  return state
}

export function CacheControls({ cache }: { cache: PostCacheApi }) {
  const { t, format, locale } = useI18n()
  const state = useCacheState(cache)!
  return <section class="tm-card" aria-label={t('cache.label')}>
    <h2>{t('cache.title')}</h2>
    <Switch id="cache-posts" label={t('cache.allow')} checked={state.enabled} disabled={state.busy && !state.enabled} onChange={() => { void (state.enabled ? cache.disable() : cache.enable()) }} />
    <p class="tm-note">{t('cache.consentHint')}</p>
    <p class="tm-note">{t('cache.privacyHint')}</p>
    <p class="tm-note">{t('cache.budgetHint', { hours: cachePolicy.ttlMs / 3600_000, topics: cachePolicy.maxTopics, posts: cachePolicy.maxPosts.toLocaleString(locale), topicMiB: cachePolicy.topicBytes / 1024 / 1024, totalMiB: cachePolicy.totalBytes / 1024 / 1024 })}</p>
    <p class="tm-note" role="status">{format(state.message)}</p>
    <div class="tm-actions"><button type="button" class="tm-button" onClick={() => { void cache.disable() }}>{t('cache.clear')}</button></div>
    <p class="tm-note">{t('cache.clearHint')}</p>
  </section>
}
