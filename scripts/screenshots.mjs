#!/usr/bin/env node
/**
 * 生成项目文档用的模拟展示截图：docs/screenshots/*.png
 *
 * 不使用任何真实论坛内容。页面是本地拼出的 Discourse 风格模拟主题（用户名、头像、帖子均为虚构，
 * 页面顶部标注“模拟数据”），在其上运行构建好的 dist/threadmap.user.js。
 * 不访问网络：所有请求都被拦截在本地。
 *
 *   npm run build && npm run screenshots   # 可用 THREADMAP_CHROME 指定浏览器
 */
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'docs', 'screenshots')
const script = await fs.readFile(path.join(root, 'dist', 'threadmap.user.js'), 'utf8')
await fs.mkdir(out, { recursive: true })

const NAMES = ['青柠', '松果', '白鹭', '小满', '阿柚', '北辰', '云杉', '橘子汽水']
const COLORS = ['#3f8f7a', '#c47a2c', '#5a6fb5', '#b25a7a', '#6b8f3a', '#4a86a8', '#8a6bb0', '#c0563f']
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// 接龙主题：与 src/demo/fixture.ts 的接龙结构相同（插话、并行、断链、多音字、重复、分叉），换成虚构用户名
const CHAIN = ['一心一意', '意气风发', '发奋图强', '强人所难', '这个帖子是不是只能用成语？', '难能可贵', '贵在坚持', '贵耳贱目', '持之以恒', '目不转睛', '恒河沙数', '谢谢分享', '精益求精', '数一数二', '海阔天空', '空前绝后', '后来居上', '上行下效', '笑逐颜开', '开天辟地', '川流不息\n息息相关\n关关雎鸠\n咎由自取', '讨论积分乐园', '取之不尽\n尽力而为\n为所欲为\n为所欲为', '曲高和寡\n刮目相看\n侃侃而谈\n贪得无厌', '艳阳高照', '照本宣科', '科班出身', '身体力行', '行云流水', '水到渠成', '水滴石穿', '成竹在胸', '一心一意', '义无反顾', '故弄玄虚', '虚与委蛇', '舌战群儒', '加油，这条链越来越长了', '儒雅风流', '流连忘返', '返璞归真', '真心实意', '意犹未尽', '尽善尽美', '美不胜数', '鼠目寸光']
const chainPosts = CHAIN.map((text, i) => ({ n: i + 1, user: NAMES[i % NAMES.length], text, reply: i + 1 === 23 || i + 1 === 24 ? 21 : null, likes: 0 }))

// 问答主题：普通长帖里的重复提问（虚构）
const QA = [
  ['欢迎在这里交流脚本的使用问题，看到会尽量回复。', null, 3],
  ['请问这个脚本怎么安装？', null, 0],
  ['先装油猴（Tampermonkey），再打开 Release 里的 user.js 点安装。', 2, 9],
  ['邀请码在哪里领？', null, 0],
  ['装好之后面板在哪？没看到', null, 0],
  ['大佬们，脚本要怎么安装啊', null, 0],
  ['在屏幕右边缘，有个小按钮，点一下就展开了。', 5, 4],
  ['邀请码这个帖子不管哈，去站务区问。', 4, 2],
  ['深色模式下颜色正常吗？', null, 0],
  ['脚本安装方法是什么？', null, 0],
  ['怎么获取邀请码', null, 0],
  ['面板找不到在哪里', null, 0],
  ['会跟着论坛的深浅色切换，不用设置。', 9, 3],
  ['会上传我的数据吗？', null, 0],
  ['为啥看不到面板？', null, 0],
  ['不会，只在本地计算，只读。', 14, 6],
].map(([text, reply, likes], i) => ({ n: i + 1, user: NAMES[(i * 3) % NAMES.length], text, reply, likes }))
// 第 17 楼引用第 2 楼提问作答（演示“引用也算回答”）
QA.push({ n: 17, user: NAMES[5], text: '装法看 README 就行，写得挺清楚。', reply: null, likes: 1, quote: 2 })

