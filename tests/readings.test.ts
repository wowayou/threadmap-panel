import { describe, expect, it } from 'vitest'
import { boundaryReadings, charReadings, formatReadings, isKnownWord, toneMark } from '../src/core/readings'
import { extractPhrases } from '../src/core/phrases'

const r = (pinyin: string, tone: number) => ({ pinyin, tone })

describe('读音表（CC-CEDICT）', () => {
  it('单字给出全部读音，包括轻声', () => {
    expect(charReadings('行')).toEqual(expect.arrayContaining([r('xing', 2), r('hang', 2)]))
    expect(charReadings('地')).toEqual(expect.arrayContaining([r('di', 4), r('de', 5)]))
    expect(charReadings('取')).toEqual([r('qu', 3)])
  })

  it('繁体单字也有读音', () => {
    expect(charReadings('長')).toEqual(expect.arrayContaining([r('chang', 2), r('zhang', 3)]))
  })

  it('词典里的四字词使用词内读音', () => {
    expect(boundaryReadings('虚与委蛇')).toMatchObject({ source: 'word', exit: [r('yi', 2)] })
    expect(boundaryReadings('强人所难')).toMatchObject({ source: 'word', entry: [r('qiang', 3)], exit: [r('nan', 2)] })
    expect(boundaryReadings('身体力行').exit).toEqual([r('xing', 2)])
  })

  it('不受变调影响：“一”按本调 yī', () => {
    expect(boundaryReadings('一落千丈').entry).toEqual([r('yi', 1)])
  })

  it('词典外的词退回单字全部读音', () => {
    expect(boundaryReadings('美不胜数')).toMatchObject({ source: 'char' })
    expect(boundaryReadings('美不胜数').exit.length).toBeGreaterThan(1)
  })

  it('词典词判断覆盖有读音表和无读音表的词', () => {
    expect(isKnownWord('虚与委蛇')).toBe(true)
    expect(isKnownWord('名扬四海')).toBe(true)
    expect(isKnownWord('接的很点')).toBe(false)
  })

  it('拼音显示为带调号形式', () => {
    expect(toneMark(r('yi', 2))).toBe('yí')
    expect(toneMark(r('hou', 4))).toBe('hòu')
    expect(toneMark(r('gui', 4))).toBe('guì')
    expect(toneMark(r('lü', 4))).toBe('lǜ')
    expect(toneMark(r('de', 5))).toBe('de')
    expect(formatReadings([r('shu', 3), r('shu', 4)])).toBe('shǔ / shù')
  })
})

describe('四字短句提取', () => {
  it('只取独立成段的四个汉字，不切普通长句', () => {
    expect(extractPhrases('讨论积分乐园')).toHaveLength(0)
    expect(extractPhrases('我们今天讨论这个程序是否可行')).toHaveLength(0)
    expect(extractPhrases('请问，一心一意怎么接')).toHaveLength(0)
  })

  it('凑字数的帖子：用空白或括号分开时仍能识别', () => {
    expect(extractPhrases('一心一意 （凑字数凑字数凑字数）').map(p => p.value)).toEqual(['一心一意'])
    expect(extractPhrases('「意气风发」').map(p => p.value)).toEqual(['意气风发'])
    expect(extractPhrases('发奋图强！').map(p => p.value)).toEqual(['发奋图强'])
  })

  it('实站写法：成语后紧跟英文或其他话', () => {
    expect(extractPhrases('名扬四海sogasoga，原来如此').map(p => p.value)).toEqual(['名扬四海'])
    expect(extractPhrases('海纳百川\n接的很点题嘛（自夸一下').map(p => p.value)).toEqual(['海纳百川'])
    expect(extractPhrases('牛气冲天\n应该可以吧，刚好想到了').map(p => p.value)).toEqual(['牛气冲天'])
  })

  it('实站写法：逗号分隔的成语串', () => {
    expect(extractPhrases('人仰马翻，翻天覆地，低声下气，气冲斗牛').map(p => p.value)).toEqual(['人仰马翻', '翻天覆地', '低声下气', '气冲斗牛'])
  })

  it('普通说话里的逗号不会切出四字片段', () => {
    expect(extractPhrases('我觉得可以，明天再说吧')).toHaveLength(0)
    expect(extractPhrases('这个不错，大家觉得呢')).toHaveLength(0)
    expect(extractPhrases('哈哈哈哈，笑死我了')).toHaveLength(0)
  })

  it('多段时按顺序全部提取', () => {
    expect(extractPhrases('取之不尽\n尽力而为').map(p => p.value)).toEqual(['取之不尽', '尽力而为'])
  })
})
