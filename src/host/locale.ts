/** 只观察论坛声明的文档语言，不查询 Discourse 私有翻译容器或下载语言包。 */
export function watchSiteLanguage(onChange: (language: string) => void, doc: Document = document): () => void {
  const update = () => onChange(doc.documentElement.lang)
  const observer = new MutationObserver(update)
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] })
  update()
  return () => observer.disconnect()
}
