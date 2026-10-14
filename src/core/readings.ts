import { CHAR_READINGS, KNOWN_WORDS, WORD_BOUNDARY_READINGS } from './readings-data'
import type { Reading, ReadingSource } from './types'

let chars: Map<string, Reading[]> | null = null
let words: Map<string, { entry: Reading[]; exit: Reading[] }> | null = null

const parse = (value: string): Reading => ({ pinyin: value.slice(0, -1), tone: Number(value.slice(-1)) })
const unique = (list: Reading[]) => [...new Map(list.map(r => [`${r.pinyin}${r.tone}`, r])).values()]

/** 首次使用时才解析读音表，脚本加载阶段不付出成本 */
function tables() {
  if (!chars) {
    chars = new Map()
    for (const line of CHAR_READINGS.split('\n')) {
      const char = [...line][0]
      chars.set(char, line.slice(char.length).split(',').map(parse))
    }
  }
  if (!words) {
    words = new Map()
    for (const line of WORD_BOUNDARY_READINGS.split('\n')) {
      const word = [...line].slice(0, 4).join('')
      const pairs = line.slice(word.length).split('|').map(pair => pair.split(' ').map(parse))
      words.set(word, { entry: unique(pairs.map(p => p[0])), exit: unique(pairs.map(p => p[1])) })
    }
  }
  return { chars, words }
}

let known: Set<string> | null = null

/** 是否是词典收录的四字词（用于从混排文本中认出短句） */
export function isKnownWord(word: string): boolean {
  if (tables().words.has(word)) return true
  if (!known) { known = new Set(); for (let i = 0; i + 4 <= KNOWN_WORDS.length; i += 4) known.add(KNOWN_WORDS.slice(i, i + 4)) }
  return known.has(word)
}

export function charReadings(char: string): Reading[] {
  return tables().chars.get(char) || []
}

/**
 * 四字词首末字读音。词典里有这个词时用词典读音（例如“虚与委蛇”末字只读 yi2）；
 * 否则退回单字的全部读音，多于一个即视为不确定。
 */
export function boundaryReadings(word: string): { entry: Reading[]; exit: Reading[]; source: ReadingSource } {
  const letters = [...word]
  const known = tables().words.get(word)
  if (known) return { ...known, source: 'word' }
  const entry = charReadings(letters[0]), exit = charReadings(letters[letters.length - 1])
  return { entry, exit, source: entry.length || exit.length ? 'char' : 'none' }
}

const marks: Record<string, string[]> = { a: ['ā', 'á', 'ǎ', 'à'], e: ['ē', 'é', 'ě', 'è'], i: ['ī', 'í', 'ǐ', 'ì'], o: ['ō', 'ó', 'ǒ', 'ò'], u: ['ū', 'ú', 'ǔ', 'ù'], ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'] }

/** 数字调 → 带调号拼音，用于界面展示。规则：a/e 优先；ou 标 o；否则标最后一个元音。 */
export function toneMark({ pinyin, tone }: Reading): string {
  if (tone < 1 || tone > 4) return pinyin
  const index = /[ae]/.test(pinyin) ? pinyin.search(/[ae]/) : pinyin.includes('ou') ? pinyin.indexOf('o') : Math.max(...[...'iouü'].map(v => pinyin.lastIndexOf(v)))
  if (index < 0) return pinyin
  return pinyin.slice(0, index) + marks[pinyin[index]][tone - 1] + pinyin.slice(index + 1)
}

export function formatReadings(readings: Reading[]): string {
  return readings.length ? readings.map(toneMark).join(' / ') : '未知'
}
