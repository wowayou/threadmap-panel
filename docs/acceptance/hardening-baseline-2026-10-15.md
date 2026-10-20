# 加固工作区基线验收：2026-10-15

## 结论

**当前实现不通过验收。** 类型检查、构建与现有 31 项本地浏览器场景通过，不足以覆盖此次正在修改的边界；单元/契约测试仍有 1 项失败，独立反例还复现了正文过滤、输入归属、加载进度和重定向问题。

本记录是实施前的冻结基线，不是后续实现的终验。待执行要求见 [实施与验收方案](../plans/hardening-completion.md)。本轮没有修改生产代码或现有测试断言，只新增方案/记录，并重新生成本地忽略的验收产物。

## 环境与样本标识

- 日期：2026-10-15；浏览器报告时间 `2026-10-15T03:30:44.295Z`，补充探测时间 `2026-10-15T03:40:57.485Z`。
- 系统：Linux `6.18.33.2-microsoft-standard-WSL2`，x86_64。
- Node `v24.18.0`，npm `11.16.0`。
- Vite `6.4.3`，Vitest `4.1.11`，Playwright `1.64.0`，jsdom `26.0.0`。
- 实际浏览器：Google Chrome for Testing `153.0.8010.12`，本机缓存的 Chromium 1243 构建，通过 `THREADMAP_CHROME` 显式指定；不是 Playwright 1.64 默认要求的 1248 构建。
- HEAD：`9c9e5bd89b6ed54b4446dd0174ef1afd6948a1b8`，**另有 9 个已跟踪修改文件和 3 个未跟踪实现/配置文件**，不能将结果归于干净 HEAD。
- `git diff --binary HEAD | sha256sum`：`4c04dca23daa2cfce3b92be1559a708301b8ce3daf74d1dd961965a8a74c1277`。
- 当时未跟踪文件的 SHA-256：
  - `src/core/post-input.ts`：`a8a2e52c7d91618eb6fc9f834e8da2d0c84ba05f0ac778c6d12f2773de2ec35a`
  - `src/host/owner.ts`：`a2dcac9006bfed92e70995fa7df71d282124d82a1810f85426d1e7a745a2e0f8`
  - `vitest.config.ts`：`b0d4a858ed487c2da559f506a5bfaf600a656a2f7ebd1cf47714eefe756e7fb0`
- 新构建 `dist/threadmap.user.js` 的 SHA-256：`6586177d2aca21a16df69280dc1330c78bd7614a0a9c5535b1d9595ecc269b75`。

以上校验值用于区分后续工作区/产物变化，不构成签名或安全认证。

## 实际执行的检查

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `git diff --check` | 通过 | 无空白错误 |
| `npm ls --depth=0` | 通过 | 当前安装树与声明的顶层版本一致；未做全新环境安装 |
| `npm run typecheck` | 通过，退出 0 | 当前 TypeScript 检查 |
| `npm run build` | 通过，退出 0 | demo 与 userscript 均重新构建；demo 有压缩后超过 500kB 的体积警告，未改阈值 |
| 构建后 `npm test` | **失败，退出 1** | 10 个文件：9 通过、1 失败；125 项：124 通过、1 失败，包含现有性能组 |
| 默认 `npm run acceptance` | **环境阻塞，退出 1** | 缺少 `chromium_headless_shell-1248`，测试尚未开始；没有自动下载浏览器 |
| 显式指定现有浏览器后验收 | 通过，退出 0 | **31/31**，无未捕获浏览器异常；全部为本地/拦截的虚构宿主 |
| 独立补充探测 | 运行完成 | 11 个边界问题得到复现，另有 4,913 个问句差分样本一致；不是“新增 12 项测试通过” |

浏览器实际命令：

```sh
THREADMAP_CHROME=/home/forbackup/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npm run acceptance
```

生成报告：`acceptance/artifacts/browser-report.json`，对应的桌面、深色、小窗、窄屏、脚本和问答截图也已刷新。这些是忽略目录中的本地证据，不提交为源码。

### 当前唯一的既有测试失败

`tests/host.test.ts:75`：`原帖标注 > 只由标注引起的 DOM 变化不触发重算`。

旧夹具只设置 `.threadmap-badge` 类，没有归属令牌，却期望 `isOwnMutation` 返回 `true`。新实现返回 `false`。正确处理应是更新真正自有标注的夹具，**并新增同名但非自有元素必须返回 false 的反例**，不是把实现退回类名识别。

另一个旧 DOM 用例仍把无令牌的同名按钮当自有标注删除；它目前通过恰恰说明这一路尚未与新归属契约接通，不能把通过理解成行为正确。

## 独立反例与影响

