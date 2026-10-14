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
