import assert from 'node:assert/strict';
import { hostHtml, post } from './fixtures.mjs';

/** 账号风险与回答阅读的端到端检查。prepare 拦截全部请求，不连接真实论坛。 */
export async function workflowChecks({ context, check, prepare, startLoad, enableLoad }) {
  const edge = page => page.getByRole('button', { name: /^展开 ThreadMap/ });
  const panel = page => page.locator('.tm-panel');
  const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

  await check('请求安全：确认前零请求，单次含主题最多5次、慢速分批；刷新后冷却仍生效', async () => {
    const topic = 7111, all = Array.from({ length: 180 }, (_, i) => post(i + 1, '用于预算验收的普通讨论内容。', null, topic));
    const { page, requests, boot } = await prepare(topic, [], (route, req) => {
      const url = new URL(req.url), ids = url.searchParams.getAll('post_ids[]').map(Number);
      return json(route, url.pathname === `/t/${topic}.json` ? { id: topic, post_stream: { posts: [], stream: all.map(p => p.id) } } : { posts: all.filter(p => ids.includes(p.id)) });
    });
    try {
      await boot(); await edge(page).click();
      await page.getByRole('button', { name: '加载更多楼层' }).click();
      assert.equal(requests.length, 0);
      assert((await page.getByRole('alert').innerText()).includes('不确定站点是否允许'));
      await page.getByRole('button', { name: '开始加载' }).click();
      await page.locator('.tm-status-text').filter({ hasText: '还有 100 楼未载入' }).waitFor({ timeout: 30000 });
      assert((await panel(page).innerText()).includes('已载入 80 楼 / 180'));
      assert.equal(requests.length, 5);
      const intervals = requests.slice(1).map((req, i) => req.time - requests[i].time);
      assert(intervals.every(ms => ms >= 4900), `本机拦截到的请求间隔：${intervals}`);
      await startLoad(page);
      await page.getByRole('alert').filter({ hasText: '冷却' }).waitFor();
      assert.equal(requests.length, 5);
      await page.reload(); await boot(); await edge(page).click();
      await startLoad(page);
      await page.getByRole('alert').filter({ hasText: '冷却' }).waitFor();
      assert.equal(requests.length, 5, '刷新不能重置防过频状态');
      return { requests: 5, intervalsMs: intervals, loaded: 80, total: 180, extraRequestsAfterReload: 0 };
    } finally { await page.close(); }
  });

  await check('请求安全：同源多窗口不能并发或排队；切后台取消，取消后其他页面仍冷却', async () => {
    const topic = 7112, shown = [post(1, '一心一意', null, topic)];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const a = await prepare(topic, shown, async route => {
      await gate;
      try { await json(route, { id: topic, post_stream: { stream: shown.map(p => p.id), posts: shown } }); } catch (error) { if (!route.request().failure() && !a.page.isClosed()) throw error; }
    });
    let b;
    try {
      // 模拟同时可见的两个窗口，隔离验证真正的 Web Locks，而不依赖焦点切换取消。
      await a.page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: false }));
      await a.boot(); await edge(a.page).click();
      const sent = a.page.waitForRequest(req => req.url().endsWith(`/t/${topic}.json`));
      const aborted = a.page.waitForEvent('requestfailed').then(req => req.failure()?.errorText, error => String(error));
      await startLoad(a.page); await sent;
      b = await prepare(7113, [post(1, '第二个窗口的内容', null, 7113)], route => json(route, {}), true);
      await b.page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: false }));
      await b.boot(); await edge(b.page).click(); await startLoad(b.page);
      await b.page.getByRole('alert').filter({ hasText: '另一个标签页' }).waitFor();
      assert.equal(b.requests.length, 0);
      await a.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      assert.match(String(await aborted), /ABORTED/);
      release();
      await a.page.getByText('已取消', { exact: false }).waitFor();
      await startLoad(b.page);
      await b.page.getByRole('alert').filter({ hasText: '冷却' }).waitFor();
      assert.equal(a.requests.length, 1); assert.equal(b.requests.length, 0);
      return { firstWindowRequests: 1, secondWindowRequests: 0, backgroundCancelled: true, queued: false };
    } finally { release(); await a.page.close(); await b?.page.close(); }
  });

  await check('请求安全：429 的更长 Retry-After 跨页面保留，不靠刷新/换主题重试', async () => {
    const first = await prepare(7114, [], route => route.fulfill({ status: 429, contentType: 'application/json', headers: { 'Retry-After': '3600' }, body: '{}' }));
    let second;
    try {
      await first.boot(); await edge(first.page).click(); await startLoad(first.page);
      await first.page.getByRole('alert').filter({ hasText: '429' }).waitFor();
      const remaining = await first.page.evaluate(() => JSON.parse(localStorage.getItem('threadmap-load-guard-v1')).pausedUntil - Date.now());
      assert(remaining >= 3598_000, `没有遵守一小时 Retry-After：${remaining}`);
      second = await prepare(7115, [], route => json(route, {}), true);
      await second.boot(); await edge(second.page).click(); await startLoad(second.page);
      await second.page.getByRole('alert').filter({ hasText: '冷却' }).waitFor();
      assert.equal(first.requests.length, 1); assert.equal(second.requests.length, 0);
      return { firstRequests: 1, otherTopicRequests: 0, minimumRemainingCooldownMs: 3598_000 };
    } finally { await first.page.close(); await second?.page.close(); }
  });

  await check('请求安全：验证页与503也保留较长Retry-After，刷新或重新开启都不得提前请求', async () => {
    const evidence = [];
    for (const [topic, status, contentType] of [[7117, 403, 'text/html'], [7118, 503, 'application/json']]) {
      const host = await prepare(topic, [], route => route.fulfill({ status, contentType, headers: { 'Retry-After': '7200' }, body: contentType === 'text/html' ? '<html>验证页</html>' : '{}' }));
      try {
        await host.boot(); await edge(host.page).click(); await startLoad(host.page);
        await host.page.getByRole('alert').filter({ hasText: status === 403 ? '人机验证' : '503' }).waitFor();
        const remaining = await host.page.evaluate(() => JSON.parse(localStorage.getItem('threadmap-load-guard-v1')).pausedUntil - Date.now());
        assert(remaining >= 7198_000, `服务器要求两小时，实际剩余：${remaining}`);
        await host.page.reload(); await host.boot(); await edge(host.page).click();
        const blocked = status === 403;
        // 验证页属于保护性失败：许可已持久关闭；即使用户重新开启，也仍受同一冷却约束。
        assert.equal(await host.page.getByRole('button', { name: '加载更多楼层', exact: true }).count(), blocked ? 0 : 1);
        if (blocked) await enableLoad(host.page);
        await startLoad(host.page);
        await host.page.getByRole('alert').filter({ hasText: '冷却' }).waitFor();
        assert.equal(host.requests.length, 1);
        evidence.push({ status, minimumRemainingCooldownMs: 7198_000, allowLoadClosed: blocked, extraRequestsAfterReload: 0 });
      } finally { await host.page.close(); }
    }
    return evidence;
  });

  await check('请求安全：无跨页锁、存储禁用或记录损坏时禁用主动请求，仍可本地阅读', async () => {
    const evidence = [];
    for (const [index, kind] of ['locks', 'storage', 'corrupt'].entries()) {
      const host = await prepare(7130 + index, []);
      try {
        await host.page.evaluate(kind => {
          if (kind === 'locks') Object.defineProperty(navigator, 'locks', { value: undefined });
          if (kind === 'storage') Storage.prototype.setItem = () => { throw new Error('fixture: storage disabled'); };
          if (kind === 'corrupt') localStorage.setItem('threadmap-load-guard-v1', '{invalid');
        }, kind);
        await host.boot(); await edge(host.page).click(); await startLoad(host.page);
        await host.page.getByRole('alert').filter({ hasText: kind === 'locks' ? '无法协调' : '无法可靠保存' }).waitFor();
        await host.page.locator('#tm-ask').fill('仍然可以本地搜索');
        assert((await host.page.locator('.tm-results').innerText()).includes('没有找到相似的提问'));
        assert.equal(host.requests.length, 0);
        evidence.push({ kind, requests: 0, localSearchAvailable: true });
      } finally { await host.page.close(); }
    }
    return evidence;
  });

  await check('请求安全：浏览器请求超时会中止，经过冷却时间也不会自动恢复', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const host = await prepare(7116, [], async route => {
      await gate;
      try { await json(route, {}); } catch (error) { if (!route.request().failure() && !host.page.isClosed()) throw error; }
    });
    try {
      await host.page.clock.install({ time: new Date() });
      await host.boot(); await edge(host.page).click();
      const requested = host.page.waitForRequest(req => req.url().endsWith('/t/7116.json'));
      await startLoad(host.page); await requested;
      await host.page.clock.fastForward(20_001);
      await host.page.getByRole('alert').filter({ hasText: '请求超时' }).waitFor();
      release();
      await host.page.clock.fastForward(60 * 60_000);
      assert.equal(host.requests.length, 1);
      return { timedOut: true, requestsAfterSimulatedHour: 1, automaticRestart: false };
    } finally { release(); await host.page.close(); }
  });

  await check('阅读边界：切规则/收起保留查询、答案和滚动；长用户名不溢出，关闭/确认的键盘焦点可用', async () => {
    const topic = 7121, all = [
      post(1, '阅读状态验收。', null, topic), { ...post(2, '脚本怎么安装？', null, topic), username: 'q'.repeat(100) },
      post(3, '先安装浏览器扩展。', 2, topic), post(4, '脚本安装方法是什么？', null, topic),
      { ...post(5, '然后安装脚本。', 2, topic), username: 'r'.repeat(100), cooked: `<p>然后安装脚本。</p><p>${'abcdefghij'.repeat(350)}</p>` },
    ];
    const { page, requests, boot } = await prepare(topic, all.slice(0, 2));
    try {
      await page.evaluate(([topic, posts]) => {
        window.Discourse = { __container__: { lookup: () => ({ model: { id: topic, postStream: { posts, stream: posts.map(p => p.id) } } }) } };
      }, [topic, all]);
      await boot(); await edge(page).click();
      await page.locator('#tm-ask').fill('脚本安装');
      const opener = page.locator('.tm-search-results').getByRole('button', { name: '阅读第 2 楼的问题与相关回复' });
      await opener.click();
      const preview = page.locator('section[aria-label="帖子预览"]'), body = page.locator('.tm-body');
      await preview.getByRole('button', { name: '下一条' }).click();
      await body.evaluate(el => { el.scrollTop = 160; }); await page.waitForTimeout(50);
      const savedScroll = await body.evaluate(el => el.scrollTop);
      await page.getByRole('tab', { name: /^规则/ }).click();
      assert(await preview.isHidden());
      const qaTab = page.getByRole('tab', { name: /^问答/ });
      await qaTab.click();
      assert.equal(await page.locator('#tm-ask').inputValue(), '脚本安装');
      assert((await preview.innerText()).includes('然后安装脚本'));
      assert(Math.abs(await body.evaluate(el => el.scrollTop) - savedScroll) <= 1);
      assert(await qaTab.evaluate(el => el.getRootNode().activeElement === el), '返回标签不应被预览抢焦点');
      await page.getByRole('button', { name: '收起面板' }).click(); await edge(page).click();
      assert.equal(await page.locator('#tm-ask').inputValue(), '脚本安装');
      assert((await preview.innerText()).includes('然后安装脚本'));
      await page.setViewportSize({ width: 320, height: 640 });
      const width = await body.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      assert(width.scroll <= width.client, `长用户名/无空格长正文溢出：${JSON.stringify(width)}`);
      await page.locator('.tm-question-posts summary').click();
      const small = await page.locator('section[aria-label="问题组"]').evaluate(el => [...el.querySelectorAll('button,a[href],summary')]
        .map(node => ({ text: node.textContent, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }))
        .filter(rect => rect.width < 24 || rect.height < 24));
      assert.deepEqual(small, [], '问题组里的独立楼号目标也必须至少24×24');
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.getByRole('button', { name: '返回问题列表', exact: false }).press('Enter');
      assert(await opener.evaluate(el => el.getRootNode().activeElement === el));
      await opener.press('Enter');
      await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const load = page.getByRole('button', { name: '检查新楼层', exact: true });
      await load.click();
      const confirmation = page.getByRole('alert', { name: '确认加载' });
      const c = await confirmation.boundingBox(), b = await body.boundingBox();
      assert(c && b && c.y >= b.y && c.y + c.height <= b.y + b.height, '确认提示必须可见');
      assert(await confirmation.evaluate(el => el.getRootNode().activeElement === el));
      await page.keyboard.press('Escape');
      assert(await panel(page).isVisible());
      assert(await load.evaluate(el => el.getRootNode().activeElement === el));
      await load.press('Enter'); await page.keyboard.press('Tab');
      assert(await page.getByLabel('本次最多新增（楼）').evaluate(el => el.getRootNode().activeElement === el));
      for (const name of ['20 楼', '50 楼', '100 楼']) {
        await page.keyboard.press('Tab');
        assert(await page.getByRole('button', { name, exact: true }).evaluate(el => el.getRootNode().activeElement === el));
      }
      await page.keyboard.press('Tab');
      assert(await page.getByLabel('切到其他标签页后继续本次').evaluate(el => el.getRootNode().activeElement === el));
      await page.keyboard.press('Tab');
      assert(await page.getByRole('button', { name: '开始加载', exact: true }).evaluate(el => el.getRootNode().activeElement === el));
      await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
      assert.equal(await confirmation.count(), 0);
      assert.equal(requests.length, 0);
      await page.getByRole('button', { name: '返回问题列表', exact: false }).press('Escape');
      assert(await opener.evaluate(el => el.getRootNode().activeElement === el));
      await page.locator('#tm-ask').press('Escape');
      assert.equal(await page.locator('#tm-ask').inputValue(), '');
      assert(await panel(page).isVisible());
      return { requests: 0, savedScroll, width, retainedAnswer: 5, closeFocusRestored: true, confirmationKeyboard: true };
    } finally { await page.close(); }
  });

  await check('回答阅读：本地预览和多答案切换零额外请求；原帖新标签/页内定位均保留9楼进度与问题上下文', async () => {
    const topic = 7120;
    const all = [
      post(1, '在这个主题中交流使用方法。', null, topic),
      post(2, '脚本怎么安装？', null, topic), post(3, '安装方法请看说明。', 2, topic),
      post(4, '脚本安装方法是什么？', null, topic), post(5, '另一个安装方法。', 2, topic),
      post(6, '邀请码在哪里领？', null, topic), post(7, '怎么获取邀请码', null, topic),
      { ...post(8, '第一种取码方式。', 6, topic), like_count: 5, cooked: '<p>第一种取码方式。示意文字：&lt;img src=x onerror=alert(1)&gt;</p>' },
      { ...post(9, '第二种取码方式。', 6, topic), like_count: 1, cooked: `<p>第二种取码方式。</p><p>${'abcdefghij'.repeat(300)}</p>` },
    ];
    const shown = all.filter(p => [1, 2, 4, 6, 7].includes(p.post_number));
    const { page, requests, boot } = await prepare(topic, shown, (route, req) => {
      const ids = new URL(req.url).searchParams.getAll('post_ids[]').map(Number);
      return json(route, { posts: all.filter(p => ids.includes(p.id)) });
    });
    const popupUrls = [], popups = [];
    const popupRoute = route => {
      if (route.request().isNavigationRequest()) popupUrls.push(route.request().url());
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>原帖的离线模拟页面</p>' });
    };
    // 新标签的首次导航也由 context 拦截，不能泄漏到真实论坛。
    await context.route('**/*', popupRoute);
    try {
      await page.evaluate(([topic, shown, ids]) => {
        window.Discourse = { __container__: { lookup: () => ({ model: { id: topic, postStream: { posts: shown, stream: ids } } }) } };
        window.__privateRouteCalls = 0;
        window.require = name => name === 'discourse/lib/url' ? { default: { routeTo: () => { window.__privateRouteCalls++; } } } : undefined;
      }, [topic, shown, all.map(p => p.id)]);
      await boot(); await edge(page).click(); await startLoad(page);
      await page.getByRole('button', { name: '检查新楼层' }).waitFor();
      assert((await panel(page).innerText()).includes('已载入 9 楼 / 9'));
      assert.equal(requests.length, 1);
      await page.evaluate(() => { window.__originalThreadMapRoot = document.querySelector('#threadmap-root'); });
      const originalUrl = page.url();
      await page.locator('#tm-ask').fill('邀请码');
      await page.locator('.tm-search-results').getByRole('button', { name: '阅读第 6 楼的问题与相关回复' }).click();
      const group = page.locator('section[aria-label="问题组"]');
      const preview = page.locator('section[aria-label="帖子预览"]');
      assert((await preview.innerText()).includes('第一种取码方式'));
      assert.equal(await preview.locator('img,iframe,script').count(), 0);
      await preview.getByRole('button', { name: '下一条' }).click();
      assert((await preview.innerText()).includes('第二种取码方式'));
      await page.setViewportSize({ width: 320, height: 640 });
      assert(await page.locator('.tm-body').evaluate(el => el.scrollWidth <= el.clientWidth), '纯文本预览不能横向溢出');
      const tooSmall = await preview.evaluate(el => [...el.querySelectorAll('button,a[href]')].map(node => node.getBoundingClientRect()).some(rect => rect.width < 24 || rect.height < 24));
      assert.equal(tooSmall, false);
      await page.setViewportSize({ width: 1440, height: 960 }); // 窄屏断言只针对面板；模拟论坛正文使用桌面布局
      for (const number of [9, 8]) {
        const created = context.waitForEvent('page');
        await preview.getByRole('link', { name: '查看原帖' }).click();
        const popup = await created; popups.push(popup);
        await popup.waitForURL(`https://linux.do/t/hardening/${topic}/${number}`);
        assert.equal(await popup.evaluate(() => window.opener), null);
        assert.equal(await popup.evaluate(() => document.referrer), '');
        await popup.close();
        assert.equal(page.url(), originalUrl);
        assert.equal(await page.locator('#tm-ask').inputValue(), '邀请码');
        assert((await group.innerText()).includes('邀请码在哪里领'));
        assert((await panel(page).innerText()).includes('已载入 9 楼 / 9'));
        assert(await page.evaluate(() => window.__originalThreadMapRoot === document.querySelector('#threadmap-root')));
        if (number === 9) await preview.getByRole('button', { name: '上一条' }).click();
      }
      // 目标后来进入 DOM 时，同一共享链接应改为本页滚动，不需要任何数据请求。
      await page.evaluate(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        document.querySelector('#topic').append(document.importNode(doc.querySelector('.topic-post'), true));
      }, hostHtml([all[7]], topic));
      const pageCount = context.pages().length;
      await preview.getByRole('link', { name: '查看原帖' }).click();
      await page.locator('[data-post-number="8"] article.threadmap-flash').waitFor();
      assert.equal(context.pages().length, pageCount);
      assert.equal(requests.length, 1);
      assert.equal(await page.evaluate(() => window.__privateRouteCalls), 0);
      assert.equal(await page.locator('#tm-ask').inputValue(), '邀请码');
      assert((await group.innerText()).includes('邀请码在哪里领'));
      return { loaded: 9, total: 9, backgroundDataRequests: 1, extraDataRequestsDuringReading: 0, originalPageReloads: 0, popupUrls, retainedQuestion: 6, retainedQuery: '邀请码' };
    } finally {
      for (const popup of popups) if (!popup.isClosed()) await popup.close();
      await page.close(); await context.unroute('**/*', popupRoute);
    }
  });
}