补充探测直接加载当前源码，使用 jsdom、mock 接口和本机回环 HTTP，不使用真实用户名、帖子或凭据。临时脚本与结果保存在 `acceptance/artifacts/hardening-probes.mjs`、`hardening-probes.json`；脚本退出 0 仅代表观察成功收集，**不代表被观察行为符合要求**。稳定的验收要求应按实施方案写入正式测试，不能依赖被忽略的临时文件长期存在。

| 编号 | 最小样本/动作 | 实际观察 | 问题及对应任务 |
| --- | --- | --- | --- |
| P1 | 正文 `<span class="threadmap-badge">一心一意</span><p>意气风发</p>`，无自有令牌 | `readDom` 的文本只有“意气风发” | 真实正文被过滤。是读取结果丢失，不是此步实际移除了页面上的 span；B1 |
| P2 | 用 `markOwned` 标记按钮，类名改为 `renamed`，文字“自有标注” | 读取文本含“自有标注\n一心一意” | 自有标注进入正文分析；B1 |
| P3 | store posts 为 `[合法101, null, 合法102]` | `readStore` 返回 `null` | 单条坏数据使完整 store 观察失效，只能尝试较少信息的 DOM 回退；A1/B3 |
| P4 | store 帖子未给出 `reply_to_post_number` | 规范化结果为 `null` | 未知变成明确事实，可能覆盖此前已知回复；B3 |
| P5 | DOM `.relative-date[data-time="invalid-date"]` | `RangeError: Invalid time value` | 一处坏时间使整个读取抛异常；B4 |
| P6 | fixture 楼层标记 `article#post_1`，移除真实 `data-post-id="101"` | 得到帖子 ID `1` | 把楼层号当数据库 ID，而非承认身份未知；B4 |
| P7 | 请求 stream `[101]`，分批响应含合法101、`id=999/topic_id=8` | 999 被接受，且被标为当前 `topicId=7` | 未请求数据/跨主题数据污染结果；A2/C1 |
| P8 | stream `[101,102]`，接口只返回101 | Promise 成功；posts 只有101，但进度 `2/2` | 用请求量充当实际加载量；C2 |
| P9 | 去掉全局 DOMParser 后，输入 21,000 个“甲” | 输出长度21,000，超过 `MAX_TEXT=20,000` | 非 DOM 分支没有相同文本边界；A3。此探测不代表通常浏览器会走该分支 |
| P10 | 直接调用新 `parsePost`，正文长度200,001 | 接受普通 Post；raw=200,000、text=20,000，没有不完整状态 | 新函数尚未接入外部调用链；直接接线会引入静默截断，接线前应改策略；A3 |
| P11 | 本机来源A的响应302跳到不同端口的来源B，使用实际 Node fetch | B 收到1次请求，然后加载器才抛“重定向到其他站点” | 响应后拒读不能阻止跨源请求。尚需构建产物浏览器层回归；C5 |

这些反例说明需要修复真实接线/契约问题，不是仅调整旧测试。

### 正向对照：问句分句改写

使用包含空串、中文提问、陈述、已解决句、英文疑问句、连续标点、换行、CRLF、表情和超长句的 17 个片段，穷举三片段组合，共 **4,913 个样本**。当前 `questionText` 与原“后行断言 split”算法结果一致，无差异。

这只是当前 Node 引擎上的有界语义对照，不能证明任意文本等价，也不是 Safari 或旧浏览器的执行验收。源码扫描同时确认当前 `src/` 中未再发现 `.at(`、正则后行断言等本轮针对的写法；正式收尾还必须检查构建产物。

## 已确认的接线缺口

- `src/core/post-input.ts` 只有定义，`src/host/discourse.ts` 与 `src/host/loader.ts` 仍直接调用 `normalizePost`。
- `src/host/discourse.ts:cookedHtml` 仍按 `.threadmap-badge` 查询和剥离节点，与 `owner.ts` / `badges.ts` 的令牌契约不一致。
- 加载器没有校验批次返回 ID/主题归属，进度按批次请求数量累加。
- 新遍历的文本上限与尚未接线的 HTML 上限不构成完整的外部输入边界，且没有超限状态。

## 未验证与交付门槛

- 没有访问 linux.do / meta.discourse.org 真实帖子，没有实站脚本管理器验收，没有绕过站点验证。
- 没有旧 Safari / 旧 Chromium 运行结果，也没有本次 Playwright 默认 1248 浏览器的结果。
- 没有全新环境的 `npm ci`、依赖供应链审计或任意规模实站性能结论。
- 新增矩阵中的构建产物边界场景尚待执行 agent 落地，并由验收方复跑；现有 31 项浏览器通过不能替代它们。

完成标准以 [实施方案第 7–8 节](../plans/hardening-completion.md#7-必须覆盖的验收矩阵) 为准。修复后重新记录新的差异标识、产物校验值和完整命令结果，不覆盖本记录冒充之前已经通过。
