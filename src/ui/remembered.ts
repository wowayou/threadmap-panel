import { useState } from 'preact/hooks'

/** 面板内的主题级草稿：切换模式卸载视图后仍可恢复；切主题随 Widget 一起丢弃，不写入存储。 */
export type ViewMemory = Map<string, unknown>

export function useRemembered<T>(memory: ViewMemory | undefined, key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => memory?.has(key) ? memory.get(key) as T : initial)
  return [value, next => { memory?.set(key, next); setValue(next) }]
}
