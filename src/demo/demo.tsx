import { h, render } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Badge } from '../core/chain'
import { createSession, type HostApi } from '../core/session'
import { badgeCss } from '../host/badges'
import { Widget } from '../ui/Widget'
import { chainDemoPosts } from './fixture'
import './demo.css'

const prefersDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

/** 本地演示宿主：数据来自 fixture，不发任何请求；面板与真实 UserScript 使用同一个 Widget */
function Demo() {
  const session = useMemo(() => {
    const s = createSession({ origin: 'demo', topicId: 9002, posts: [], stream: chainDemoPosts.map(p => p.id), source: 'demo', scheme: prefersDark() ? 'dark' : 'light' })
    s.mergePosts(chainDemoPosts)
    return s
  }, [])
  const [badges, setBadges] = useState<Map<number, Badge> | null>(null)
  const [scheme, setScheme] = useState(session.get().scheme)
  const [reading, setReading] = useState(1)
  useEffect(() => session.setReading(reading), [reading])
  useEffect(() => session.setScheme(scheme), [scheme])
  useEffect(() => {
    const onScroll = () => {
      let n = 1
      document.querySelectorAll<HTMLElement>('[data-post-number]').forEach(p => { if (p.getBoundingClientRect().top <= window.innerHeight * 0.28) n = Number(p.dataset.postNumber) })
      setReading(n)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const host: HostApi = useMemo(() => ({
    session,
    jump: post => {
      const el = document.querySelector<HTMLElement>(`[data-post-number="${post.postNumber}"]`)
      if (!el) return
      el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
      el.dataset.threadmapScheme = session.get().scheme
      el.classList.add('threadmap-flash'); window.setTimeout(() => el.classList.remove('threadmap-flash'), 1600)
    },
    setBadges,
  }), [session])

  return <>
    <style>{badgeCss}</style>
    <main class="demo-page">
      <header class="demo-header">
        <div><div class="demo-kicker">THREADMAP LAB / DEMO TOPIC</div><h1>成语接龙，一眼看出接到哪了</h1><p>本地演示数据：插话、并行双链、断链、多音字、重复词组和抢楼分叉</p></div>
        <button type="button" class="demo-scheme" aria-pressed={scheme === 'dark'} onClick={() => setScheme(scheme === 'dark' ? 'light' : 'dark')}>{scheme === 'dark' ? '切换到浅色面板' : '切换到深色面板'}</button>
      </header>
      <section class="demo-posts" aria-label="演示主题帖子">
        {chainDemoPosts.map(p => { const badge = badges?.get(p.postNumber); return <article data-post-number={p.postNumber} class="demo-post" key={p.id}>
          <div class="demo-post-head"><span class="demo-avatar" aria-hidden="true">{p.username.slice(0, 1)}</span><b>#{p.postNumber} {p.username}</b><time dateTime={p.createdAt}>{new Date(p.createdAt).toLocaleString('zh-CN')}</time></div>
          <div class="cooked">
            {badge && <button type="button" class={`threadmap-badge ${badge.tone}`} data-scheme={scheme} title={badge.title} aria-label={`ThreadMap：第 ${p.postNumber} 楼 ${badge.label}，点击查看判断`} onClick={() => session.focus(p.postNumber)}>{badge.icon} {badge.label}</button>}
            <p>{p.text}</p>
          </div>
          {p.replyToPostNumber ? <small>回复 #{p.replyToPostNumber}</small> : null}
        </article> })}
      </section>
    </main>
    <div class="demo-root"><Widget host={host} initialMode="open" /></div>
  </>
}

render(<Demo />, document.getElementById('app')!)
