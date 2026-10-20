import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import { i18n } from '../i18n'

/** 默认值仅用于独立组件；Widget 总是提供本主题的显式语言上下文。 */
export const I18nContext = createContext(i18n('zh-CN'))
export const useI18n = () => useContext(I18nContext)
