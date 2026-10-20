import assert from 'node:assert/strict';
import { hostHtml, post } from './fixtures.mjs';
import { fieldChecks } from './field.mjs';
import { workflowChecks } from './workflows.mjs';
import { experienceChecks } from './experience.mjs';
import { readerChecks } from './reader.mjs';
import { cacheChecks } from './cache.mjs';
import { regressionChecks } from './regressions.mjs';

/** 手动本地验收：所有请求拦截并记账，绝不连接真实论坛或资源地址。 */
export async function hardeningChecks({ context, script, check }) {
  const edge = page => page.getByRole('button', { name: /^展开 ThreadMap/ });
  const panel = page => page.locator('.tm-panel');
  const ownedSelector = '.cooked > button[data-threadmap-owner]:not([data-threadmap-owner="wrong"])';
  const chainPosts = topic => ['一心一意', '意气风发', '发奋图强', '强人所难', '难能可贵'].map((text, i) => post(i + 1, text, null, topic));
  const startLoad = async page => { await page.getByRole('button', { name: '加载更多楼层', exact: true }).click(); await page.getByRole('button', { name: '开始加载', exact: true }).click(); };
  const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  /** 主动补取默认关闭：加载类场景显式开启；专门的默认值场景传 null 保持出厂设置。 */
  const prepare = async (topic, shown, respond, retainTraffic = false, prefs = { allowLoad: true, loadCount: 100 }) => {
    const page = await context.newPage(), requests = [];
    await page.route('**/*', route => {
      const req = route.request();
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) return route.fulfill({ contentType: 'text/html', body: hostHtml(shown, topic) });
      const entry = { url: req.url(), method: req.method(), type: req.resourceType(), time: Date.now() };
      requests.push(entry);
      return respond ? respond(route, entry) : route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`https://linux.do/t/hardening/${topic}`);
    await page.evaluate(([retain, prefs]) => {
      // 一次写入设置：同源其他标签页不会先收到“设置被清空”的中间状态。
      if (prefs) localStorage.setItem('threadmap-prefs-v2', JSON.stringify(prefs)); else localStorage.removeItem('threadmap-prefs-v2');
      localStorage.removeItem('threadmap-overrides-v1');
      // 独立场景的夹具隔离；专门的跨页/刷新测试保留该键来验证不能绕过冷却。
      if (!retain) localStorage.removeItem('threadmap-load-guard-v1');
    }, [retainTraffic, prefs]);
    const boot = async () => { await page.addScriptTag({ content: script }); await page.locator('.tm-edge').waitFor(); };
    return { page, requests, boot };
  };
  /** 从“规则”页显式打开补取许可；开启本身不应产生任何请求。 */
  const enableLoad = async page => {
    await page.getByRole('tab', { name: /^规则/ }).click();
    const toggle = page.getByRole('switch', { name: '允许主动补取楼层' });
    if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  };

  await check('加固：同名正文保留、自有标注改名不污染判断、样式与清理只作用于自有节点', async () => {
    const topic = 7101, shown = [
      { ...post(1, '', null, topic), cooked: '<p id="foreign-a" class="threadmap-badge">一心一意</p><p id="foreign-b" class="threadmap-badge" data-threadmap-owner="wrong">意气风发</p>' },
      post(2, '发奋图强', null, topic), post(3, '强人所难', null, topic),
    ];
    const { page, requests, boot } = await prepare(topic, shown);
    try {
      const foreign = () => page.locator('#foreign-a, #foreign-b').evaluateAll(nodes => nodes.map(el => ({ html: el.outerHTML, display: getComputedStyle(el).display, color: getComputedStyle(el).color })));
      const before = await foreign();
      await boot(); await edge(page).click();
      assert((await panel(page).innerText()).includes('3 个接龙帖'));
      const own = page.locator(ownedSelector);
      assert.equal(await own.count(), 3);
      assert.deepEqual(await foreign(), before);
      await own.first().click();
      assert.deepEqual(await page.locator('.tm-phrases span').allTextContents(), ['一心一意', '意气风发']);
      await page.evaluate(selector => {
        const badge = document.querySelector(selector);
        badge.className = 'renamed'; badge.textContent = '海阔天空';
        // 一次外部变化触发重读，不能靠忽略自有 mutation 掩盖正文污染。
        document.querySelector('#topic').append(document.createElement('span'));
      }, ownedSelector);
      await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('threadmap-badge'), ownedSelector);
      assert.deepEqual(await page.locator('.tm-phrases span').allTextContents(), ['一心一意', '意气风发']);
      const light = await own.first().evaluate(el => getComputedStyle(el).backgroundColor);
      await page.evaluate(() => document.documentElement.style.setProperty('--secondary', '#111111'));
      await page.waitForFunction(selector => document.querySelector(selector)?.dataset.scheme === 'dark', ownedSelector);
      assert.notEqual(await own.first().evaluate(el => getComputedStyle(el).backgroundColor), light);
      assert.deepEqual(await foreign(), before);
      await page.getByRole('tab', { name: /^规则/ }).click();
      await page.getByRole('group', { name: '原帖标注' }).getByRole('button', { name: '关闭', exact: true }).click();
      await page.waitForFunction(selector => document.querySelectorAll(selector).length === 0, ownedSelector);
      assert.deepEqual(await foreign(), before);
      assert.equal(requests.length, 0);
      return { preservedForeignNodes: 2, networkRequests: 0 };
    } finally { await page.close(); }
  });

  await check('加固：store 混入坏项/超限正文不丢合法楼，惰性 HTML 不执行或请求外部资源', async () => {
    const topic = 7102, shown = chainPosts(topic).slice(0, 4);
    const hostile = '<script>globalThis.__threadmapExecuted=true</script><style>@import "https://asset.invalid/style.css";</style><img src="https://asset.invalid/pixel" onerror="globalThis.__threadmapExecuted=true"><iframe src="https://asset.invalid/frame"></iframe><object data="https://asset.invalid/object"></object><p>一心一意</p>';
    const { page, requests, boot } = await prepare(topic, shown);
    try {
      await page.evaluate(([topic, posts, hostile]) => {
        globalThis.__threadmapExecuted = false;
        window.Discourse = { __container__: { lookup: () => ({ model: { id: topic, postStream: {
          stream: posts.map(p => p.id),
          posts: [{ ...posts[0], cooked: hostile }, null, posts[1], { id: false }, posts[2], { ...posts[3], cooked: '甲'.repeat(100000) }],
        } } }) } };
      }, [topic, shown, hostile]);
      await boot(); await edge(page).click();
      await page.locator('.tm-status-text').filter({ hasText: '还有 1 楼未载入' }).waitFor();
      assert((await panel(page).innerText()).includes('已载入 3 楼 / 4'));
      assert.equal(await page.locator(ownedSelector).count(), 3);
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => globalThis.__threadmapExecuted), false);
      assert.equal(await page.locator('#threadmap-root img, #threadmap-root iframe, #threadmap-root object').count(), 0);
      assert.deepEqual(requests, []);
      return { loaded: 3, total: 4, executed: false, resourceRequests: 0 };
    } finally { await page.close(); }
  });

  await check('加固：漏返和额外串帖不伪造完成；合法部分、stream 与 API 来源在失败后保留', async () => {
    const topic = 7103, all = chainPosts(topic);
    const { page, requests, boot } = await prepare(topic, all.slice(0, 1), (route, req) => {
      const path = new URL(req.url).pathname;
      if (path === `/t/${topic}.json`) return json(route, { id: topic, post_stream: { stream: all.map(p => p.id), posts: all.slice(0, 2) } });
      return json(route, { posts: [all[2], post(99, '来自其他主题的无关文字', null, 7999)] });
    });
    try {
      await boot(); await edge(page).click();
      await startLoad(page);
      await page.getByRole('alert').filter({ hasText: '不完整' }).waitFor();
      assert((await panel(page).innerText()).includes('已载入 3 楼 / 5'));
      assert((await page.locator('.tm-status').innerText()).includes('还有 2 楼未载入'));
      assert(!(await panel(page).innerText()).includes('来自其他主题'));
      assert.equal(await page.getByRole('button', { name: '检查新楼层', exact: true }).count(), 0);
      await page.waitForTimeout(650);
      assert.equal(requests.length, 2, '失败后不能自动重试或继续下一批');
      assert(requests.every(req => req.method === 'GET' && new URL(req.url).origin === 'https://linux.do'));
      assert.deepEqual(new URL(requests[1].url).searchParams.getAll('post_ids[]').map(Number), all.slice(2).map(p => p.id));
      return { loaded: 3, total: 5, requests };
    } finally { await page.close(); }
  });

  await check('加固：首批超限明确停止，已取得内容保留，不请求被拒绝的帖子', async () => {
    const topic = 7104, all = chainPosts(topic).slice(0, 2);
    const { page, requests, boot } = await prepare(topic, all.slice(0, 1), route => json(route, {
      id: topic, post_stream: { stream: all.map(p => p.id), posts: [all[0], { ...all[1], cooked: '甲'.repeat(100000) }] },
    }));
    try {
      await boot(); await edge(page).click();
      await startLoad(page);
      await page.getByRole('alert').filter({ hasText: '处理上限' }).waitFor();
      assert((await panel(page).innerText()).includes('已载入 1 楼 / 2'));
      await page.waitForTimeout(650);
      assert.equal(requests.length, 1);
      return { loaded: 1, total: 2, requests: 1 };
    } finally { await page.close(); }
  });

  await check('加固：浏览器在发送目标请求前拒绝跨源与同源重定向', async () => {
    const evidence = [];
    for (const crossOrigin of [true, false]) {
      const topic = crossOrigin ? 7105 : 7106, target = crossOrigin ? 'https://redirect.invalid/t/7105.json' : 'https://linux.do/redirect-target.json';
      const { page, requests, boot } = await prepare(topic, chainPosts(topic).slice(0, 3), (route, req) => req.url === target
        ? json(route, {})
        : route.fulfill({ status: 302, headers: { Location: target }, body: '' }));
      try {
        await boot(); await edge(page).click();
        await startLoad(page);
        await page.getByRole('alert').filter({ hasText: '重定向被阻止' }).waitFor();
        assert.equal(requests.filter(req => req.url === target).length, 0, JSON.stringify(requests));
        assert.equal(requests.length, 1);
        evidence.push({ crossOrigin, targetRequests: 0 });
      } finally { await page.close(); }
    }
    return evidence;
  });

  await check('加固：加载中切主题或离开，取消旧请求，迟到响应不复活旧会话/标注', async () => {
    for (const leave of [false, true]) {
      const topic = leave ? 7109 : 7107, all = chainPosts(topic);
      let release, markEntered;
      const entered = new Promise(resolve => { markEntered = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const { page, requests, boot } = await prepare(topic, all.slice(0, 1), async (route, req) => {
        if (new URL(req.url).pathname === `/t/${topic}.json`) return json(route, { id: topic, post_stream: { stream: all.map(p => p.id), posts: all.slice(0, 2) } });
        markEntered();
        await gate;
        // 此响应故意晚于取消；Playwright 可能拒绝向已取消的请求交付响应。
        try { await json(route, { posts: all.slice(2) }); } catch (error) { if (!route.request().failure() && !page.isClosed()) throw error; }
      });
      try {
        await boot(); await edge(page).click();
        const failed = page.waitForEvent('requestfailed', { predicate: req => new URL(req.url()).pathname.endsWith('/posts.json') }).then(req => req.failure()?.errorText, error => error);
        const requested = page.waitForRequest(req => new URL(req.url()).pathname.endsWith('/posts.json'));
        await startLoad(page);
        await page.getByText('正在载入 2/5 楼', { exact: true }).waitFor();
        await requested;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('批次未进入模拟服务器')), 6000);
          entered.then(() => { clearTimeout(timer); resolve(); });
        });
        assert.equal(requests.length, 2);
        await page.evaluate(([leave, html]) => {
          history.pushState({}, '', leave ? '/latest' : '/t/replacement/7108');
          const doc = new DOMParser().parseFromString(html, 'text/html');
          document.querySelector('#topic').replaceWith(document.importNode(doc.querySelector('#topic'), true));
        }, [leave, hostHtml(chainPosts(7108).slice(0, 3), 7108)]);
        assert.match(String(await failed), /ABORTED/);
        release();
        await page.waitForTimeout(400);
        assert.equal(requests.length, 2);
        if (leave) {
          assert.equal(await page.locator('#threadmap-root').count(), 0);
          assert.equal(await page.locator(ownedSelector).count(), 0);
        } else {
          assert.equal(await page.locator('#threadmap-root').count(), 1);
          assert(await panel(page).isHidden());
          await edge(page).click();
          const text = await panel(page).innerText();
          assert(text.includes('7108') && text.includes('已载入 3 楼'), text);
          assert(!text.includes(String(topic)) && !text.includes('/ 5'), text);
          assert.equal(await page.locator(ownedSelector).count(), 3);
        }
      } finally { release(); await page.close(); }
    }
    return { cancelledScenarios: 2, lateResponsePollution: false };
  });

  await check('加固：缺少 Array/String.at 时，实际脚本仍能初始化、读取末项并试接', async () => {
    const topic = 7110;
    const { page, requests, boot } = await prepare(topic, chainPosts(topic).slice(0, 4));
    try {
      await page.evaluate(() => { Array.prototype.at = undefined; String.prototype.at = undefined; });
      await boot(); await edge(page).click();
      assert((await panel(page).innerText()).includes('4 个接龙帖'));
      await page.locator('#tm-try').fill('难能可贵');
      assert((await page.locator('.tm-results').innerText()).includes('能接 #4'));
      assert.equal(requests.length, 0);
      return { atAvailable: false, networkRequests: 0, oldBrowserClaim: false };
    } finally { await page.close(); }
  });

  await workflowChecks({ context, check, prepare, startLoad, enableLoad });
  await fieldChecks({ context, script, check, prepare, startLoad, enableLoad });
  await experienceChecks({ check, prepare });
  await readerChecks({ check, prepare });
  await cacheChecks({ context, script, check });
  await regressionChecks({ context, script, check });
}
