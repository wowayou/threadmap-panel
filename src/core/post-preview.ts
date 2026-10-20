import type { Post } from './types'

/** 共享的只读预览游标：保留调用方排序和稳定 ID，不拥有问答/接龙业务状态。 */
export function resolvePostPreview(ids: readonly number[], byId: ReadonlyMap<number, Post>, selectedId: number) {
  const available = [...new Set(ids)].filter(id => byId.has(id))
  const index = available.indexOf(selectedId)
  if (index < 0) return null
  return {
    post: byId.get(selectedId)!, index, total: available.length,
    previousId: available[index - 1] as number | undefined,
    nextId: available[index + 1] as number | undefined,
  }
}
