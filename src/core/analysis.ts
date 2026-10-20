import type { ChainResult } from './chain'
import type { QaResult } from './questions'

/** 显式模式只携带自己的分析结果，公共界面不得借另一引擎取得加载范围。 */
export type TopicAnalysis = { mode: 'chain'; result: ChainResult } | { mode: 'qa'; result: QaResult }
export type ToolMode = TopicAnalysis['mode']
