import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { seedPosts, historyPosts, hostHtml, topicId, post } from './fixtures.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(project, 'acceptance', 'artifacts');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.THREADMAP_CHROME ? { executablePath: process.env.THREADMAP_CHROME } : {}) });
const report = [];
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
context.setDefaultTimeout(6000);
context.on('page', p => p.on('pageerror', e => errors.push(String(e))));
const demoRoot = path.join(project, 'dist', 'demo');
const server = http.createServer(async (req,res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const target = path.resolve(demoRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!target.startsWith(demoRoot+path.sep)) throw new Error('invalid path');
    const content = await fs.readFile(target);
    res.setHeader('Content-Type', ({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(target)] || 'application/octet-stream');
    res.end(content);
  } catch { res.statusCode=404;res.end('not found'); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function check(name, action) {
  try { await action(); report.push({name,status:'passed'});console.log(`PASS ${name}`); }
  catch(e) {report.push({name,status:'failed',error:String(e)});console.log(`FAIL ${name}: ${e}`);}
}

try {
  const demo = await context.newPage();
  const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
  const panel = page => page.locator('.tm-panel');
  const edge = page => page.getByRole('button', { name: /^展开 ThreadMap/ });
  const box = async locator => { const b = await locator.boundingBox(); assert(b, 'element not visible'); return b; };
  const near = (a, b, label) => assert(Math.abs(a - b) <= 1, `${label}: ${a} ≠ ${b}`);

  await check('基准：三个固定区域高度固定，面板贴右、占满视口高度', async()=>{
    await demo.goto(base);
    await panel(demo).waitFor();
    const p = await box(panel(demo));
    near(p.x + p.width, 1440, 'right'); near(p.y, 0, 'top'); near(p.height, 960, 'height'); near(p.width, 380, 'width');
    near((await box(demo.locator('.tm-header'))).height, 48, 'header');
    near((await box(demo.locator('.tm-tabs'))).height, 40, 'tabs');
    near((await box(demo.locator('.tm-status'))).height, 36, 'status');
  });
  await check('基准：内容区是唯一滚动区域，滚到底也不带动页面', async()=>{
    await demo.setViewportSize({ width: 1440, height: 560 });
    const body = demo.locator('.tm-body');
    const metrics = await body.evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight }));
    assert(metrics.scroll > metrics.client, `内容应溢出以便测试: ${JSON.stringify(metrics)}`);
    near((await box(panel(demo))).height, 560, 'panel fits viewport');
    const before = await demo.evaluate(() => window.scrollY);
    const b = await box(body);
    await demo.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    for (let i = 0; i < 8; i++) await demo.mouse.wheel(0, 600);
    await demo.waitForTimeout(250);
    assert(await body.evaluate(el => el.scrollTop) > 0, '面板内容应能滚动');
    assert.equal(await demo.evaluate(() => window.scrollY), before, '面板滚动不应传到页面');
    await body.evaluate(el => { el.scrollTop = 0 });
    await demo.setViewportSize({ width: 1440, height: 960 });
  });
  await check('交互：标签用方向键切换，焦点跟随', async()=>{
    for (const name of ['问题','规则','接龙']) { await tab(demo,name).click(); assert.equal(await tab(demo,name).getAttribute('aria-selected'),'true'); }
    await tab(demo,'接龙').focus();
    await demo.keyboard.press('ArrowLeft');
    assert.equal(await tab(demo,'规则').getAttribute('aria-selected'),'true');
    assert(await tab(demo,'规则').evaluate(el => el === document.activeElement));
    await tab(demo,'接龙').click();
  });
  await check('内容：当前链头、原帖标注、词典读音与多音待确认', async()=>{
    const text = await panel(demo).innerText();
    assert(text.includes('现在该接') && text.includes('#46'), text.slice(0, 300));
    assert(await demo.locator('.demo-post .threadmap-badge').count() >= 40);
    assert((await demo.locator('[data-post-number="37"] .threadmap-badge').innerText()).includes('断链'));
    assert((await demo.locator('[data-post-number="46"] .threadmap-badge').innerText()).includes('多音待确认'));
  });
  await check('内容：试接给出能接、接不上与重复；Esc 先清空输入', async()=>{
    const input = demo.locator('#tm-try');
    await input.fill('光明正大');
    assert((await demo.locator('.tm-results').innerText()).includes('能接 #46'));
    await input.fill('海阔天空');
    const text = await demo.locator('.tm-results').innerText();
    assert(text.includes('接不上 #46') && text.includes('#15 用过了'), text);
    await input.press('Escape');
    assert.equal(await input.inputValue(), '');
    assert(await panel(demo).isVisible(), '清空输入的 Esc 不应收起面板');
  });
  await check('交互：问题筛选；“详情”回到接龙页并聚焦标题；标签记住滚动位置', async()=>{
    await tab(demo,'问题').click();
    await demo.getByRole('button',{name:/^断链 \d+$/}).click();
    const list = await demo.locator('.tm-issues').innerText();
    assert(list.includes('#12') && !list.includes('分叉'), list);
    await demo.setViewportSize({ width: 1440, height: 420 });
    await demo.locator('.tm-body').evaluate(el => { el.scrollTop = 120 });
    await demo.waitForTimeout(50);
    await demo.getByRole('button',{name:'查看第 12 楼详情'}).click();
    await demo.locator('.tm-detail-head h3',{hasText:'#12 · reader12'}).waitFor();
    await demo.waitForFunction(() => document.activeElement?.matches('.tm-detail-head h3'));
    await tab(demo,'问题').click();
    assert(await demo.locator('.tm-body').evaluate(el => el.scrollTop) >= 100, '返回问题页应恢复滚动位置');
    await demo.setViewportSize({ width: 1440, height: 960 });
    await tab(demo,'接龙').click();
    assert(!(await demo.evaluate(() => document.activeElement?.matches('.tm-detail-head h3'))), '手动切回不应再抢焦点');
  });
  await check('交互：不算接龙与恢复自动可撤销', async()=>{
    const detail = demo.locator('section[aria-label="第 12 楼的判断"]');
    await detail.getByRole('button',{name:'不算接龙',exact:true}).click();
    assert((await detail.innerText()).includes('已排除'));
    await detail.getByRole('button',{name:'恢复自动',exact:true}).click();
    assert((await detail.innerText()).includes('断链'));
  });
  await check('交互：点击原帖标注聚焦该楼；“跳到”滚动页面并高亮', async()=>{
    await demo.locator('[data-post-number="8"] .threadmap-badge').click();
    await demo.locator('.tm-detail-head h3',{hasText:'#8 · Mint'}).waitFor();
    await demo.locator('section[aria-label="第 8 楼的判断"]').getByRole('button',{name:'跳到原帖'}).click();
    await demo.locator('[data-post-number="8"].threadmap-flash').waitFor();
  });
  await check('交互：规则切换立即重算', async()=>{
    await tab(demo,'规则').click();
    await demo.getByRole('switch',{name:'允许同音字接'}).click();
    await demo.locator('[data-post-number="13"] .threadmap-badge',{hasText:'断链'}).waitFor();
    await demo.getByRole('switch',{name:'允许同音字接'}).click();
    await demo.locator('[data-post-number="13"] .threadmap-badge',{hasText:'同音同调'}).waitFor();
    await tab(demo,'接龙').click();
  });
  await check('基准：所有可点击目标不小于 24×24（WCAG 2.5.8）', async()=>{
    for (const name of ['接龙','问题','规则']) {
      await tab(demo,name).click();
      const small = await panel(demo).evaluate(root => [...root.querySelectorAll('button,input,select,[role=separator][tabindex]')].filter(el => el.offsetParent !== null && !el.classList.contains('tm-link') && !el.classList.contains('tm-resize')).map(el => ({ t: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 12), w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height })).filter(r => r.w < 24 || r.h < 24));
      assert.deepEqual(small, [], `${name}: ${JSON.stringify(small)}`);
    }
    await tab(demo,'接龙').click();
  });
  await check('基准：深色配色跟随宿主切换', async()=>{
    const bg = () => demo.locator('.tm-panel').evaluate(el => getComputedStyle(el).backgroundColor);
    const light = await bg();
    await demo.getByRole('button',{name:'切换到深色面板'}).click();
    await demo.waitForFunction(() => getComputedStyle(document.querySelector('.tm-panel')).backgroundColor === 'rgb(21, 27, 25)');
    assert.notEqual(await bg(), light);
    assert.equal(await demo.locator('[data-post-number="2"] .threadmap-badge').getAttribute('data-scheme'), 'dark');
    await demo.screenshot({ path: path.join(out, 'desktop-dark.png') });
    await demo.getByRole('button',{name:'切换到浅色面板'}).click();
  });
  await demo.evaluate(() => window.scrollTo(0, 0));
  await demo.screenshot({ path: path.join(out, 'desktop.png') });
  await check('状态机：Esc 依次退出全屏、收起；焦点回到贴边按钮，标注保留', async()=>{
    await demo.getByRole('button',{name:'全屏'}).click();
    near((await box(panel(demo))).width, 1440, 'full width');
    await demo.locator('.tm-tab').first().focus();
    await demo.keyboard.press('Escape');
    near((await box(panel(demo))).width, 380, 'back to open');
    await demo.keyboard.press('Escape');
    assert(await panel(demo).isHidden());
    await edge(demo).waitFor();
    await demo.waitForFunction(() => document.activeElement?.classList.contains('tm-edge'), null, { timeout: 2000 });
    assert(await demo.locator('.threadmap-badge').count() > 0, '收起时保留原帖标注');
    const e = await box(edge(demo));
    near(e.x + e.width, 1440, 'edge flush right'); near(e.width, 36, 'edge width'); near(e.height, 76, 'edge height');
    assert((await edge(demo).getAttribute('aria-label')).includes('现在该接“光”'));
  });
  await check('交互：拖动贴边按钮松手吸附到较近一侧，并被记住', async()=>{
    const e = await box(edge(demo));
    await demo.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
    await demo.mouse.down();
    await demo.mouse.move(600, 300, { steps: 6 });
    await demo.mouse.move(300, 300, { steps: 6 });
    await demo.mouse.up();
    await demo.waitForTimeout(100);
    const after = await box(edge(demo));
    near(after.x, 0, 'snapped left');
    assert(await panel(demo).isHidden(), '拖动不应展开面板');
    assert.equal(JSON.parse(await demo.evaluate(() => localStorage.getItem('threadmap-prefs-v2'))).dock.side, 'left');
    await edge(demo).click();
    near((await box(panel(demo))).x, 0, 'panel opens on left');
    await tab(demo,'规则').click();
    await demo.getByRole('group',{name:'停靠位置'}).getByRole('button',{name:'右侧'}).click();
    near((await box(panel(demo))).x + 380, 1440, 'back to right');
    await tab(demo,'接龙').click();
  });
  await check('小窗（参考 Game Bar）：钉住后尺寸固定、贴边悬浮；读数可点；可拖动；Esc 收起', async()=>{
    await demo.getByRole('button',{name:'钉成小窗'}).click();
    const hud = demo.getByRole('region',{name:'ThreadMap 接龙小窗'});
    await hud.waitFor();
    await demo.waitForTimeout(250);
    let b = await box(hud);
    near(b.width, 272, 'hud width'); near(b.height, 138, 'hud height'); near(b.x + b.width, 1440 - 12, 'hud floats 12px from edge');
    assert(await panel(demo).isHidden(), '钉住后面板隐藏');
    await demo.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '展开面板');
    const text = await hud.innerText();
    assert(text.includes('现在该接') && text.includes('46/46') && text.includes('跳到 #46'), text);
    await demo.screenshot({ path: path.join(out, 'hud.png') });
    const bar = await box(hud.locator('.tm-hud-bar'));
    await demo.mouse.move(bar.x + 40, bar.y + bar.height / 2); await demo.mouse.down();
    await demo.mouse.move(500, 500, { steps: 6 }); await demo.mouse.move(200, 520, { steps: 6 }); await demo.mouse.up();
    await demo.waitForTimeout(250);
    b = await box(hud);
    near(b.x, 12, 'hud snapped left');
    await hud.getByRole('button',{name:/^问题 \d+/}).click();
    assert.equal(await tab(demo,'问题').getAttribute('aria-selected'),'true','点读数展开到对应标签');
    near((await box(panel(demo))).x, 0, '面板跟随停靠到左侧');
    await demo.getByRole('button',{name:'钉成小窗'}).click();
    await hud.waitFor();
    await demo.keyboard.press('Escape');
    await edge(demo).waitFor();
    await demo.waitForFunction(() => document.activeElement?.classList.contains('tm-edge'));
    await edge(demo).click();
    await tab(demo,'规则').click();
    await demo.getByRole('group',{name:'停靠位置'}).getByRole('button',{name:'右侧'}).click();
    await tab(demo,'接龙').click();
  });
  await check('基准：320px 宽时面板占满宽度、无横向滚动、隐藏全屏', async()=>{
    await demo.setViewportSize({ width: 320, height: 640 });
    const p = await box(panel(demo));
    near(p.x, 0, 'left'); near(p.width, 320, 'width');
    assert(await demo.locator('.tm-body').evaluate(el => el.scrollWidth <= el.clientWidth), '内容区不应横向溢出');
    assert(await demo.getByRole('button',{name:'全屏'}).isHidden());
    await demo.screenshot({ path: path.join(out, 'mobile.png') });
    await demo.setViewportSize({ width: 1440, height: 960 });
  });

  const script = await fs.readFile(path.join(project,'dist','threadmap.user.js'),'utf8');
  await check('UserScript 构建产物含元数据、许可说明与内联样式', async()=>{
    assert(script.startsWith('// ==UserScript=='));
    assert(script.includes('// @match        https://linux.do/t/*'));
    const { version } = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
    assert(script.includes(`// @version      ${version}`));
    assert(script.includes('CC BY-SA 4.0'));
    assert(script.includes('.tm-panel'));
    assert(!script.includes('pinyin-pro'));
  });
  const integration = await context.newPage();
  const requests = [];
  let failure = null;
  let holdBatch = false;
  await integration.route('**/*', async route=>{
    const req=route.request(), u=new URL(req.url());
    if(u.pathname.endsWith('.json')) {
      requests.push({url:req.url(),method:req.method()});
      if(failure === 'challenge') return route.fulfill({status:403,contentType:'text/html',body:'<!doctype html><title>Just a moment...</title>'});
      if(failure) return route.fulfill({status:failure,contentType:'application/json',body:'{}'});
      if(u.pathname===`/t/${topicId}.json`) return route.fulfill({contentType:'application/json',body:JSON.stringify({id:topicId,posts_count:historyPosts.length,post_stream:{posts:seedPosts,stream:historyPosts.map(p=>p.id)}})});
      if(u.pathname===`/t/${topicId}/posts.json`) {
        assert.equal(req.method(),'GET');
        const ids=u.searchParams.getAll('post_ids[]').map(Number);
        assert(ids.length>0 && ids.length<=20, '必须使用 post_ids[] 数组，每批最多20');
        assert(ids.every(id=>historyPosts.some(p=>p.id===id)),'批量请求必须使用数据库ID');
        if(holdBatch) await new Promise(resolve=>setTimeout(resolve,1500));
        return route.fulfill({contentType:'application/json',body:JSON.stringify({post_stream:{posts:historyPosts.filter(p=>ids.includes(p.id))}})}).catch(()=>{});
      }
      return route.fulfill({status:404,body:'{}'});
    }
    if(req.isNavigationRequest()) return route.fulfill({contentType:'text/html',body:hostHtml()});
    return route.fulfill({status:404,body:''});
  });
  await check('UserScript：贴边按钮常驻、默认收起；接龙主题收起时也标注；不抓历史', async()=>{
    await integration.goto(`https://linux.do/t/acceptance/${topicId}`);
    await integration.addScriptTag({content:script});
    await edge(integration).waitFor();
    await integration.waitForTimeout(300);
    assert.equal(await panel(integration).isVisible(), false, '默认收起');
    assert.equal(await integration.locator('.threadmap-badge').count(), 3);
    assert((await integration.locator('[data-post-number="21"] .threadmap-badge').innerText()).includes('前文未载入'));
    assert.equal(requests.length, 0);
  });
  await check('UserScript：面板避开论坛 header 与编辑器', async()=>{
    await edge(integration).click();
    let p = await box(panel(integration));
    near(p.y, 0, 'no header → top 0'); near(p.height, 960, 'full height'); near(p.x + p.width, 1440, 'flush right');
    await integration.evaluate(() => { document.documentElement.style.setProperty('--header-offset', '60px'); document.documentElement.style.setProperty('--composer-height', '300px'); document.documentElement.classList.add('composer-open') });
    p = await box(panel(integration));
    near(p.y, 60, 'below header'); near(p.y + p.height, 660, 'above composer');
    await integration.evaluate(() => { document.documentElement.style.removeProperty('--header-offset'); document.documentElement.style.removeProperty('--composer-height'); document.documentElement.classList.remove('composer-open') });
    assert((await panel(integration).innerText()).includes('3 个接龙帖'));
  });
  await check('UserScript：标注点击聚焦；收起后标注保留', async()=>{
    await integration.getByRole('button',{name:'收起面板'}).click();
    await integration.locator('[data-post-number="24"] .threadmap-badge').click();
    await integration.locator('.tm-detail-head h3',{hasText:'#24 · wowayou'}).waitFor();
    await integration.evaluate(()=>window.scrollBy(0,200));
    await integration.waitForTimeout(300);
    assert((await panel(integration).innerText()).includes('3 个接龙帖'),'重读 DOM 时不能把标注读成正文');
    assert.equal(await integration.locator('.threadmap-badge').count(), 3);
    assert.equal(requests.length, 0, '标注不应触发网络请求');
  });
  await check('UserScript：可取消加载，已载入部分保留', async()=>{
    holdBatch=true;
    await integration.getByRole('button',{name:'加载全部楼层',exact:true}).click();
    await integration.getByRole('button',{name:'取消加载',exact:true}).click();
    await integration.getByText('已取消').waitFor();
    holdBatch=false;
  });
  await check('UserScript：完整读取按数据库 ID 串行分批，缺口判断随之消失', async()=>{
    const before=requests.length;
    await integration.getByRole('button',{name:'加载全部楼层',exact:true}).click();
    await integration.getByRole('button',{name:'检查新楼层',exact:true}).waitFor({timeout:15000});
    assert.equal(requests.length-before,4,'1 topic + 3 batches for 41 missing posts');
    const text=await panel(integration).innerText();
    assert(text.includes('已载入 45 楼 / 45') && text.includes('已载入全部楼层'), text.slice(0,300));
    assert(!text.includes('前文没载入'));
    assert((await integration.locator('[data-post-number="21"] .threadmap-badge').innerText()).includes('开局'));
    await integration.screenshot({path:path.join(out,'userscript.png')});
  });
  await check('UserScript：阅读位置随正文滚动显示在状态栏', async()=>{
    await integration.evaluate(()=>window.scrollTo(0, document.body.scrollHeight));
    await integration.waitForTimeout(250);
    assert((await integration.locator('.tm-status').innerText()).includes('阅读 #24'));
  });
  await check('UserScript：429 有明确提示且不自动重试', async()=>{
    failure=429;
    const before=requests.length;
    await integration.getByRole('button',{name:'检查新楼层',exact:true}).click();
    await integration.getByRole('alert').filter({hasText:'429'}).waitFor();
    await integration.waitForTimeout(400);
    assert.equal(requests.length,before+1);
    failure=null;
  });
  await check('UserScript：Cloudflare 验证页提示去完成验证，而不是“没有权限”', async()=>{
    failure='challenge';
    await integration.getByRole('button',{name:'检查新楼层',exact:true}).click();
    await integration.getByRole('alert').filter({hasText:'人机验证'}).waitFor();
    failure=null;
  });
  await check('UserScript：DOM 新楼合并后不丢失已加载历史', async()=>{
    await integration.evaluate(html=>{
      const doc=new DOMParser().parseFromString(html,'text/html');
      document.querySelector('#topic').append(document.importNode(doc.querySelector('.topic-post'),true));
    },hostHtml([post(46,'新的普通讨论内容。')]));
    await integration.waitForTimeout(500);
    assert((await panel(integration).innerText()).includes('已载入 46 楼 / 45'));
  });
  await check('UserScript：同主题导航保留面板与已载入状态', async()=>{
    await integration.evaluate(()=>history.pushState({},'', '/t/acceptance/7001/46'));
    await integration.waitForTimeout(250);
    assert(await panel(integration).isVisible());
    assert((await panel(integration).innerText()).includes('46 楼 / 45'));
  });
  await check('UserScript：SPA 切换主题清理旧数据与标注，回到收起', async()=>{
    const nextHtml=hostHtml([post(1,'新主题的第一条普通讨论。',null,7002)],7002);
    await integration.evaluate(()=>history.pushState({},'', '/t/another-topic/7002'));
    assert.equal(await integration.locator('.threadmap-badge').count(),0);
    await integration.evaluate(html=>{
      const doc=new DOMParser().parseFromString(html,'text/html');
      document.querySelector('#topic').replaceWith(document.importNode(doc.querySelector('#topic'),true));
    },nextHtml);
    await integration.waitForTimeout(400);
    assert(await panel(integration).isHidden(), '新主题默认收起');
    await edge(integration).click();
    const text=await panel(integration).innerText();
    assert(text.includes('7002') && text.includes('已载入 1 楼'), text.slice(0,300));
    assert(!text.includes('Charm') && !text.includes('wowayou'));
  });
  await check('UserScript：离开主题页面移除面板与贴边按钮', async()=>{
    await integration.evaluate(()=>{history.pushState({},'', '/latest');document.querySelector('#topic')?.remove();});
    await integration.waitForTimeout(300);
    assert.equal(await integration.locator('#threadmap-root').count(),0);
  });
  await check('问答模式：非接龙主题自动切换；标注重复提问；先查再问；点击标注聚焦问题组', async()=>{
    const qaTopic = 7003;
    const quote = n => `<aside class="quote no-group" data-username="reader${n}" data-post="${n}" data-topic="${qaTopic}"><blockquote><p>引用</p></blockquote></aside>`;
    const qaPosts = [
      post(1, '大家有问题就在这里问。', null, qaTopic),
      post(2, '请问这个脚本怎么安装？', null, qaTopic),
      { ...post(3, '先装油猴，再点安装链接。', null, qaTopic), cooked: quote(2) + '<p>先装油猴，再点安装链接。</p>' },
      post(4, '大佬们，脚本要怎么安装啊', null, qaTopic),
      post(5, '邀请码在哪里领？', null, qaTopic),
      post(6, '脚本安装方法是什么？', null, qaTopic),
      post(7, '怎么获取邀请码', null, qaTopic),
    ];
    const page = await context.newPage();
    await page.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: hostHtml(qaPosts, qaTopic) }) : route.fulfill({ status: 404, body: '' }));
    await page.goto(`https://linux.do/t/qa/${qaTopic}`);
    await page.addScriptTag({ content: script });
    await edge(page).waitFor();
    assert((await edge(page).getAttribute('aria-label')).includes('2 个问题被重复问过'));
    assert((await page.locator('[data-post-number="2"] .threadmap-badge').innerText()).includes('被问过 3 次 · 1 条回答'));
    assert((await page.locator('[data-post-number="6"] .threadmap-badge').innerText()).includes('相似问题见 #2'));
    assert.equal(await page.locator('[data-post-number="3"] .threadmap-badge').count(), 0, '回答楼不标注');
    await page.locator('[data-post-number="6"] .threadmap-badge').click();
    await page.locator('section[aria-label="问题组"] h3', { hasText: '问过 3 次' }).waitFor();
    await page.waitForFunction(() => document.querySelector('#threadmap-root').shadowRoot.activeElement?.matches('h3'));
    assert.deepEqual((await page.getByRole('tab').allInnerTexts()).map(t => t.replace(/\s+/g, '')), ['问答2', '规则']);
    assert((await panel(page).innerText()).includes('帖子问答'));
    await page.locator('#tm-ask').fill('脚本如何安装');
    assert((await page.locator('.tm-results').innerText()).includes('问过 3 次 · 1 条回答'));
    await page.locator('#tm-ask').fill('完全无关');
    assert((await page.locator('.tm-results').innerText()).includes('没有找到相似的提问'));
    await page.screenshot({ path: path.join(out, 'qa.png') });
    await page.close();
  });
  await check('超大主题：加载前说明请求数与耗时，确认后才发请求；滚动时不卡', async()=>{
    const bigTopic = 7004, total = 3000;
    const shown = Array.from({ length: 20 }, (_, i) => post(i + 1, ['一心一意','意气风发','发奋图强','强人所难','难能可贵'][i % 5], null, bigTopic));
    const seen = [];
    const page = await context.newPage();
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.pathname.endsWith('.json')) { seen.push(u.pathname); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: bigTopic, post_stream: { posts: [], stream: Array.from({ length: total }, (_, i) => bigTopic * 1000 + i + 1) } }) }) }
      return route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: hostHtml(shown, bigTopic) }) : route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`https://linux.do/t/big/${bigTopic}`);
    // 模拟 Discourse 页面数据：完整 stream 已知，只加载了前 20 楼
    await page.evaluate(([topic, n, posts]) => { window.Discourse = { __container__: { lookup: name => name === 'controller:topic' ? { model: { id: topic, postStream: { stream: Array.from({ length: n }, (_, i) => topic * 1000 + i + 1), posts } } } : undefined } } }, [bigTopic, total, shown.map(p => ({ id: p.id, post_number: p.post_number, username: p.username, cooked: p.cooked, reply_to_post_number: null }))]);
    await page.addScriptTag({ content: script });
    await edge(page).click();
    await page.getByRole('button', { name: '加载全部楼层' }).click();
    const banner = await page.getByRole('alert').filter({ hasText: '还有 2980 楼未载入' }).innerText();
    assert(banner.includes('149 次请求') && banner.includes('分钟'), banner);
    await page.getByRole('button', { name: '先不加载' }).click();
    assert.equal(seen.length, 0, '确认前不发请求');
    const longest = await page.evaluate(async () => {
      let worst = 0; const obs = new PerformanceObserver(list => list.getEntries().forEach(e => { worst = Math.max(worst, e.duration) })); obs.observe({ entryTypes: ['longtask'] });
      for (let i = 0; i < 20; i++) { window.scrollBy(0, 300); await new Promise(r => requestAnimationFrame(r)) }
      await new Promise(r => setTimeout(r, 300)); obs.disconnect(); return worst;
    });
    assert(longest < 200, `滚动时出现 ${longest}ms 的长任务`);
    await page.close();
  });
  await check('浏览器无未捕获异常',async()=>assert.deepEqual(errors,[]));
} finally {
  await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify({date:new Date().toISOString(),report,errors},null,2));
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
if(report.some(x=>x.status==='failed')) process.exitCode=1;
