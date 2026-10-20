import { describe, expect, it } from 'vitest'
import { buildChain, defaultChainSettings } from '../src/core/chain'
import { buildQa } from '../src/core/questions'
import type { Post } from '../src/core/types'

/**
 * 性能预算（docs/implementation-brief.md）：上万楼也不能卡住页面。
 * 预算用于合成数据的性能回归，不代表真实站点的网络或页面响应时延。
 */

const IDIOMS = ['一心一意', '意气风发', '发奋图强', '强人所难', '难能可贵', '贵在坚持', '持之以恒', '恒河沙数', '数一数二', '二话不说', '说一不二', '二者择一']
const CHAT = ['顶一下', '感谢分享，学到了', '楼上说得对', '+1 同问', '哈哈哈哈哈']
const post = (n: number, text: string): Post => ({ id: 100000 + n, postNumber: n, username: `u${n % 400}`, createdAt: '', raw: '', text, topicId: 1, origin: 'x', replyToPostNumber: n % 4 === 0 ? n - 1 : null })
const time = (label: string, f: () => void) => {
  const start = performance.now(); f(); const ms = performance.now() - start
  // 有界本地测量写入测试日志，方便验收复核；日志开销不计入被测区间。
  console.info(`[perf] ${label}: ${ms.toFixed(2)} ms`)
  return ms
}

describe('性能预算', () => {
  it('高分叉：2 万楼都接向同一父楼，兄弟关系与理由线性增长：< 1.5 秒', () => {
    const n = 20000
    const posts = [post(1, '一心一意'), ...Array.from({ length: n }, (_, i) => ({ ...post(i + 2, '意气风发'), replyToPostNumber: 1 }))]
    buildChain(posts.slice(0, 200))
    let chain!: ReturnType<typeof buildChain>
    expect(time('chain-20000-fanout', () => { chain = buildChain(posts, defaultChainSettings, [], { stream: posts.map(p => p.id) }) })).toBeLessThan(1500)
    expect(chain.childrenOf.get(100001)).toHaveLength(n)
    expect(chain.order.at(-1)!.siblingCount).toBe(n - 1)
  })
  it('接龙 2 万楼（每 6 楼一次插话导致断链与回溯）：< 1.5 秒', () => {
    const posts = Array.from({ length: 20000 }, (_, i) => post(i + 1, i % 6 === 0 ? CHAT[i % CHAT.length] : IDIOMS[i % IDIOMS.length]))
    buildChain(posts.slice(0, 200))
    expect(time('chain-20000-with-stream', () => buildChain(posts, defaultChainSettings, [], { stream: posts.map(p => p.id) }))).toBeLessThan(1500)
    expect(time('chain-20000-without-stream', () => buildChain(posts))).toBeLessThan(1500)
  })

  it('最坏情况：2 万楼全部互相接不上，也有界：< 3 秒', () => {
    const chars = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'
    const posts = Array.from({ length: 20000 }, (_, i) => post(i + 1, `${chars[i % 22]}${chars[(i * 7) % 22]}${chars[(i * 3) % 22]}${chars[(i * 5 + 1) % 22]}`))
    expect(time('chain-20000-unmatched', () => buildChain(posts))).toBeLessThan(3000)
  })

  it('问答 1 万楼、约 3300 个各不相同的提问：< 2 秒；查询 < 50 毫秒', () => {
    const nouns = '脚本插件主题账号邀请码积分签到头像徽章等级私信草稿标签分类镜像节点代理证书域名服务器数据库缓存日志备份'
    const word = (i: number) => nouns.slice((i * 2) % nouns.length, (i * 2) % nouns.length + 2)
    const verbs = ['设置', '开启', '关闭', '迁移', '恢复', '修改', '删除', '升级', '绑定', '申请']
    const posts = Array.from({ length: 10000 }, (_, i) => post(i + 1, i % 3 === 0 ? `请问${word(i)}${word(i * 13 + 5)}怎么${verbs[i % verbs.length]}${i % 97}？` : CHAT[i % CHAT.length]))
    let qa!: ReturnType<typeof buildQa>
    expect(time('qa-10000-build', () => { qa = buildQa(posts) })).toBeLessThan(2000)
    expect(qa.questions.size).toBeGreaterThan(3000)
    expect(time('qa-10000-search', () => qa.search('脚本插件怎么设置'))).toBeLessThan(50)
  })
})
