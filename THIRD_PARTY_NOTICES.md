# 第三方组件与数据

ThreadMap 的 UserScript 产物（`dist/threadmap.user.js`）包含以下第三方作品。产物开头的注释里附有同样的声明。

## Preact

- 来源：https://github.com/preactjs/preact （10.29.8，打包进产物）
- 许可：MIT

```
The MIT License (MIT)

Copyright (c) 2015-present Jason Miller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## CC-CEDICT

- 作品：CC-CEDICT，社区维护的汉英词典，由 MDBG 发布
- 来源：https://cc-cedict.org/wiki/ ，下载地址 https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- 引用作品：CEDICT - Copyright (C) 1997, 1998 Paul Andrew Denisowski
- 许可：Creative Commons Attribution-ShareAlike 4.0 International（https://creativecommons.org/licenses/by-sa/4.0/）
- 本项目所做的改动：由 `scripts/build-readings.mjs` 生成 `src/core/readings-data.ts`。只提取单字读音、四字词的首末字读音和四字词词表，拼音改为小写数字调，未收录释义。数据版本见该文件头部。
- 改编后的数据（`src/core/readings-data.ts`，以及产物中对应的部分）同样以 CC BY-SA 4.0 发布。

## 设计参考（未使用其代码或素材）

- “钉成小窗”的交互参考了 Microsoft Xbox Game Bar 性能小组件（Fluent Design）。Xbox 与 Windows 是 Microsoft 的商标，本项目与 Microsoft 无关，也未获其认可。
