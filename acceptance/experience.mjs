import assert from 'node:assert/strict';
import { post } from './fixtures.mjs';

/** 产品反例：不使用为面板预留350px的旧夹具来证明“不遮正文”。全部请求由prepare拦截。 */
export async function experienceChecks({ check, prepare }) {
  const edge = page => page.getByRole('button', { name: /^展开 ThreadMap/ });
  const panel = page => page.locator('.tm-panel');
  const json = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  const store = (page, topic, posts, stream) => page.evaluate(([topic, posts, stream]) => {
    window.Discourse = { __container__: { lookup: name => name === 'controller:topic' ? { model: { id: topic, postStream: { posts, stream } } } : undefined } };
  }, [topic, posts, stream]);

  await check('体验反例：居中正文不能被进度轴避让挤住；不足时明确抽屉且不改宿主宽度', async () => {
    const topic = 7201, host = await prepare(topic, ['一心一意', '意气风发', '发奋图强', '强人所难'].map((text, i) => post(i + 1, text, null, topic)), undefined, false, null);
    try {
      await host.page.evaluate(() => {
        const style = document.createElement('style'); style.textContent = 'main{max-width:760px;padding-right:0;margin:40px auto 450px}'; document.head.append(style);
        const axis = document.createElement('div'); axis.className = 'timeline-container'; axis.style.cssText = 'position:fixed;right:24px;top:180px;width:150px;height:320px;background:white'; axis.textContent = '111 / 5555'; document.body.append(axis);
      });
      const bodyRect = () => host.page.locator('.topic-post').first().evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width }));
      const original = await bodyRect(); await host.boot(); await edge(host.page).click();
      await host.page.waitForFunction(() => document.querySelector('#threadmap-root').shadowRoot.querySelector('.tm-panel').dataset.side === 'left');
      assert.equal(await panel(host.page).getAttribute('data-layout'), 'sidecar');
      const p = await panel(host.page).boundingBox(), body = await bodyRect();
      assert(p.x + p.width <= body.left && p.width >= 320, JSON.stringify({ p, body }));
      assert.deepEqual(body, original, '不得通过挤压或缩放论坛正文伪造不相交');
      await host.page.screenshot({ path: 'acceptance/artifacts/experience-after-layout.png' });
      await host.page.setViewportSize({ width: 1100, height: 800 });
      await host.page.getByText('没有足够的并排空白', { exact: false }).waitFor();
      assert.equal(await panel(host.page).getAttribute('data-layout'), 'drawer');
      assert.equal((await bodyRect()).width, original.width);
      await host.page.getByRole('button', { name: '收起读帖' }).click(); assert(await panel(host.page).isHidden());
      assert.equal(host.requests.length, 0);
      return { formerOverlapPx: 195, overlapAfterFixPx: 0, hostWidthUnchanged: true, narrowBehavior: 'explicit drawer' };
    } finally { await host.page.close(); }
  });

  await check('小窗反例：160/5960分层且完整显示，长数字不越界；问答两标签等分', async () => {
    const topic = 7202, posts = Array.from({ length: 160 }, (_, i) => post(i + 1, '用于小窗显示的普通讨论。', null, topic));
    const host = await prepare(topic, posts.slice(0, 1), undefined, false, null);
    try {
      await store(host.page, topic, posts, Array.from({ length: 5960 }, (_, i) => topic * 1000 + i + 1));
      await host.boot(); await edge(host.page).click();
      const widths = await host.page.getByRole('tab').evaluateAll(tabs => tabs.map(el => el.getBoundingClientRect().width));
      assert.equal(widths.length, 2); assert(Math.abs(widths[0] - widths[1]) < 1);
      assert(Math.abs(widths.reduce((a, b) => a + b, 0) - (await host.page.locator('.tm-tabs').boundingBox()).width) <= 1);
      await host.page.getByRole('button', { name: '钉成小窗' }).click();
      const metric = host.page.locator('.tm-metric').last();
      assert.equal(await metric.locator('b').innerText(), '160');
      assert.equal(await metric.locator('small').innerText(), '共 5960 楼');
      assert((await metric.getAttribute('aria-label')).includes('160 · 共 5960 楼'));
      const clipped = await metric.locator('b,span,small').evaluateAll(nodes => nodes.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent));
      assert.deepEqual(clipped, [], '截图中的数字必须真正完整可见，而非仅改成ellipsis');
      const hud = host.page.locator('.tm-hud');
      assert(await hud.evaluate(el => el.scrollWidth <= el.clientWidth));
      await host.page.screenshot({ path: 'acceptance/artifacts/experience-after-hud.png' });
      await hud.getByRole('button', { name: '查找', exact: true }).click();
      await host.page.locator('#tm-ask').waitFor();
      assert.equal(host.requests.length, 0);
      return { loaded: 160, total: 5960, clippedFields: 0, qaTabsFillWidth: true };
    } finally { await host.page.close(); }
  });

  await check('默认体验：从问答直接选择加载，非法数量不授权，7楼目标可见且不会自动续跑', async () => {
    const topic = 7203, all = Array.from({ length: 61 }, (_, i) => post(i + 1, '用于数量选择的普通讨论。', null, topic));
    const host = await prepare(topic, all.slice(0, 1), (route, entry) => {
      const url = new URL(entry.url), ids = url.searchParams.getAll('post_ids[]').map(Number);
      return json(route, url.pathname.endsWith(`/${topic}.json`) ? { id: topic, post_stream: { posts: [all[0]], stream: all.map(p => p.id) } } : { posts: all.filter(p => ids.includes(p.id)) });
    }, false, null);
    try {
      await host.page.clock.install({ time: new Date() }); await host.boot(); await edge(host.page).click();
      await host.page.getByText('当前范围内尚未识别到提问', { exact: true }).waitFor();
      const choose = host.page.getByRole('button', { name: '选择加载', exact: true }); await choose.click();
      const count = host.page.getByLabel('本次最多新增（楼）');
      assert.equal(await count.inputValue(), '20'); assert.equal(host.requests.length, 0);
      await count.fill('101'); await host.page.getByRole('button', { name: '允许并加载' }).click();
      assert.equal(host.requests.length, 0); assert.equal(await count.evaluate(el => el.validity.valid), false);
      assert.equal(await host.page.evaluate(() => JSON.parse(localStorage.getItem('threadmap-prefs-v2') || '{}').allowLoad === true), false);
      await count.fill('7');
      assert.equal(await host.page.getByLabel('切到其他标签页后继续本次').isChecked(), false);
      await host.page.getByRole('button', { name: '允许并加载' }).click();
      await host.page.getByText('正在载入 1/61 楼', { exact: true }).waitFor();
      await host.page.clock.fastForward(5001);
      await host.page.getByText('本次新增 7 楼，完成 2 次请求。', { exact: false }).waitFor();
      assert.equal(host.requests.length, 2);
      assert.equal(new URL(host.requests[1].url).searchParams.getAll('post_ids[]').length, 7);
      assert((await panel(host.page).innerText()).includes('已载入 8 楼 / 61'));
      assert(await host.page.locator('.tm-range span').count() <= 48);
      await host.page.screenshot({ path: 'acceptance/artifacts/experience-after-loading.png' });
      await host.page.clock.fastForward(60 * 60_000); assert.equal(host.requests.length, 2);
      const nextLoad = host.page.getByRole('button', { name: '加载更多楼层', exact: true });
      await nextLoad.click(); assert.equal(await count.inputValue(), '7');
      await host.page.getByRole('button', { name: '先不加载' }).click();
      assert(await nextLoad.evaluate(el => el.getRootNode().activeElement === el));
      return { defaultTarget: 20, selectedTarget: 7, requests: 2, invalidInputRequests: 0, autoResume: false };
    } finally { await host.page.close(); }
  });

  for (const background of [false, true]) await check(`后台选择：${background ? '勾选后只完成本次40楼' : '默认切走停止并保留20楼'}，返回不自动续跑`, async () => {
    const topic = background ? 7205 : 7204, all = Array.from({ length: 61 }, (_, i) => post(i + 1, '用于后台策略验证的普通讨论。', null, topic));
    const host = await prepare(topic, all.slice(0, 1), (route, entry) => {
      const ids = new URL(entry.url).searchParams.getAll('post_ids[]').map(Number);
      return json(route, { posts: all.filter(p => ids.includes(p.id)) });
    }, false, { allowLoad: true, loadCount: 40 });
    try {
      await host.page.clock.install({ time: new Date() });
      await store(host.page, topic, all.slice(0, 1), all.map(p => p.id)); await host.boot(); await edge(host.page).click();
      await host.page.getByRole('button', { name: '加载更多楼层', exact: true }).click();
      if (background) await host.page.getByLabel('切到其他标签页后继续本次').check();
      await host.page.getByRole('button', { name: '开始加载', exact: true }).click();
      await host.page.getByRole('status', { name: '本次加载' }).filter({ hasText: '本次新增 20/40' }).waitFor();
      await host.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      if (background) {
        await host.page.clock.fastForward(5001);
        await host.page.getByText('本次新增 40 楼，完成 2 次请求。', { exact: false }).waitFor();
      } else await host.page.getByText('已取消：切换标签页', { exact: false }).waitFor();
      assert.equal(host.requests.length, background ? 2 : 1);
      assert((await panel(host.page).innerText()).includes(`已载入 ${background ? 41 : 21} 楼 / 61`));
      await host.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
      await host.page.clock.fastForward(61_000); assert.equal(host.requests.length, background ? 2 : 1);
      return { optedIn: background, requests: host.requests.length, retainedPosts: background ? 41 : 21, autoResume: false };
    } finally { await host.page.close(); }
  });
}
