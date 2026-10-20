// @vitest-environment jsdom
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildChain, badgeFor } from '../src/core/chain'
import { createSession, type HostApi } from '../src/core/session'
import { readPrefs } from '../src/core/storage'
import { buildQa, questionText, tokens } from '../src/core/questions'
import type { Post } from '../src/core/types'
import { formatText, i18n, messages, message, resolveLocale } from '../src/i18n'
import { LoadError } from '../src/host/loader'
import { watchSiteLanguage } from '../src/host/locale'
import { Widget } from '../src/ui/Widget'

const post = (n: number, text: string, reply?: number): Post => ({ id: 100 + n, postNumber: n, username: `user${n}`, createdAt: '', raw: '', text, topicId: 7, origin: 'https://forum.example', replyToPostNumber: reply })
afterEach(() => { act(() => render(null, document.body)); localStorage.clear(); vi.restoreAllMocks() })

describe('本地化消息契约', () => {
  it('两种语言覆盖所有键，具名插值一致，不提供 HTML/远程资源模板', () => {
    for (const [key, pair] of Object.entries(messages)) {
      const slots = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort()
      expect(pair).toHaveLength(2)
      expect(pair.every(text => text.length > 0), key).toBe(true)
      expect(slots(pair[0]), key).toEqual(slots(pair[1]))
      expect(pair.join(' '), key).not.toMatch(/<\/?[a-z][^>]*>|https?:\/\//i)
      for (const locale of ['en', 'zh-CN'] as const) {
        const text = formatText(locale, { key: key as keyof typeof messages, values: Object.fromEntries(slots(pair[0]).map(slot => [slot, 2])) })
        expect(text, key).not.toMatch(/\{\w+\}/)
      }
    }
  })
  it('论坛语言优先、缺失才用浏览器；不支持的论坛语言回退英文，不按域名猜', () => {
    expect(resolveLocale('auto', 'zh_CN', ['en-US'])).toBe('zh-CN')
    expect(resolveLocale('auto', 'en-GB', ['zh-CN'])).toBe('en')
    expect(resolveLocale('auto', 'de-DE', ['zh-CN'])).toBe('en')
    expect(resolveLocale('auto', '', ['zh-Hans'])).toBe('zh-CN')
    expect(resolveLocale('auto')).toBe('en')
    expect(resolveLocale('zh-CN', 'en')).toBe('zh-CN')
    expect(resolveLocale('en', 'zh-CN')).toBe('en')
    localStorage.setItem('threadmap-prefs-v2', JSON.stringify({ language: 'bad' }))
    expect(readPrefs().language).toBe('auto')
  })
  it('理由与错误到显示时才选语言，参数作为文字不执行、不二次解析', () => {
    const error = new LoadError(message('error.http', { action: message('error.readPosts'), status: 403 }), 403)
    expect(error.message).toBe('楼层读取失败（403）')
    expect(formatText('en', error.text)).toBe('Post read failed (403)')
    expect(i18n('en').t('hud.asked', { count: 2, text: '{count}<script>untrusted</script>' })).toBe('Asked 2 times: {count}<script>untrusted</script>')
    const chain = buildChain([post(1, '一心一意'), post(2, '意气风发')])
    expect(badgeFor(chain.order[1], chain, 'en').label).toContain('Same character')
    expect(formatText('en', chain.order[1].reason)).toContain('Follows #1')
    expect(formatText('zh-CN', chain.order[1].reason)).toContain('同字接 #1')
    expect(i18n('en')).toBe(i18n('en'))
  })
  it('语言观察只看 html lang；停止后不再通知', async () => {
    document.documentElement.lang = 'en'
    const change = vi.fn(), stop = watchSiteLanguage(change)
    expect(change).toHaveBeenLastCalledWith('en')
    document.documentElement.lang = 'zh-CN'; await Promise.resolve()
    expect(change).toHaveBeenLastCalledWith('zh-CN')
    stop(); change.mockClear(); document.documentElement.lang = 'en'; await Promise.resolve()
    expect(change).not.toHaveBeenCalled()
  })
})

describe('英文社区的本地问答', () => {
  it('保留提问内容而非通用疑问词，降低 enable/disable 等不同操作的误分', () => {
    expect(questionText('How do I enable notifications?')).toBe('How do I enable notifications?')
    expect(tokens('How do I enable notifications?')).toEqual(['enable', 'notifications'])
    const qa = buildQa([post(1, 'Topic'), post(2, 'How do I enable notifications?'), post(3, 'How do I disable notifications?'), post(4, 'Where can I enable notifications?')])
    expect(qa.clusterOf.get(102)).toBe(qa.clusterOf.get(104))
    expect(qa.clusterOf.get(102)).not.toBe(qa.clusterOf.get(103))
    expect(qa.search('enable notifications')[0].cluster.questionIds).toEqual([102, 104])
  })
  it('英文错误码和回复结构仍遵循同一证据边界', () => {
    const qa = buildQa([post(1, 'Topic'), post(2, 'How can I fix HTTP error 403?'), post(3, 'How can I fix HTTP error 429?'), post(4, 'Check your permissions.', 2)])
    expect(qa.clusterOf.get(102)).not.toBe(qa.clusterOf.get(103))
    expect(qa.clusterOf.get(102)?.answerEvidence.get(104)).toEqual([{ questionId: 102, kind: 'reply' }])
  })
})

describe('语言是展示选项，不是分析/网络开关', () => {
  it('切语言保留查询与当前回复、不重跑引擎、不抢焦点；宿主语言变化自动跟随', async () => {
    const chainModule = await import('../src/core/chain'), qaModule = await import('../src/core/questions')
    const chain = vi.spyOn(chainModule, 'buildChain'), qa = vi.spyOn(qaModule, 'buildQa')
    const session = createSession({ origin: 'https://forum.example', topicId: 7, posts: [post(1, 'Topic'), post(2, 'How do I install the script?'), post(3, 'Install the browser extension.', 2), post(4, 'How do I install the script?')], source: 'store', scheme: 'light', siteLanguage: 'en' })
    const host: HostApi = { session, loadAll: vi.fn(), setBadges: vi.fn(), navigation: { href: () => undefined, reveal: vi.fn(() => false) } }
    act(() => render(h(Widget, { host, initialMode: 'open' }), document.body))
    const input = document.querySelector<HTMLInputElement>('#tm-ask')!
    act(() => { input.value = 'install script'; input.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => document.querySelector<HTMLButtonElement>('.tm-search-results button')!.click())
    expect(document.querySelector('.tm-post-text')?.textContent).toContain('Install the browser extension.')
    act(() => document.querySelector<HTMLButtonElement>('#tm-tab-rules')!.click())
    const language = document.querySelector<HTMLSelectElement>('#tm-language')!
    chain.mockClear(); qa.mockClear()
    act(() => { language.focus(); language.value = 'zh-CN'; language.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(document.querySelector('.tm-root')?.getAttribute('lang')).toBe('zh-CN')
    expect(document.activeElement).toBe(language)
    act(() => document.querySelector<HTMLButtonElement>('#tm-tab-qa')!.click())
    expect(input.value).toBe('install script')
    expect(document.querySelector('.tm-post-text')?.textContent).toBe('Install the browser extension.')
    expect(document.querySelector('.tm-reader-nav')?.textContent).toContain('返回问题列表')
    act(() => document.querySelector<HTMLButtonElement>('#tm-tab-rules')!.click())
    act(() => { const select = document.querySelector<HTMLSelectElement>('#tm-language')!; select.value = 'auto'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(document.querySelector('.tm-root')?.getAttribute('lang')).toBe('en')
    act(() => session.setSiteLanguage('zh-CN'))
    expect(document.querySelector('.tm-root')?.getAttribute('lang')).toBe('zh-CN')
    expect(chain).not.toHaveBeenCalled(); expect(qa).not.toHaveBeenCalled()
    expect(host.loadAll).not.toHaveBeenCalled(); expect(host.navigation.reveal).not.toHaveBeenCalled()
  })
})
