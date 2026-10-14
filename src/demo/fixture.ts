import type { Post } from '../core/types'
import { normalizePost } from '../core/phrases'

/**
 * 接龙演示主题（本地虚构数据）：包含插话、并行双链、断链、多音字、
 * 重复词组、抢楼分叉。#21–#24 是早期版本沿用的边界样例；
 * #36→#37 演示词典读音（委蛇读 yí，“舌”接不上）；#45→#46 演示词典外多音字待确认（“数”有 shǔ/shù/shuò）。
 */
const chainScript: [number, string, string, number?][] = [
  [1, 'Charm', '一心一意'],
  [2, 'Asher', '意气风发'],
  [3, 'Mint', '发奋图强'],
  [4, 'laozuo', '强人所难'],
  [5, 'reader5', '这个帖子是不是只能用成语？'],
  [6, 'Pine', '难能可贵'],
  [7, 'wowayou', '贵在坚持'],
  [8, 'Mint', '贵耳贱目'],
  [9, 'Charm', '持之以恒'],
  [10, 'Asher', '目不转睛'],
  [11, 'laozuo', '恒河沙数'],
  [12, 'reader12', '谢谢分享'],
  [13, 'Pine', '精益求精'],
  [14, 'Mint', '数一数二'],
  [15, 'wowayou', '海阔天空'],
  [16, 'Charm', '空前绝后'],
  [17, 'Asher', '后来居上'],
  [18, 'laozuo', '上行下效'],
  [19, 'Pine', '笑逐颜开'],
  [20, 'Mint', '开天辟地'],
  [21, 'Charm', '川流不息\n息息相关\n关关雎鸠\n咎由自取'],
  [22, 'Asher', '讨论积分乐园'],
  [23, 'laozuo', '取之不尽\n尽力而为\n为所欲为\n为所欲为', 21],
  [24, 'wowayou', '曲高和寡\n刮目相看\n侃侃而谈\n贪得无厌', 21],
  [25, 'Pine', '艳阳高照'],
  [26, 'Mint', '照本宣科'],
  [27, 'Charm', '科班出身'],
  [28, 'Asher', '身体力行'],
  [29, 'laozuo', '行云流水'],
  [30, 'reader30', '水到渠成'],
  [31, 'Pine', '水滴石穿'],
  [32, 'Mint', '成竹在胸'],
  [33, 'Charm', '一心一意'],
  [34, 'Asher', '义无反顾'],
  [35, 'laozuo', '故弄玄虚'],
  [36, 'Pine', '虚与委蛇'],
  [37, 'Mint', '舌战群儒'],
  [38, 'reader38', '加油，这条链越来越长了'],
  [39, 'Charm', '儒雅风流'],
  [40, 'Asher', '流连忘返'],
  [41, 'laozuo', '返璞归真'],
  [42, 'Pine', '真心实意'],
  [43, 'Mint', '意犹未尽'],
  [44, 'Charm', '尽善尽美'],
  [45, 'Asher', '美不胜数'],
  [46, 'laozuo', '鼠目寸光'],
]
export const chainDemoPosts: Post[] = chainScript.map(([n, username, raw, reply]) => normalizePost({
  id: 9000 + n, post_number: n, username, raw,
  created_at: new Date(Date.UTC(2026, 8, 17, 8, n * 3)).toISOString(),
  ...(reply ? { reply_to_post_number: reply } : { reply_to_post_number: null }),
  topicId: 9002, origin: 'demo',
}))
