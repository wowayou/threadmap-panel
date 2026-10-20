/** 构建时由 userscript 配置注入；源码、测试和 demo 中不存在时明确显示为未打包。 */
declare const __THREADMAP_BUILD__: { version: string; id: string; packaged: true } | undefined

export const BUILD_INFO: { version: string; id: string; packaged: boolean } = typeof __THREADMAP_BUILD__ === 'undefined'
  ? { version: 'source', id: 'unpackaged', packaged: false }
  : __THREADMAP_BUILD__
