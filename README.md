# ThreadMap

Discourse 论坛的只读油猴脚本：在成语接龙帖中查看当前承接位置，在普通长帖中查找重复提问和已有回答。

适用页面：`linux.do/t/*`、`meta.discourse.org/t/*`。当前版本：0.2.1。

## 功能与亮点

| 功能 | 当前能力 |
| --- | --- |
| 接龙进度 | 显示当前该接的楼层、词组末字和读音，并列出附近的并行链 |
| 原帖标注 | 标出承接楼层、断链、分叉、重复、帖内问题、多音字待确认和前文未载入 |
| 本地试接 | 输入四字词，检查能否接上当前链头、是否已经使用过；不会自动发帖 |
| 问题定位 | 按类型筛选，查看判断依据，跳到原帖；支持手动指定、不算接龙和恢复自动 |
| 长帖问答 | 按字面相似度归组重复提问，关联明确回复或引用提问的回答，支持发问前搜索 |
| 阅读界面 | 贴边按钮、展开面板、全屏和可钉住的小窗；支持左右停靠、键盘操作、深浅色与编辑器避让 |
| 按需加载 | 默认使用页面已载入数据；用户主动加载时串行补齐，支持取消、限流提示和保留已载入内容 |

接龙与问答按主题自动切换，也可以在“规则”页手动选择。判断结果是规则推断，不代表作者意图或回答的正确性。

## 效果展示

以下页面为本地 Discourse 风格模拟主题，用户名、文字头像和帖子内容均为虚构，界面来自实际运行的脚本。模拟截图不能代替真实站点兼容性验收。

**当前链头与本地试接**

![当前链头与本地试接，模拟数据](docs/screenshots/02-next.png)

**紧凑小窗**

![三格读数小窗，模拟数据](docs/screenshots/04-hud.png)

**重复提问与已有回答**

![先查再问，模拟数据](docs/screenshots/05-qa.png)

[全部六张截图及生成说明](docs/screenshots/README.md)

## 安装与使用

1. 安装 Tampermonkey 或 Violentmonkey。
2. 从 [Releases](https://github.com/wowayou/threadmap-panel/releases) 下载并安装 `threadmap.user.js`，或按下方开发步骤自行构建。更新需要手动安装新版。
3. 打开支持站点的主题页，点击屏幕边缘的按钮展开面板。标题栏可以收起、全屏或钉成小窗；“规则”页可以切换模式和接龙规则。
4. 需要更多上下文时，点击“加载全部楼层”；已载入全部楼层后可主动“检查新楼层”。超过 1000 楼未载入时会先说明请求量与估算耗时。

Release 附有 SHA-256 校验文件。在脚本与校验文件所在目录运行 `sha256sum -c threadmap.user.js.sha256`；Windows 可用 `Get-FileHash .\threadmap.user.js -Algorithm SHA256` 比对。

## 安全与数据

- 只读，不发帖、不点赞、不写回论坛，不把帖子数据发给第三方。
- 不申请油猴特权，不远程加载代码，读音数据随脚本分发。
- 打开面板不会抓取历史。只有用户主动加载或检查新楼层时，才使用当前浏览器的登录权限请求当前论坛的同源只读接口。
- 帖子内容仅保存在页面内存中；本地只保存设置和手动纠正。加载每批最多 20 楼、批间隔 500ms，出错即停，不自动重试。

实现与限制见 [安全基线](docs/security.md)。

## 已知边界

- **实站验证未完成**：linux.do 尚需人工验收；Discourse 的版本、主题及插件差异可能影响适配。
- **只覆盖已载入内容**：有缺口时显示“前文未载入”；新帖或补充上下文可能改变当前链头和问题归组。
- **不是成语裁判**：不检查词组是不是规范成语。支持独立四字短句、逗号分隔串和部分含词典词的混排文本，不会把普通长句任意切成四字片段。
- **接龙规则需要校准**：同音、声调、回看窗口和多音字处理均有规则边界，默认参数尚未用真实接龙样本系统校准。更早匹配的回溯搜索有数量上限，不保证穷举所有历史承接。
- **问答是字面匹配**：不是 AI 语义理解，也不生成答案；不同表达可能漏分，相似措辞可能误分。回答仅依据显式回复或引用关联，不验证内容质量。
- **页面数据接口可能变化**：优先读取 Discourse 页面内部数据，不可用时退回页面元素；退回后回复信息与全帖总量可能未知。
- **规模与网络限制**：合成数据性能测试不等于所有实站表现。大量加载仍受站点限流和网络影响；遇到 Cloudflare 验证需要用户自行完成，不绕过验证。

## 下一步路线

优先补真实站点兼容性验证，再根据授权样本改善接龙误判和问答归组；持续检查大帖加载、窄屏和键盘操作的回归。

具体目标与验收条件见 [路线图](docs/roadmap.md)。计划不等于已实现功能，也不承诺固定发布日期。

## 开发与验证

```sh
npm ci
npm run dev          # 本地模拟主题
npm run typecheck
npm run build        # demo + dist/threadmap.user.js
npm test             # 构建后运行，以覆盖产物许可与安全检查
npm run acceptance   # 本地浏览器验收，需先 build
npm run screenshots  # 六张离线模拟截图，需先 build
npm run readings -- path/to/cedict_ts.u8
```

浏览器任务需要 Playwright 可用的 Chromium，也可以通过 `THREADMAP_CHROME` 指定本机浏览器。它们是手动本地任务，不会自动访问真实帖子。

- `src/core`：接龙、问答、读音、会话和本地存储。
- `src/host`：Discourse 适配、只读加载、原帖标注与主题配色。
- `src/ui`：面板组件和交互状态。
- `src/demo`、`tests`、`acceptance`：模拟宿主、单元测试与浏览器验收。

[实现说明](docs/implementation-brief.md) · [界面基准](docs/ui-spec.md) · [版本说明](docs/releases/v0.2.1.md)

## 许可与致谢

- 代码与项目文档：[MIT](LICENSE)，© 2026 [wowayou](https://github.com/wowayou)。完整许可附在打包脚本中。
- CC-CEDICT 读音数据：由 MDBG 发布，源自 CEDICT（© 1997, 1998 Paul Andrew Denisowski）；`src/core/readings-data.ts` 及产物中的对应数据继续使用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)，不适用项目 MIT。
- 界面使用 Preact（MIT，© 2015-present Jason Miller）。
- 接龙功能的灵感来自 linux.do 的[成语接龙主题](https://linux.do/t/topic/2915068)。“钉成小窗”参考 Microsoft Xbox Game Bar 的性能小组件交互，未使用其代码或素材，与 Microsoft 无关。

打包产物标记为 `MIT AND CC-BY-SA-4.0`：不同部分遵循对应许可，不是任选其一。完整声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
