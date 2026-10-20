import { chainMessages } from './chain'
import { readerMessages } from './reader'
import { runtimeMessages } from './runtime'
import { shellMessages } from './shell'

export const messages = { ...shellMessages, ...readerMessages, ...chainMessages, ...runtimeMessages }
export type MessageKey = keyof typeof messages
export type Locale = 'zh-CN' | 'en'
export type LanguagePreference = 'auto' | Locale
export interface Message { key: MessageKey; values?: Record<string, Text | number> }
export type Text = string | Message | readonly Message[]
type Slots<S extends string> = S extends `${string}{${infer Slot}}${infer Rest}` ? Slot | Slots<Rest> : never
type Arguments<K extends MessageKey> = [Slots<(typeof messages)[K][0]>] extends [never] ? [] : [values: Record<Slots<(typeof messages)[K][0]>, Text | number>]

/** 消息保留为结构数据；异步错误和分析理由到显示时才选语言，不读取全局可变语言。 */
export function message<K extends MessageKey>(key: K, ...args: Arguments<K>): Message {
  return { key, ...(args[0] ? { values: args[0] } : {}) }
}
export function formatText(locale: Locale, text: Text): string {
  if (typeof text === 'string') return text
  if (Array.isArray(text)) return text.map(part => formatText(locale, part)).join(locale === 'en' ? ' ' : '')
  const item = text as Message
  return messages[item.key][locale === 'zh-CN' ? 0 : 1].replace(/\{(\w+)\}/g, (_slot, name: string) => {
    const value = item.values?.[name]
    if (value === undefined) throw new Error(`Missing message value: ${item.key}.${name}`)
    return typeof value === 'object' ? formatText(locale, value) : String(value)
  })
}
function bind(locale: Locale) {
  return { locale, t: <K extends MessageKey>(key: K, ...args: Arguments<K>) => formatText(locale, message(key, ...args)), format: (text: Text) => formatText(locale, text) }
}
const bound = { 'zh-CN': bind('zh-CN'), en: bind('en') }
export const i18n = (locale: Locale) => bound[locale]

/** 论坛声明优先于浏览器；论坛语言未知/不支持时明确回退英文，不按域名猜测。 */
export function resolveLocale(preference: LanguagePreference, siteLanguage?: string, browserLanguages: readonly string[] = []): Locale {
  if (preference !== 'auto') return preference
  const language = siteLanguage?.trim() || browserLanguages.find(value => value.trim()) || 'en'
  return /^zh(?:[-_]|$)/i.test(language) ? 'zh-CN' : 'en'
}

export class LocalizedError extends Error {
  constructor(readonly text: Text) { super(formatText('zh-CN', text)); this.name = 'LocalizedError' }
}
/** 未预期的浏览器错误不丢失诊断信息，但绝不把它当作消息键或 HTML。 */
export const errorText = (error: unknown): Text => error instanceof LocalizedError ? error.text : error instanceof Error && error.message ? error.message : message('error.unknown')
