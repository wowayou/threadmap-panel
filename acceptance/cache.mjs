import assert from 'node:assert/strict';
import { hostHtml, post } from './fixtures.mjs';

const DB = 'threadmap-post-cache-v1';
const TTL = 24 * 60 * 60_000;
const edge = page => page.getByRole('button', { name: /^展开 ThreadMap/ });
const panel = page => page.locator('.tm-panel');
const rules = async page => { if (!await panel(page).isVisible()) await edge(page).click(); await page.getByRole('tab', { name: /^规则/ }).click(); };
const saved = (page, n) => page.getByRole('status').filter({ hasText: `当前主题已保存 ${n} 楼` }).waitFor();
const cacheSwitch = page => page.getByRole('switch', { name: '在本机保存已载入正文' });
const nativeState = page => page.evaluate(async name => {
  const db = await new Promise((resolve, reject) => { const req = indexedDB.open(name, 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); req.onupgradeneeded = () => { req.transaction.abort(); reject(new Error('应用尚未初始化数据库')); }; });
  try {
    const tx = db.transaction(['meta', 'topics'], 'readonly');
    const get = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const [control, topics] = await Promise.all([get(tx.objectStore('meta').get('control')), get(tx.objectStore('topics').getAll())]);
    return { control, topics };
  } finally { db.close(); }
}, DB);

