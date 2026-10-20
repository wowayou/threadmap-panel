# 只读阅读接口 v1（内部预留）

实现：`src/core/reader-api.ts`。这是给未来 agent（智能体程序）或嵌入式客户端预留的**可导入 TypeScript 模块**，不是已经开放的浏览器 API。

当前 userscript 没有导入此模块，没有 `window.ThreadMap`、自定义 DOM 事件桥、自动导出、模型或外部网络连接。不增加普通用户的设置项、后台任务或权限；不支持通过此接口加载、导航、发帖、改变设置或缓存。

## 使用方式

调用方必须在本进程内持有一个主题的会话及**已计算的分析**：

```ts
import { createReaderApi, type ReaderSource } from './src/core/reader-api'

// 在分析完成时原子替换；analyzedPosts 必须是构建 analysis 所用的同一个数组。
let current: ReaderSource | undefined
const api = createReaderApi(() => current)
// current = { state: session.get(), analysis, analyzedPosts: postsUsedForAnalysis }

const status = await api.execute({ version: 1, topicId: 7, op: 'status' })
const result = await api.execute({
  version: 1, topicId: 7, snapshot: status.snapshot,
  op: 'search', query: 'install script', limit: 5,
}, abortController.signal)

// 主题卸载时撤销本实例；已取得的结果副本无法收回。
api.close()
```

示例中 `current` 的填充由将来的宿主集成负责，现有脚本不对页面暴露它。接口不为了满足查询去启动另一个模式的分析。若新正文已到而对应分析尚未更新，检索/问题查询拒绝 `stale_snapshot`，不把旧分析冒充新结果。

## 请求

所有请求都需 `version: 1` 和正安全整数 `topicId`。非 `status` 请求还需先前取得的 `snapshot`。未知操作、多余字段和超限输入拒绝，不静默忽略潜在写操作/供应商参数。

| `op` | 参数 | 返回 |
| --- | --- | --- |
| `status` | 无 | 当前模式、来源、载入/缺口/缓存数量、快照号；不含正文 |
| `search` | `query` 1–120 UTF-16 代码单元，`limit` 1–10（默认 10） | 问题摘要、稳定首问 ID/楼号、提问次数和相关回复数；不含“答案正确率” |
| `question` | 已识别的 `questionId`，`offset` ≥0，`limit` 1–20（默认 20） | 该组摘要及一页回复 ID/楼号、回复或引用的结构证据、`hasMore` |
| `posts` | 1–20 个互不重复的数据库 `postIds` | 指定的已载入正文纯文本及楼号、逐条 `truncated`；未取得或归属不符的 ID 在 `missingIds` 中 |

- 数据库帖子 ID 与楼层号不可混用；非问答模式仍可查范围和指定正文，问答操作返回 `mode_unavailable`。
- 正文每楼最多 2,000、每次总计最多 20,000 个 UTF-16 代码单元；不会切断代理对。总额度用尽时后续存在的楼层返回空文本并标为截断，不伪造“楼层不存在”。
- 每条回复最多输出 8 项结构证据，多余时 `evidenceTruncated: true`。它们来自问答引擎认定的明确回复/引用，不重新猜测正文语义。
- 正文结果只含 `id / postNumber / text / truncated`，不返回原始 HTML、用户名、Cookie、凭据、未发送输入、设置或可修改的内部数组/Map。帖子文字本身仍可能包含个人信息，不能把字段裁剪称为匿名化。
- 所有结果带 `trust: 'untrusted-forum-content'` 和 `method: 'local-rules-not-verified-answers'`。`cachedPosts` 是整个会话含缓存的数量，不是某个结果的逐楼来源认证。正文仍是分析用文本，代码、图片、引用可能不完整。

## 生命周期与失败

快照号只在此接口实例内有意义，不是权限令牌。主题/来源、正文、stream、缓存数量、模式或分析结果变化后旧快照失效；配色、语言和阅读位置不使其失效。调用方应重新读取状态并让用户确认自己的后续动作，不能以失败为由自动抓帖。

`ReaderApiError.code`：`invalid_request`、`unsupported_version`、`unavailable`、`wrong_topic`、`stale_snapshot`、`mode_unavailable`、`not_found`、`aborted`。错误码面向程序，不混入当前界面语言。

支持 `AbortSignal`：执行前、短暂让出微任务后、有限循环和返回前检查取消。同步本地检索不能被正在执行的 JavaScript 中途抢占，不宣称硬实时取消。没有计时器、轮询、自动重试或排队。`close()` 后拒绝新调用并释放索引引用。

## 真正连接 agent 前的条件

接口不是同页恶意脚本的安全边界。目前没有外部调用方，因此不添加一个装饰性的“允许 agent”开关。以后若增加扩展、MCP（Model Context Protocol，模型上下文协议，用于连接工具）、本地服务或页面消息桥，必须另行设计：

1. 调用方身份、作用域、按次授权和撤销；不能依靠页面能伪造的事件/随机字符串做权限保证。
2. 明确会外发哪些正文和个人信息，供应商或本地模型的实际费用、配额、资源占用及输出上限。
3. 把帖子视为不可信资料而不是指令；不执行帖子中的工具请求，不让模型结论覆盖平台结构证据。
4. 输出校验、取消/超时、失败可见性与无自动抓帖/写回保障。

本轮仅借鉴 `kiss-translator` 的能力契约、场景与授权分离思路；没有复制其 GPL-3.0 代码。参考范围见 [本轮方案](plans/discourse-reader.md)。

测试：`tests/reader-api.test.ts`；1 万楼本地查询/读取预算：`tests/perf.reader.test.ts`。这不是外部 agent 集成验收。
