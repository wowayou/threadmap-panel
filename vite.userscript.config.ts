import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const { version, license } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string; license: string }
const codeLicense = readFileSync(resolve(__dirname, 'LICENSE'), 'utf8').trim().split('\n').map(line => `// ${line}`).join('\n')

/** 源码与构建配置指纹：用于核对已安装脚本是不是同一构建，不是签名；跨平台换行差异会影响结果。 */
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => { const file = resolve(dir, name); return statSync(file).isDirectory() ? walk(file) : [file] })
const buildInputs = [...walk(resolve(__dirname, 'src')), ...['package.json', 'package-lock.json', 'LICENSE', 'vite.userscript.config.ts'].map(file => resolve(__dirname, file))]
  .map(file => ({ file, name: relative(__dirname, file).split(sep).join('/') }))
  .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
const fingerprint = createHash('sha256')
for (const { file, name } of buildInputs) fingerprint.update(name).update('\0').update(readFileSync(file)).update('\0')
const buildId = fingerprint.digest('hex').slice(0, 12)

// UserScript 元数据头的唯一来源
const metadata = `// ==UserScript==
// @name         ThreadMap
// @namespace    https://github.com/wowayou/threadmap-panel
// @version      ${version}
// @author       wowayou
// @license      ${license}
// @description  Read-only Discourse companion: word chains, repeated questions and related replies. Local analysis; no posting.
// @description:zh-CN  只读 Discourse 阅读助手：成语接龙、重复提问与相关回复，本地分析，不代发帖。
// @match        https://linux.do/t/*
// @match        https://meta.discourse.org/t/*
// @grant        none
// @noframes
// @run-at       document-idle
// @homepageURL  https://github.com/wowayou/threadmap-panel
// @supportURL   https://github.com/wowayou/threadmap-panel/issues
// ==/UserScript==
//
// 构建标识：${buildId}（源码与构建配置 SHA-256 的前 12 位，用于核对版本，不是签名）
//
// ThreadMap 由 wowayou 编写，代码以 MIT 许可发布（不含下述 CC BY-SA 4.0 读音数据）。
// 灵感来自 linux.do 的成语接龙主题：https://linux.do/t/topic/2915068
//
${codeLicense}
//
// 第三方组件与数据的完整声明见仓库 THIRD_PARTY_NOTICES.md，摘要如下：
//
// 读音数据：CC-CEDICT（https://cc-cedict.org/wiki/，MDBG 发布；CEDICT - Copyright (C) 1997, 1998
// Paul Andrew Denisowski），许可 CC BY-SA 4.0（https://creativecommons.org/licenses/by-sa/4.0/）。
// 本产物只收录了从中提取的单字读音、四字词首末字读音与词表；改编后的数据同样以 CC BY-SA 4.0 发布。
//
// Preact 10.29.8 — The MIT License (MIT), Copyright (c) 2015-present Jason Miller
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
// associated documentation files (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
// and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions: The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
// LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
// WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// “钉成小窗”的交互参考了 Microsoft Xbox Game Bar 性能小组件；Xbox 为 Microsoft 商标，本项目与其无关。

`

export default defineConfig({
  define: { __THREADMAP_BUILD__: JSON.stringify({ version, id: buildId, packaged: true }) },
  plugins: [{
    name: 'threadmap-userscript-metadata',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk' && item.fileName === 'threadmap.user.js') item.code = metadata + item.code
      }
    },
  }],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    lib: { entry: resolve(__dirname, 'src/userscript.tsx'), name: 'ThreadMapUserScript', formats: ['iife'], fileName: () => 'threadmap.user.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