/** 每个独立场景使用独立浏览器资料；页面、数据与恶意资源全部拦截，不访问真实论坛。 */
export async function cacheChecks({ context, script, check }) {
  const isolated = async run => {
    const ctx = await context.browser().newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    const errors = [], requests = [];
    ctx.setDefaultTimeout(8000);
    ctx.on('page', page => page.on('pageerror', error => errors.push(String(error))));
    const make = async (topic, initial, options = {}) => {
      let data = { posts: initial, stream: initial.map(p => p.id), account: 7, ...options };
      let origin = options.origin ?? 'https://linux.do';
      const page = await ctx.newPage();
      await page.route('**/*', route => {
        const req = route.request();
        if (req.isNavigationRequest() && req.frame() === page.mainFrame()) return route.fulfill({ contentType: 'text/html', body: hostHtml(data.posts.slice(0, 1), topic) });
        requests.push({ url: req.url(), method: req.method(), type: req.resourceType() });
        return route.fulfill({ status: 404, body: '' });
      });
      const configure = async () => page.evaluate(([topic, data]) => {
        window.__cacheAccount = data.account;
        window.__cacheModel = { id: topic, postStream: { posts: data.posts, stream: data.stream } };
        window.Discourse = { __container__: { lookup: name => name === 'service:current-user' ? window.__cacheAccount === null ? null : window.__cacheAccount === 'unknown' ? undefined : { id: window.__cacheAccount } : name === 'controller:topic' ? { model: window.__cacheModel } : undefined } };
      }, [topic, data]);
      const boot = async () => { await configure(); await page.addScriptTag({ content: script }); await edge(page).waitFor(); };
      await page.goto(`${origin}/t/cache/${topic}`); await boot();
      return {
        page,
        async restart(next = {}, nextOrigin = origin) { data = { ...data, ...next }; origin = nextOrigin; await page.goto(`${origin}/t/cache/${topic}`); await boot(); },
        async observe(posts, stream = data.stream) {
          data = { ...data, posts, stream }; await configure();
          await page.evaluate(() => document.querySelector('#topic').append(document.createElement('span')));
        },
      };
    };
    try {
      const result = await run({ make, requests, ctx });
      assert.deepEqual(requests, [], '缓存、恢复和恶意HTML均不能产生额外资源/数据请求');
      assert.deepEqual(errors, [], '新资料中的浏览器异常同样纳入验收');
      return result;
    } finally { await ctx.close(); }
  };
  const fixture = topic => [
    post(1, '缓存验收的主题说明。', null, topic), post(2, '脚本怎么安装？', null, topic),
    { ...post(3, '先装扩展，再安装脚本。', null, topic), cooked: `<aside class="quote" data-post="2" data-topic="${topic}"><blockquote>提问引用</blockquote></aside><p>先装扩展，再安装脚本。</p>` },
    post(4, '脚本安装方法是什么？', null, topic), post(5, '也可以先检查扩展是否启用。', 2, topic), post(6, '普通讨论。', null, topic),
  ];
  const enable = async (host, count) => { await rules(host.page); await cacheSwitch(host.page).click(); await saved(host.page, count); };

  await check('正文缓存：默认零正文写入；授权后刷新恢复并保留引用依据，不保存查询或输入', () => isolated(async ({ make }) => {
    const topic = 7301, all = fixture(topic), host = await make(topic, all);
    await rules(host.page);
    assert.equal(await cacheSwitch(host.page).getAttribute('aria-checked'), 'false');
    assert.equal((await nativeState(host.page)).topics.length, 0);
    await host.page.getByRole('tab', { name: /^问答/ }).click(); await host.page.locator('#tm-ask').fill('未发送且不应存入数据库的搜索内容');
    await enable(host, all.length);
    const stored = await nativeState(host.page);
    assert.equal(stored.topics.length, 1); assert.equal(stored.topics[0].posts.length, 6);
    assert(!JSON.stringify(stored).includes('未发送且不应存入数据库'));
    assert(stored.topics[0].posts.every(p => !('text' in p) && !('query' in p)));
    await host.restart({ posts: all.slice(0, 1) }); await edge(host.page).click();
    await host.page.getByText('含 5 楼本地缓存', { exact: false }).waitFor();
    assert((await panel(host.page).innerText()).includes('已载入 6 楼 / 6'));
    assert.equal(await host.page.locator('#tm-ask').inputValue(), '');
    await host.page.getByRole('button', { name: '阅读第 2 楼的问题与相关回复' }).first().click();
    assert((await host.page.locator('.tm-post-text').innerText()).includes('先装扩展，再安装脚本'));
    await host.page.screenshot({ path: 'acceptance/artifacts/cache-after-restore.png' });
    await host.observe([all[0], { ...all[1], cooked: '' }], all.slice(0, 5).map(p => p.id));
    await host.page.getByText('含 3 楼本地缓存', { exact: false }).waitFor();
    // 6 楼被新 stream 移除、2 楼被明确清空：都从副本删除，剩 4 楼
    await rules(host.page); await saved(host.page, 4);
    const refreshed = (await nativeState(host.page)).topics[0];
    assert(!refreshed.posts.some(p => p.id === all[1].id), '新观察到的明确空正文删除旧副本');
    assert(!refreshed.posts.some(p => p.id === all[5].id), '新stream已移除的旧缓存应落盘删除');
    return { saved: 6, restored: 5, referenceAnswerRetained: true, inputPersisted: false, freshEmptyWins: true, networkRequests: 0 };
  }));

  for (const boundary of ['account', 'anonymous', 'unknown', 'unreadable', 'origin']) await check(`缓存隔离：${boundary}不能恢复旧正文`, () => isolated(async ({ make }) => {
    const all = fixture(7310), host = await make(7310, all); await enable(host, 6);
    await host.restart({ posts: boundary === 'unreadable' ? [] : all.slice(0, 1), account: boundary === 'account' ? 8 : boundary === 'anonymous' ? null : boundary === 'unknown' ? 'unknown' : 7 }, boundary === 'origin' ? 'https://meta.discourse.org' : undefined);
    await rules(host.page);
    await host.page.waitForTimeout(250);
    assert((await panel(host.page).innerText()).includes(`已载入 ${boundary === 'unreadable' ? 0 : 1} 楼`));
    assert.equal(await host.page.getByText('含 5 楼本地缓存', { exact: false }).count(), 0);
    if (boundary === 'account' || boundary === 'anonymous') {
      const state = await nativeState(host.page); assert.equal(state.topics.length, 0); assert.equal(state.control.consent, null);
    }
    if (boundary === 'origin' || boundary === 'unknown') assert.equal(await cacheSwitch(host.page).getAttribute('aria-checked'), 'false');
    return { boundary, restored: 0, cacheCleared: boundary === 'account' || boundary === 'anonymous' };
  }));

  await check('缓存事务：清空与在途写入竞争后仍为空，跨页停止，冷却/设置/纠正不受影响', () => isolated(async ({ make }) => {
    const all = fixture(7320), a = await make(7320, all); await enable(a, 6);
    const b = await make(7320, all.slice(0, 1), { stream: all.map(p => p.id) }); await rules(b.page);
    await b.page.getByText('含 5 楼本地缓存', { exact: false }).waitFor();
    const before = await a.page.evaluate(() => {
      const values = { 'threadmap-load-guard-v1': JSON.stringify({ requests: [Date.now()], pausedUntil: Date.now() + 3600_000 }), 'threadmap-overrides-v1': '[]' };
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
      return Object.fromEntries(['threadmap-prefs-v2', ...Object.keys(values)].map(key => [key, localStorage.getItem(key)]));
    });
    // 用真实IDB事务暂时挡住写入队列。先排入缓存写入，再排入清空，检验原子顺序而非仅测UI状态。
    await a.page.evaluate(async name => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open(name, 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      window.__releaseCacheHold = false;
      const tx = db.transaction(['meta', 'topics'], 'readwrite');
      const keep = () => { const req = tx.objectStore('meta').get('hold'); req.onsuccess = () => { if (!window.__releaseCacheHold) keep(); }; };
      tx.oncomplete = () => db.close(); keep();
      window.__cacheQueuedTransactions = 0;
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) { if (args[1] === 'readwrite') window.__cacheQueuedTransactions++; return transaction.apply(this, args); };
    }, DB);
    await a.observe([...all, post(7, '竞争期间新观察到的合法内容。', null, 7320)], [...all.map(p => p.id), 7320007]);
    await a.page.waitForFunction(() => window.__cacheQueuedTransactions > 0);
    await a.page.getByRole('button', { name: '关闭并清空', exact: true }).click();
    await a.page.evaluate(() => { window.__releaseCacheHold = true; });
    await a.page.getByRole('status').filter({ hasText: '已关闭并清空本站正文缓存' }).waitFor();
    await b.page.getByRole('status').filter({ hasText: '其他标签页关闭并清空' }).waitFor();
    await a.page.waitForTimeout(1000);
    const state = await nativeState(a.page); assert.equal(state.topics.length, 0); assert.equal(state.control.consent, null);
    assert.equal(await cacheSwitch(b.page).getAttribute('aria-checked'), 'false');
    assert((await panel(b.page).innerText()).includes('已载入 1 楼'));
    const after = await a.page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(before));
    assert.deepEqual(after, before);
    await a.restart({ posts: all.slice(0, 1) }); await edge(a.page).click();
    assert((await panel(a.page).innerText()).includes('已载入 1 楼'));
    return { persistedPostsAfterClear: 0, lateWriteResurrection: false, otherTabStopped: true, unrelatedStoragePreserved: true };
  }));

  await check('缓存输入：过期不恢复，伪造的脚本/资源只作惰性文本解析', () => isolated(async ({ make }) => {
    const all = fixture(7330), host = await make(7330, all); await enable(host, 6);
    await host.page.evaluate(async ([name, topic]) => {
      const db = await new Promise(resolve => { const r = indexedDB.open(name, 1); r.onsuccess = () => resolve(r.result); });
      const tx = db.transaction(['topics'], 'readwrite'), store = tx.objectStore('topics');
      const record = await new Promise(resolve => { const r = store.get(topic); r.onsuccess = () => resolve(r.result); });
      record.posts[1].raw = '<script>window.__cacheExecuted=true</script><img src="https://cache-resource.invalid/pixel" onerror="window.__cacheExecuted=true"><p>脚本怎么安装？</p>';
      store.put(record, topic); await new Promise(resolve => { tx.oncomplete = resolve; }); db.close();
    }, [DB, 7330]);
    await host.restart({ posts: all.slice(0, 1) }); await edge(host.page).click();
    await host.page.getByText('含 5 楼本地缓存', { exact: false }).waitFor();
    assert.equal(await host.page.evaluate(() => window.__cacheExecuted === true), false);
    assert.equal(await host.page.locator('#threadmap-root img, #threadmap-root script, #threadmap-root iframe').count(), 0);
    await rules(host.page); await saved(host.page, 6);
    await host.page.evaluate(async ([name, topic, ttl]) => {
      const db = await new Promise(resolve => { const r = indexedDB.open(name, 1); r.onsuccess = () => resolve(r.result); });
      const tx = db.transaction(['topics'], 'readwrite'), store = tx.objectStore('topics');
      const record = await new Promise(resolve => { const r = store.get(topic); r.onsuccess = () => resolve(r.result); });
      record.posts.forEach(p => { p.seenAt = Date.now() - ttl - 1; });
      store.put(record, topic); await new Promise(resolve => { tx.oncomplete = resolve; }); db.close();
    }, [DB, 7330, TTL]);
    await host.restart({ posts: all.slice(0, 1) }); await rules(host.page); await saved(host.page, 1);
    assert((await panel(host.page).innerText()).includes('已载入 1 楼'));
    assert.equal((await nativeState(host.page)).topics[0].posts.length, 1);
    return { executed: false, resourceRequests: 0, expiredPostsRestored: 0 };
  }));

  await check('缓存配额失败：明确提示、停止重试，不冒充保存成功或破坏内存分析', () => isolated(async ({ make }) => {
    const all = fixture(7340), host = await make(7340, all); await rules(host.page);
    await host.page.evaluate(() => {
      window.__cachePuts = 0;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { if (this.name === 'topics') { window.__cachePuts++; throw new DOMException('fixture quota exhausted', 'QuotaExceededError'); } return put.apply(this, args); };
    });
    await cacheSwitch(host.page).click(); await host.page.getByRole('alert').filter({ hasText: '本地缓存未完成' }).waitFor();
    assert((await panel(host.page).innerText()).includes('已载入 6 楼 / 6'));
    await host.observe([...all, post(7, '存储失败后的普通讨论。', null, 7340)]); await host.page.waitForTimeout(1100);
    assert.equal(await host.page.evaluate(() => window.__cachePuts), 1);
    assert.equal((await nativeState(host.page)).topics.length, 0);
    await host.page.getByRole('button', { name: '关闭并清空' }).click();
    await host.page.getByRole('status').filter({ hasText: '已关闭并清空本站正文缓存' }).waitFor();
    return { failedWrites: 1, automaticRetries: 0, memoryAnalysisRetained: true };
  }));

  await check('缓存不可用/索引损坏：拒绝恢复且错误可见，清空可修复损坏索引', async () => {
    await isolated(async ({ make, ctx }) => {
      await ctx.addInitScript(() => Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => { throw new DOMException('fixture storage denied', 'SecurityError'); } }));
      const host = await make(7341, fixture(7341)); await rules(host.page);
      await host.page.getByRole('alert').filter({ hasText: '本地缓存未完成' }).waitFor();
      assert.equal(await cacheSwitch(host.page).getAttribute('aria-checked'), 'false');
      assert((await panel(host.page).innerText()).includes('已载入 6 楼'));
    });
    return isolated(async ({ make }) => {
      const all = fixture(7342), host = await make(7342, all); await enable(host, 6);
      await host.page.evaluate(async name => {
        const db = await new Promise(resolve => { const r = indexedDB.open(name, 1); r.onsuccess = () => resolve(r.result); });
        const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ consent: 'invalid', topics: {} }, 'control');
        await new Promise(resolve => { tx.oncomplete = resolve; }); db.close();
      }, DB);
      await host.restart({ posts: all.slice(0, 1) }); await rules(host.page);
      await host.page.getByRole('alert').filter({ hasText: '索引异常' }).waitFor();
      assert((await panel(host.page).innerText()).includes('已载入 1 楼'));
      await host.page.getByRole('button', { name: '关闭并清空' }).click();
      await host.page.getByRole('status').filter({ hasText: '已关闭并清空本站正文缓存' }).waitFor();
      assert.equal((await nativeState(host.page)).topics.length, 0);
      return { unavailableFailsVisible: true, corruptCacheRestored: false, clearRepairsIndex: true };
    });
  });

  await check('缓存容量：跨主题隔离，3主题/8MiB单主题/16MiB本站预算实际生效', () => isolated(async ({ make }) => {
    const first = await make(7350, fixture(7350)); await enable(first, 6);
    let last = first;
    for (const topic of [7351, 7352, 7353]) { last = await make(topic, fixture(topic)); await rules(last.page); await saved(last.page, 6); }
    let state = await nativeState(last.page);
    assert.deepEqual(state.topics.map(t => t.topicId), [7351, 7352, 7353]);
    const raw = '<p>' + '正文'.repeat(9900) + '</p>';
    for (const topic of [7354, 7355, 7356]) {
      const large = Array.from({ length: 300 }, (_, i) => ({ ...post(i + 1, '正文', null, topic), cooked: raw }));
      last = await make(topic, large); await rules(last.page);
      await last.page.getByRole('status').filter({ hasText: '达到缓存预算' }).waitFor({ timeout: 12000 });
    }
    state = await nativeState(last.page);
    const bytes = state.topics.reduce((sum, t) => sum + t.bytes, 0);
    assert(state.topics.length <= 3 && bytes <= 16 * 1024 * 1024);
    assert(state.topics.every(t => t.bytes <= 8 * 1024 * 1024 && t.posts.length < 300));
    assert(!state.topics.some(t => t.topicId === 7354), '全站字节上限应独立于主题数量上限淘汰旧主题');
    return { retainedTopics: state.topics.map(t => t.topicId), estimatedBytes: bytes, byteBudget: 16 * 1024 * 1024 };
  }));

  for (const count of [5000, 10000]) await check(`缓存性能：${count}楼恢复含解析/分析小于2.5秒，分片解析避免超过200ms的长任务`, () => isolated(async ({ make }) => {
    const topic = 7360, all = Array.from({ length: count }, (_, i) => post(i + 1, `第${i + 1}条缓存性能验证的普通讨论。`, null, topic));
    const host = await make(topic, all); await enable(host, count);
    await host.page.addInitScript(() => {
      window.__cacheWorstTask = 0;
      new PerformanceObserver(list => list.getEntries().forEach(e => { window.__cacheWorstTask = Math.max(window.__cacheWorstTask, e.duration); })).observe({ entryTypes: ['longtask'] });
      window.__cacheStart = performance.now();
    });
    await host.restart({ posts: all.slice(0, 1) }); await edge(host.page).click();
    await host.page.getByText(`含 ${count - 1} 楼本地缓存`, { exact: false }).waitFor({ timeout: 6000 });
    const metrics = await host.page.evaluate(() => ({ restoreMs: performance.now() - window.__cacheStart, longestTaskMs: window.__cacheWorstTask, observedHeapBytes: performance.memory?.usedJSHeapSize ?? null }));
    assert(metrics.restoreMs < 2500, JSON.stringify(metrics)); assert(metrics.longestTaskMs < 200, JSON.stringify(metrics));
    assert((await panel(host.page).innerText()).includes(`已载入 ${count} 楼 / ${count}`));
    return { ...metrics, posts: count, requests: 0, fixture: 'short synthetic posts; Chromium heap observation, not a real-site or peak-memory guarantee' };
  }));
}
