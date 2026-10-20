import assert from 'node:assert/strict';
import { hostHtml, post } from './fixtures.mjs';

/**
 * 安全与性能审计（docs/acceptance/security-performance-2026-10-16.md）复现过的缺陷的回归。
 * 原探针的反例断言在这里翻转为修复后的行为；全部页面、数据与资源请求都被拦截，不访问真实论坛。
 */
const DB = 'threadmap-post-cache-v1';
const fixture = topic => [
  post(1, '回归使用的合成主题说明。', null, topic),
  post(2, '脚本怎么安装？', null, topic),
  post(3, '先安装扩展再安装脚本。', 2, topic),
  post(4, '脚本怎么安装？', null, topic),
  post(5, '另一条相关回复。', 2, topic),
  post(6, '普通讨论。', null, topic),
];
const rules = async page => { if (!await page.locator('.tm-panel').isVisible()) await page.locator('.tm-edge').click(); await page.getByRole('tab', { name: '规则', exact: true }).click(); };
const saved = (page, n) => page.getByRole('status').filter({ hasText: `当前主题已保存 ${n} 楼` }).waitFor();
const enableCache = async (page, n) => { await rules(page); await page.getByRole('switch', { name: '在本机保存已载入正文' }).click(); await saved(page, n); };
const database = page => page.evaluate(async name => {
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open(name, 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try {
    const tx = db.transaction(['topics'], 'readonly');
    return await new Promise((resolve, reject) => { const r = tx.objectStore('topics').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  } finally { db.close(); }
}, DB);

/** 在 Node 端轮询数据库：异步谓词交给 waitForFunction 会因返回 Promise 被当作真值而空等。 */
const waitStore = async (page, predicate, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const topics = await database(page);
    if (predicate(topics)) return topics;
    if (Date.now() > deadline) throw new Error(`本机副本未达到预期：${JSON.stringify(topics)}`);
    await page.waitForTimeout(100);
  }
};

export async function regressionChecks({ context, script, check }) {
  const isolated = async run => {
    const ctx = await context.browser().newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    ctx.setDefaultTimeout(8000);
    const errors = [], dataRequests = [], navigations = [];
    ctx.on('page', page => page.on('pageerror', error => errors.push(String(error))));
    const make = async (topic, all, shown = all.slice(0, 1), css = '') => {
      const page = await ctx.newPage();
      let observed = all;
      const stream = all.map(p => p.id);
      await page.route('**/*', route => {
        const req = route.request();
        if (req.isNavigationRequest()) { navigations.push(req.url()); return route.fulfill({ contentType: 'text/html', body: hostHtml(shown, topic).replace('</style>', `${css}</style>`) }); }
        dataRequests.push(req.url()); return route.fulfill({ status: 404, body: '' });
      });
      const configure = () => page.evaluate(([topic, posts, stream]) => {
        window.__regressionModel = { id: topic, postStream: { posts, stream } };
        window.Discourse = { __container__: { lookup: name => name === 'service:current-user' ? { id: 7 } : name === 'controller:topic' ? { model: window.__regressionModel } : undefined } };
      }, [topic, observed, stream]);
      const boot = async () => { await configure(); await page.addScriptTag({ content: script }); await page.locator('.tm-edge').waitFor(); };
      await page.goto(`https://linux.do/t/regression/${topic}`); await boot();
      return {
        page,
        async observe(posts) { observed = posts; await configure(); await page.evaluate(() => document.querySelector('#topic').append(document.createElement('span'))); },
        async restart(posts) { observed = posts; shown = posts; await page.reload(); await boot(); },
      };
    };
    try {
      const evidence = await run({ make, navigations });
      assert.deepEqual(dataRequests, [], '回归场景不能产生额外数据/资源请求');
      assert.deepEqual(errors, [], '浏览器异常同样纳入验收');
      return evidence;
    } finally { await ctx.close(); }
  };

  await check('审计 F1：无标题段的同主题楼层路由不重建会话，进度与查询保留', () => isolated(async ({ make, navigations }) => {
    const topic = 7805, host = await make(topic, fixture(topic)), page = host.page;
    await page.evaluate(topic => { window.__originalRoot = document.getElementById('threadmap-root'); history.replaceState({}, '', `/t/%E6%B5%8B%E8%AF%95/${topic}`); }, topic);
    await page.locator('.tm-edge').click(); await page.locator('#tm-ask').fill('脚本安装');
    await page.locator('.tm-search-results button').first().click();
    const href = await page.getByRole('link', { name: '查看首问', exact: true }).getAttribute('href');
    assert.equal(href, `https://linux.do/t/${topic}/2`);
    await page.evaluate(href => history.pushState({}, '', href), href);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.__originalRoot === document.getElementById('threadmap-root')), true, '同主题不能替换根节点');
    assert.match(await page.locator('.tm-title small').innerText(), new RegExp(`主题 #${topic} · 已载入 6 楼`));
    assert.equal(await page.locator('#tm-ask').inputValue(), '脚本安装');
    // 跨主题仍然清理并重建
    await page.evaluate(() => history.pushState({}, '', '/t/9999/2'));
    await page.waitForFunction(() => window.__originalRoot !== document.getElementById('threadmap-root'));
    assert.equal(navigations.length, 1);
    return { href, sameTopicRootKept: true, loaded: 6, queryKept: true, crossTopicRebuilt: true, extraNavigations: 0 };
  }));

  await check('审计 F3：同会话已保存的正文被平台明确清空后，本机缓存随之清空', () => isolated(async ({ make }) => {
    const topic = 7801, all = fixture(topic), host = await make(topic, all);
    await enableCache(host.page, all.length);
    await host.observe(all.map((p, i) => i === 1 ? { ...p, cooked: '' } : p));
    await waitStore(host.page, topics => topics.length === 1 && !topics[0].posts.some(p => p.id === all[1].id) && topics[0].posts.length === all.length - 1);
    // 字段缺失的占位不是新事实：不覆盖已保存正文
    // 2 楼保持明确为空；3 楼字段缺失（JSON 序列化后不含 cooked）
    await host.observe(all.map((p, i) => i === 1 ? { ...p, cooked: '' } : i === 2 ? { ...p, cooked: undefined } : p));
    await host.page.waitForTimeout(1300);
    const stored = (await database(host.page))[0].posts;
    assert(!stored.some(p => p.id === all[1].id), '明确清空的楼从本机副本删除');
    assert.equal(stored.find(p => p.id === all[2].id).raw, all[2].cooked);
    return { explicitEmptyCleared: true, missingFieldKeptPrevious: true };
  }));

  await check('审计 F4：当前页只有空正文占位时不恢复历史缓存', () => isolated(async ({ make }) => {
    const topic = 7802, all = fixture(topic), host = await make(topic, all);
    await enableCache(host.page, all.length);
    await host.restart([{ ...all[0], cooked: '' }]); await rules(host.page);
    await host.page.getByRole('status').filter({ hasText: '当前页面没有可读楼层' }).waitFor();
    assert.equal(await host.page.getByText('含 5 楼本地缓存', { exact: false }).count(), 0);
    assert.match(await host.page.locator('.tm-title small').innerText(), /已载入 1 楼/);
    // 对照：页面出现真实正文后同账号恢复照常
    await host.restart(all.slice(0, 1)); await host.page.locator('.tm-edge').click();
    await host.page.getByText('含 5 楼本地缓存', { exact: false }).waitFor();
    return { placeholderRestored: 0, readableControlRestored: 5 };
  }));

  await check('验收 R1：全部当前正文都被明确清空后，本机副本也清空，刷新不再恢复', () => isolated(async ({ make }) => {
    const topic = 7811, all = fixture(topic).slice(0, 2), host = await make(topic, all, all);
    await enableCache(host.page, 2);
    await host.observe(all.map(p => ({ ...p, cooked: '' })));
    // 全部正文都清空：整个主题记录被删除
    await waitStore(host.page, topics => topics.length === 0);
    // 刷新后只有第 2 楼可读：被清空的第 1 楼不能作为缓存回来
    await host.restart([all[1]]); await host.page.locator('.tm-edge').click();
    await host.page.waitForTimeout(500);
    const notes = await host.page.getByText('本地缓存', { exact: false }).allInnerTexts();
    assert.deepEqual(notes, [], JSON.stringify({ notes, title: await host.page.locator('.tm-title small').innerText(), stored: await database(host.page) }));
    return { clearedRemovedFromStore: 2, restoredAfterReload: 0 };
  }));

  await check('验收 R2/R3：占位转真实正文后可保存；只有元数据变化不续期旧正文', () => isolated(async ({ make }) => {
    const topic = 7812, all = fixture(topic).slice(0, 2), host = await make(topic, all, all);
    await host.observe([{ ...all[0], cooked: undefined }, all[1]]);
    await host.observe(all);
    await enableCache(host.page, 2);
    const before = (await database(host.page))[0].posts.find(p => p.id === all[1].id);
    await host.observe([all[0], { ...all[1], cooked: undefined, like_count: 9 }]);
    await waitStore(host.page, topics => topics[0]?.posts.find(p => p.id === all[1].id)?.likeCount === 9);
    const after = (await database(host.page))[0].posts.find(p => p.id === all[1].id);
    assert.equal(after.raw, before.raw); assert.equal(after.seenAt, before.seenAt);
    return { savedAfterPlaceholder: 2, metadataUpdated: true, seenAtUnchanged: true };
  }));

  await check('验收 R4：页面只有空 HTML 结构（如 <p></p>）时不恢复历史缓存', () => isolated(async ({ make }) => {
    const topic = 7813, all = fixture(topic).slice(0, 2), host = await make(topic, all, all);
    await enableCache(host.page, 2);
    await host.restart([{ ...all[0], cooked: '<p></p><!-- 渲染中 -->' }]); await rules(host.page);
    await host.page.getByRole('status').filter({ hasText: '当前页面没有可读楼层' }).waitFor();
    assert.equal(await host.page.getByText('本地缓存', { exact: false }).count(), 0);
    return { emptyMarkupRestored: 0 };
  }));

  for (const empty of ['', '<p></p>']) await check(`验收 R7：刷新首次快照全是明确清空 ${JSON.stringify(empty)}，旧正文不再恢复`, () => isolated(async ({ make }) => {
    const topic = 7814, all = fixture(topic).slice(0, 2), host = await make(topic, all, all);
    await enableCache(host.page, 2);
    assert.equal((await database(host.page))[0].posts.length, 2);
    // 只在重载后的首次快照给出撤销，不补第二次 observe/DOM 变化来掩盖初始化遗漏。
    await host.restart(all.map(p => ({ ...p, cooked: empty }))); await rules(host.page);
    await host.page.getByRole('status').filter({ hasText: '当前页面没有可读楼层' }).waitFor();
    await waitStore(host.page, topics => topics.length === 0);
    assert.equal(await host.page.getByText('本地缓存', { exact: false }).count(), 0);
    // 再刷新，只有第 2 楼可读；等待缓存操作真正完成后检查，第 1 楼不能被恢复。
    await host.restart([all[1]]); await rules(host.page);
    await saved(host.page, 1);
    const stored = await waitStore(host.page, topics => topics.length === 1 && topics[0].posts.length === 1);
    assert.deepEqual(stored[0].posts.map(p => p.id), [all[1].id]);
    assert.match(await host.page.locator('.tm-title small').innerText(), /已载入 1 楼 \/ 2/);
    assert.equal(await host.page.getByText('本地缓存', { exact: false }).count(), 0);
    return { empty, clearedOnStartup: 2, savedAfterReload: 1, restoredClearedPosts: 0 };
  }));

  await check('审计 F7：调整宽度中取消拖动或离开主题，全局指针监听全部移除', () => isolated(async ({ make }) => {
    const topic = 7804, host = await make(topic, fixture(topic)), page = host.page;
    await page.locator('.tm-edge').click();
    await page.evaluate(() => {
      window.__listeners = new Map();
      const add = window.addEventListener, remove = window.removeEventListener;
      window.addEventListener = function (type, fn, options) { if (type.startsWith('pointer')) window.__listeners.set(fn, type); return add.call(this, type, fn, options); };
      window.removeEventListener = function (type, fn, options) { window.__listeners.delete(fn); return remove.call(this, type, fn, options); };
    });
    const width = () => page.locator('.tm-resize').getAttribute('aria-valuenow');
    const before = await width();
    await page.locator('.tm-resize').dispatchEvent('pointerdown', { clientX: 1000, pointerId: 1, button: 0 });
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 940 })));
    assert.notEqual(await width(), before);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
    assert.equal(await page.evaluate(() => window.__listeners.size), 0);
    assert.equal(await width(), before, '取消拖动恢复原宽度');
    await page.locator('.tm-resize').dispatchEvent('pointerdown', { clientX: 1000, pointerId: 2, button: 0 });
    assert.equal(await page.evaluate(() => window.__listeners.size), 3);
    await page.evaluate(() => history.pushState({}, '', '/latest'));
    await page.locator('#threadmap-root').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.__listeners.size), 0);
    return { afterCancel: 0, afterRouteDestroy: 0, widthRestoredOnCancel: true };
  }));

  await check('审计 V1：面板与原帖标注采用论坛强调色推导的同一强调色，普通按钮不染色', () => isolated(async ({ make }) => {
    const topic = 7806, all = fixture(topic);
    const host = await make(topic, all, all, ':root{--tertiary:#e45735}');
    const page = host.page;
    await page.locator('.tm-edge').click();
    await page.locator('#tm-ask').fill('脚本安装');
    await page.locator('.tm-search-results button').first().click();
    await page.getByRole('link', { name: '查看首问', exact: true }).waitFor();
    const colors = await page.evaluate(() => {
      const shadow = document.getElementById('threadmap-root').shadowRoot;
      const root = shadow.querySelector('.tm-root'), css = name => getComputedStyle(root).getPropertyValue(name).trim();
      const probe = document.createElement('span'); probe.style.color = css('--tm-c-accent'); root.append(probe);
      const accentRgb = getComputedStyle(probe).color; probe.remove();
      const plain = [...shadow.querySelectorAll('.tm-button:not([data-variant=primary])')].map(el => ({ text: el.textContent, color: getComputedStyle(el).color }));
      return { accent: css('--tm-c-accent'), focus: css('--tm-c-focus'), accentRgb, plain };
    });
    assert.equal(colors.accent, '#c13a1a', '在浅色表面上按同一色相调暗到满足对比度');
    assert.equal(colors.focus, colors.accent);
    assert(colors.plain.length >= 2, JSON.stringify(colors.plain));
    assert.deepEqual(colors.plain.filter(b => b.color === colors.accentRgb), [], '普通按钮/链接按钮不使用强调色');
    // 原帖到达描边使用同一强调色
    await page.getByRole('link', { name: '查看首问', exact: true }).click();
    const flash = page.locator('[data-post-number="2"] article.threadmap-flash');
    await flash.waitFor();
    // 描边颜色带 1.6 秒过渡，读中间帧没有意义；核对生效的变量（样式里 outline 直接引用它）
    assert.equal(await flash.evaluate(el => getComputedStyle(el).getPropertyValue('--threadmap-accent').trim()), '#c13a1a');
    // 论坛切到深色后重新推导
    await page.evaluate(() => { document.documentElement.style.setProperty('--secondary', '#111111'); });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('threadmap-root').shadowRoot.querySelector('.tm-root')).getPropertyValue('--tm-c-accent').trim() === '#ee9681');
    return { hostAccent: '#e45735', lightAccent: colors.accent, darkAccent: '#ee9681', plainButtons: colors.plain.length, plainButtonsUseAccent: 0, flashUsesAccent: true };
  }));
}
