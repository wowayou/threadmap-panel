#!/usr/bin/env node
/**
 * 从 CC-CEDICT 生成接龙所需的最小读音表：src/core/readings-data.ts
 *
 * 用法：
 *   1. 下载 https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip 并解压
 *   2. node scripts/build-readings.mjs path/to/cedict_ts.u8
 *
 * 只输出接龙用得到的部分：
 *   - 单字 → 全部读音（排除仅作姓氏/异体字的条目）
 *   - 四字词（简体）→ 首字、末字读音；仅当首末字是多音字、缺失或与单字表不一致时收录
 *   - 其余四字词 → 只记录“是词典词”，用于识别与英文、逗号混排的短句
 *
 * 数据许可：CC-CEDICT 采用 CC BY-SA 4.0，生成文件保留署名与许可说明。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const input = process.argv[2]
if (!input) { console.error('usage: node scripts/build-readings.mjs <cedict_ts.u8>'); process.exit(1) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'src', 'core', 'readings-data.ts')

const han = /^[\u3400-\u9fff]$/u
const line = /^(\S+) (\S+) \[([^\]]+)\] \/(.*)\/\s*$/
/** CC-CEDICT 拼音 → 内部格式：小写、ü、声调 1–5（5 = 轻声） */
const normalize = syllable => {
  const m = syllable.toLowerCase().replace(/u:/g, 'ü').match(/^([a-zü]+)([1-5])$/)
  return m ? `${m[1]}${m[2]}` : null
}
const ignorableGloss = /^(surname |variant of |old variant of |archaic variant of |Japanese variant of |erhua variant of |used in personal names|\(Cantonese\)|abbr\. for )/i

const chars = new Map()   // 字 → Set<读音>
const words = new Map()   // 四字词 → Set<"首读 末读">
let version = 'unknown'

for (const raw of fs.readFileSync(input, 'utf8').split('\n')) {
  if (raw.startsWith('#')) { const v = raw.match(/^#! date=(\S+)/); if (v) version = v[1]; continue }
  const m = raw.match(line)
  if (!m) continue
  const [, trad, simp, pinyinText, glossText] = m
  const syllables = pinyinText.split(' ').map(normalize)
  if (syllables.some(s => !s)) continue
  const glosses = glossText.split('/').filter(Boolean)
  // 单字收简繁两种字形；四字词只收简体，控制体积（繁体词退回单字读音）
  for (const form of new Set([simp, trad])) {
    const letters = [...form]
    if (letters.length !== 1 || syllables.length !== 1 || !han.test(form)) continue
    if (glosses.every(g => ignorableGloss.test(g))) continue
    const set = chars.get(form) || new Set(); set.add(syllables[0]); chars.set(form, set)
  }
  const letters = [...simp]
  if (letters.length === 4 && syllables.length === 4 && letters.every(c => han.test(c))) {
    const set = words.get(simp) || new Set(); set.add(`${syllables[0]} ${syllables[3]}`); words.set(simp, set)
  }
}

// 只收录能减少不确定性的词：首字或末字在单字表里是多音字（或缺失），或词典读音与单字表不一致
const wordLines = []
for (const [word, set] of [...words].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
  const letters = [...word]
  const first = chars.get(letters[0]), last = chars.get(letters[3])
  const useful = [...set].some(pair => { const [a, b] = pair.split(' '); return !first || !last || first.size > 1 || last.size > 1 || !first.has(a) || !last.has(b) })
  if (useful) wordLines.push(`${word}${[...set].join('|')}`)
}
// 其余四字词只记“是词典里的词”，用于从“名扬四海sogasoga”“人仰马翻，翻天覆地”这类混排中认出短句
const listed = new Set(wordLines.map(line => [...line].slice(0, 4).join('')))
const knownWords = [...words.keys()].filter(w => !listed.has(w)).sort((a, b) => a.localeCompare(b, 'zh')).join('')
const charLines = [...chars].sort((a, b) => a[0].localeCompare(b[0], 'zh')).map(([c, set]) => `${c}${[...set].join(',')}`)

const header = `/* eslint-disable */
// 由 scripts/build-readings.mjs 生成，请勿手改。
// 数据来源：CC-CEDICT（${version}），https://cc-cedict.org/wiki/
// 许可：Creative Commons Attribution-ShareAlike 4.0 International，https://creativecommons.org/licenses/by-sa/4.0/
// 改编说明：仅提取单字读音与四字词首末字读音，拼音改为小写数字调（5 = 轻声）。本文件同样以 CC BY-SA 4.0 发布。
`
const body = `export const CEDICT_VERSION = ${JSON.stringify(version)}
/** 每行：字 + 逗号分隔的读音 */
export const CHAR_READINGS = ${JSON.stringify(charLines.join('\n'))}
/** 每行：四字词 + "首读 末读"，多种读法用 | 分隔 */
export const WORD_BOUNDARY_READINGS = ${JSON.stringify(wordLines.join('\n'))}
/** 其余四字词，首尾相接、每 4 字一个（都在 BMP 内，可按 UTF-16 长度切分） */
export const KNOWN_WORDS = ${JSON.stringify(knownWords)}
`
fs.writeFileSync(output, header + body)
console.log(`chars=${charLines.length} words=${wordLines.length}/${words.size} known=${knownWords.length / 4} bytes=${Buffer.byteLength(header + body)} version=${version}`)
