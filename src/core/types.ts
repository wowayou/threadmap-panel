/** 论坛帖子的最小表示。id 是数据库 ID，postNumber 是楼层号，两者不能混用。 */
export interface Post {
  id: number
  postNumber: number
  username: string
  createdAt: string
  /** 论坛渲染后的 HTML（cooked），仅用于提取纯文本，绝不直接渲染 */
  raw: string
  text: string
  /** undefined = 来源没提供该字段；null = 平台明确表示直接回复主题 */
  replyToPostNumber?: number | null
  origin?: string
  topicId?: number
  /** 点赞数，用于回答排序；来源不提供时为 undefined */
  likeCount?: number
  /**
   * 本次观测没有带来正文（store 字段缺失、DOM 占位或正文为空）。与“平台明确给出空正文”不同：
   * 前者合并时保留已知正文、不写入缓存、不算当前可读；后者是新事实，会替换旧正文。
   */
  bodyMissing?: true
}

export interface LayoutRequest {
  mode: 'collapsed' | 'hud' | 'open' | 'full'
  side: 'left' | 'right'
  width: number
}
export interface Placement {
  kind: 'sidecar' | 'drawer' | 'floating' | 'full'
  side: 'left' | 'right'
  offset: number
  available: number
}

/** 定位不改变业务选中状态；未在 DOM 中的目标由原生新标签链接打开。 */
export interface PostNavigation {
  href(post: Post): string | undefined
  reveal(post: Post): boolean
}

export interface Reading { pinyin: string; tone: number }

export type ReadingSource = 'word' | 'char' | 'none'

export interface Phrase {
  value: string
  /** 首字可能的读音；多于一个表示无法确定 */
  entry: Reading[]
  /** 末字可能的读音 */
  exit: Reading[]
  /** 读音来自四字词词典还是单字表 */
  source: ReadingSource
}

/** 本地人工纠正。parentId = null 表示“不算接龙”。 */
export interface Override { origin: string; topicId: number; childId: number; parentId: number | null }

export type Evidence = 'same-word' | 'same-sound-tone' | 'same-sound-different-tone'