function page(title, posts, topicId, dark) {
  const cooked = p => (p.quote ? `<aside class="quote" data-post="${p.quote}" data-topic="${topicId}"><blockquote><p>…</p></blockquote></aside>` : '') + p.text.split('\n').map(l => `<p>${esc(l)}</p>`).join('')
  const store = { id: topicId, postStream: { stream: posts.map(p => topicId * 1000 + p.n), posts: posts.map(p => ({ id: topicId * 1000 + p.n, post_number: p.n, username: p.user, cooked: cooked(p), reply_to_post_number: p.reply, like_count: p.likes, created_at: '2026-10-01T08:00:00Z' })) } }
  return `<!doctype html><html lang="zh-CN" class="${dark ? 'dark' : ''}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
:root{--header-offset:56px;--secondary:${dark ? '#1a1a1a' : '#ffffff'};--primary:${dark ? '#e8e8e8' : '#222'};--muted:${dark ? '#9a9a9a' : '#777'};--line:${dark ? '#333' : '#e6e6e6'};--card:${dark ? '#222' : '#fff'}}
*{box-sizing:border-box}body{margin:0;background:var(--secondary);color:var(--primary);font:15px/1.7 Inter,"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif}
.d-header{position:fixed;top:0;left:0;right:0;height:56px;z-index:1000;display:flex;align-items:center;gap:12px;padding:0 24px;background:var(--card);border-bottom:1px solid var(--line)}
.logo{font-weight:800;font-size:18px}.mock{margin-left:auto;padding:2px 10px;border-radius:999px;background:#fdf0d8;color:#7a4f0e;font-size:12px;font-weight:600}
main{max-width:760px;margin:0 auto;padding:80px 24px 200px;margin-right:max(24px,calc(50vw - 380px + 200px))}
h1{font-size:24px;margin:8px 0 4px}.cat{color:var(--muted);font-size:13px;margin-bottom:16px}
.topic-post{display:grid;grid-template-columns:48px 1fr;gap:12px;padding:16px 0;border-top:1px solid var(--line)}
.avatar{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700}
.names{display:flex;gap:10px;align-items:baseline}.username{font-weight:700}.num{color:var(--muted);font-size:12px;margin-left:auto}
.cooked p{margin:4px 0}.cooked aside{border-left:3px solid var(--line);padding-left:10px;color:var(--muted);font-size:13px}
.reply-to{color:var(--muted);font-size:12px}
</style><script>window.Discourse={__container__:{lookup:n=>n==='controller:topic'?{model:${JSON.stringify(store)}}:undefined}}</script></head><body>
<header class="d-header"><span class="logo">示例论坛</span><span class="mock">模拟数据 · 用户名与内容均为虚构</span></header>
<main><h1>${esc(title)}</h1><div class="cat">${topicId === 9101 ? '游戏 · 接龙' : '资源 · 脚本'}</div>
${posts.map(p => `<div class="topic-post" data-post-number="${p.n}"><div class="avatar" style="background:${COLORS[NAMES.indexOf(p.user)]}">${esc(p.user.slice(0, 1))}</div>
<article id="post_${p.n}" data-post-id="${topicId * 1000 + p.n}" data-topic-id="${topicId}"><div class="names"><span class="username">${esc(p.user)}</span>${p.reply ? `<span class="reply-to">↪ 回复 #${p.reply}</span>` : ''}<span class="num">#${p.n}</span></div><div class="cooked">${cooked(p)}</div></article></div>`).join('\n')}
</main></body></html>`
}

const browser = await chromium.launch({ headless: true, ...(process.env.THREADMAP_CHROME ? { executablePath: process.env.THREADMAP_CHROME } : {}) })
const shots = []
const errors = []
const unexpectedRequests = []
async function open(html, url, dark = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce', serviceWorkers: 'block', offline: true })
  context.setDefaultTimeout(8000)
  // 只提供这一个模拟页面；其余请求一律阻断，并让截图任务失败。
  await context.route('**/*', route => {
    const req = route.request()
    if (req.isNavigationRequest() && req.method() === 'GET' && req.url() === url) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    unexpectedRequests.push(`${req.method()} ${req.url()}`)
    return route.abort()
  })
  const p = await context.newPage()
  p.on('pageerror', error => errors.push(String(error)))
  await p.goto(url)
  await p.addScriptTag({ content: script })
  await p.getByRole('button', { name: /^展开 ThreadMap/ }).waitFor()
  return p
}
const scrollTo = (p, n) => p.evaluate(n => { const el = document.querySelector(`[data-post-number="${n}"]`); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70) }, n)
async function shot(p, name, note) {
  await p.evaluate(() => document.fonts.ready)
  assert(await p.getByText('模拟数据 · 用户名与内容均为虚构', { exact: true }).isVisible(), '每张图必须保留模拟数据标识')
  assert.deepEqual(errors, [], '页面不应有运行时错误')
  assert.deepEqual(unexpectedRequests, [], '不得请求模拟页面以外的内容')
  await p.screenshot({ path: path.join(out, name) })
  shots.push([name, note])
}

try {
  const chainHtml = page('成语接龙，来接！', chainPosts, 9101, false)
  let p = await open(chainHtml, 'https://meta.discourse.org/t/chengyu/9101')
  await p.locator('[data-post-number="8"] .threadmap-badge').waitFor()
  await scrollTo(p, 8)
  await shot(p, '01-badges.png', '原帖标注：每楼接到哪、分叉（⑂）、断链（✕）；屏幕边缘的按钮显示现在该接的字')
  await p.getByRole('button', { name: /^展开 ThreadMap/ }).click()
  await p.locator('#tm-try').fill('光明正大')
  await p.locator('.tm-results').getByText(/能接 #46/).waitFor()
  await p.getByRole('button', { name: '查看判断', exact: true }).click()
  await p.locator('.tm-detail-head h3', { hasText: '#46' }).waitFor()
  await p.locator('.tm-body').evaluate(el => { el.scrollTop = 0 })
  await scrollTo(p, 41)
  await shot(p, '02-next.png', '现在该接：链头、末字读音，试接一个词看能不能接上')
  await p.getByRole('tab', { name: /^问题/ }).click()
  await p.getByRole('button', { name: /^断链 \d+$/ }).click()
  await p.locator('.tm-issues').getByText('断链', { exact: true }).first().waitFor()
  await shot(p, '03-issues.png', '问题列表：按断链、分叉、待确认、重复筛选，可定位或看详情')
  await p.getByRole('tab', { name: /^接龙/ }).click()
  await p.getByRole('button', { name: '钉成小窗' }).click()
  const hud = p.getByRole('region', { name: 'ThreadMap 接龙小窗' })
  await hud.waitFor()
  const size = await hud.boundingBox()
  assert.equal(size.width, 272)
  assert.equal(size.height, 138)
  await scrollTo(p, 30)
  await shot(p, '04-hud.png', '钉成小窗：三格读数，点任意一格展开；拖动标题栏换边')
  await p.context().close()

  p = await open(page('脚本使用问题集中贴', QA, 9102, false), 'https://meta.discourse.org/t/qa/9102')
  await scrollTo(p, 9)
  await p.getByRole('button', { name: /^展开 ThreadMap/ }).click()
  await p.locator('#tm-ask').fill('脚本如何安装')
  const result = p.locator('.tm-results .tm-result').filter({ hasText: '脚本怎么安装' })
  await result.getByRole('button', { name: '查看' }).click()
  const group = p.getByRole('region', { name: '问题组' })
  await group.getByRole('button', { name: '跳到首问' }).waitFor()
  assert((await group.innerText()).includes('#3'), '应展示明确回复的回答')
  assert((await group.innerText()).includes('#17'), '应展示引用提问的回答')
  await p.locator('.tm-body').evaluate(el => { el.scrollTop = 0 })
  await shot(p, '05-qa.png', '问答模式：找出被反复问过的问题和已有回答，发问前先查一下')
  await p.context().close()

  p = await open(page('成语接龙，来接！', chainPosts, 9101, true), 'https://meta.discourse.org/t/chengyu/9101', true)
  await scrollTo(p, 21)
  await p.getByRole('button', { name: /^展开 ThreadMap/ }).click()
  await p.locator('[data-post-number="24"] .threadmap-badge').click()
  await p.locator('.tm-detail-head h3', { hasText: '#24' }).waitFor()
  assert.equal(await p.locator('[data-post-number="24"] .threadmap-badge').getAttribute('data-scheme'), 'dark')
  await shot(p, '06-dark.png', '深色主题：跟随论坛配色；点原帖标注直接看这楼的判断')
  await p.context().close()
} finally {
  await browser.close()
}

await fs.writeFile(path.join(out, 'README.md'), `# 展示截图\n\n由 \`npm run build && npm run screenshots\` 生成，可用 \`THREADMAP_CHROME\` 指定本地 Chromium。仅手动运行，不接入定时任务或 CI，不调用付费服务。\n\n页面为本地模拟的 Discourse 风格主题，用户名、文字头像、帖子内容均为虚构。浏览器使用全新临时上下文、离线模式，所有页面请求在本地拦截；没有访问 meta.discourse.org 的真实帖子，也不使用登录资料或真实用户截图。这些图片用于展示，不是实站兼容性验证。\n\n每张图都保留“模拟数据”标识；请勿裁掉它。视口 1280×800，输出为 2 倍像素密度 PNG（2560×1600），使用真实构建的 \`dist/threadmap.user.js\`，未后期修改界面或判断结果。\n\n${shots.map(([n, note]) => `## ${n}\n\n${note}。\n\n![${note}](${n})`).join('\n\n')}\n`)
console.log(`已生成 ${shots.length} 张截图；页面错误 ${errors.length}，额外请求 ${unexpectedRequests.length}。\n${shots.map(([n]) => n).join('\n')}`)
