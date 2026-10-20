import assert from 'node:assert/strict';
import { post } from './fixtures.mjs';

/** 双语与阅读页的真实产物检查；prepare 拦截所有数据与资源，绝不连接真实论坛。 */
export async function readerChecks({ check, prepare }) {
  const panel = page => page.locator('.tm-panel');
  const edge = page => page.locator('.tm-edge');
  const fixture = topic => {
    const items = [post(1, 'Discuss the project here.', null, topic)];
    for (let i = 0; i < 24; i++) {
      const number = items.length + 1, question = `How does widget${i} toggle${i} mode${i} work?`;
      items.push(post(number, question, null, topic), post(number + 1, question, null, topic),
        { ...post(number + 2, `First reply for widget${i}. Enable it in your profile.`, number, topic), like_count: 2 },
        { ...post(number + 3, `Second reply for widget${i}. ${'LongUnbrokenText'.repeat(100)}`, number, topic), username: 'reader'.repeat(16) });
    }
    return items;
  };
  const store = (page, topic, posts, lang = 'en-GB') => page.evaluate(([topic, posts, lang]) => {
    document.documentElement.lang = lang;
    window.__readerPosts = posts;
    window.Discourse = { __container__: { lookup: name => name === 'controller:topic' ? { model: { id: topic, postStream: { posts: window.__readerPosts, stream: window.__readerPosts.map(p => p.id) } } } : undefined } };
  }, [topic, posts, lang]);
  const inBounds = async page => {
    const result = await page.locator('.tm-body').evaluate(root => {
      const bounds = root.getBoundingClientRect();
      const visible = [...root.querySelectorAll('button,a[href],input,select,summary')].filter(el => el.getClientRects().length && !el.closest('[hidden]') && (!el.closest('details') || el.matches('summary') || el.closest('details').open));
      return { client: root.clientWidth, scroll: root.scrollWidth, bad: visible.map(el => ({ text: (el.getAttribute('aria-label') || el.textContent || '').slice(0, 80), rect: el.getBoundingClientRect().toJSON() })).filter(({ rect }) => rect.width < 24 || rect.height < 24 || rect.x < bounds.x - 1 || rect.right > bounds.right + 1) };
    });
    assert(result.scroll <= result.client, JSON.stringify(result)); assert.deepEqual(result.bad, []); return result;
  };

  await check('阅读页：一步进入相关回复，顶部切换；返回恢复深列表滚动与入口，Esc不收起面板', async () => {
    const topic = 7401, all = fixture(topic), host = await prepare(topic, all.slice(0, 1), undefined, false, null), page = host.page;
    try {
      await store(page, topic, all); await host.boot(); await edge(page).click();
      assert.equal(await page.locator('.tm-root').getAttribute('lang'), 'en');
      assert.deepEqual((await page.getByRole('tab').allInnerTexts()).map(s => s.replace(/\s+/g, '')), ['Q&A24', 'Settings']);
      assert.equal(await page.locator('.tm-repeated button').count(), 20, '列表必须分页，而非渲染全帖');
      const body = page.locator('.tm-body'), opener = page.locator('.tm-repeated button').nth(12);
      await opener.scrollIntoViewIfNeeded();
      const listScroll = await body.evaluate(el => el.scrollTop); assert(listScroll > 200);
      await opener.click();
      const preview = page.getByRole('region', { name: 'Post preview' });
      assert((await page.locator('.tm-post-text').innerText()).includes('First reply for widget12'));
      assert(await page.locator('.tm-question-context h3').evaluate(el => el.getRootNode().activeElement === el));
      await preview.getByRole('button', { name: 'Next', exact: true }).click();
      assert((await page.locator('.tm-post-text').innerText()).includes('Second reply for widget12'));
      assert(await page.locator('.tm-post-heading h3').evaluate(el => el.getRootNode().activeElement === el));
      await page.keyboard.press('Escape');
      assert(await panel(page).isVisible()); assert.equal(await page.locator('.tm-reader').count(), 0);
      assert(await opener.evaluate(el => el.getRootNode().activeElement === el));
      assert(Math.abs(await body.evaluate(el => el.scrollTop) - listScroll) <= 1, '返回必须恢复原列表位置');
      assert.equal(host.requests.length, 0);
      return { oneClickRead: true, originalListScroll: listScroll, restoredListScroll: await body.evaluate(el => el.scrollTop), requests: 0 };
    } finally { await page.close(); }
  });

  await check('双语阅读：语言切换保留查询/答案，动态跟随论坛；英文320px、长作者/正文、深色与焦点可用', async () => {
    const topic = 7402, all = fixture(topic), host = await prepare(topic, all.slice(0, 1), undefined, false, null), page = host.page;
    try {
      await store(page, topic, all); await host.boot(); await edge(page).click();
      await page.locator('#tm-ask').fill('widget0 toggle0 mode0');
      await page.locator('.tm-search-results button').click();
      await page.locator('.tm-reply-nav').getByRole('button', { name: 'Next', exact: true }).click();
      const reply = await page.locator('.tm-post-text').innerText();
      await page.getByRole('tab', { name: 'Settings' }).click();
      await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN');
      assert.equal(await page.locator('.tm-root').getAttribute('lang'), 'zh-CN');
      await page.getByRole('tab', { name: /^问答/ }).click();
      assert.equal(await page.locator('#tm-ask').inputValue(), 'widget0 toggle0 mode0');
      assert.equal(await page.locator('.tm-post-text').innerText(), reply);
      await page.getByRole('tab', { name: '规则' }).click(); await page.getByLabel('界面语言', { exact: true }).selectOption('auto');
      await page.getByRole('tab', { name: /^Q&A/ }).click();
      await page.evaluate(() => { document.documentElement.lang = 'zh-CN'; });
      await page.locator('.tm-root[lang="zh-CN"]').waitFor();
      await page.evaluate(() => { document.documentElement.lang = 'en'; });
      await page.locator('.tm-root[lang="en"]').waitFor();
      assert.equal(await page.locator('.tm-post-text').innerText(), reply);
      await page.setViewportSize({ width: 320, height: 640 });
      const geometry = await inBounds(page);
      await page.evaluate(() => { document.documentElement.style.setProperty('--secondary', '#111'); });
      await page.locator('.tm-root[data-scheme="dark"]').waitFor();
      await page.locator('.tm-body').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: 'acceptance/artifacts/reader-en-narrow.png' });
      await page.getByRole('button', { name: /Back to questions/ }).click();
      await page.getByRole('tab', { name: 'Settings' }).click(); await inBounds(page);
      assert((await panel(page).innerText()).includes('Unencrypted copies'));
      await page.getByLabel('Interface language', { exact: true }).selectOption('en');
      await page.reload(); await store(page, topic, all, 'zh-CN'); await host.boot(); await edge(page).click();
      assert.equal(await page.locator('.tm-root').getAttribute('lang'), 'en', '显式语言跨刷新保留');
      assert.equal(await page.locator('#tm-ask').inputValue(), '', '正文缓存以外的查询仍不持久保存');
      assert.equal(host.requests.length, 0);
      return { geometry, retainedReply: true, explicitLanguagePersists: true, requests: 0 };
    } finally { await page.close(); }
  });

  await check('英文确认/错误：默认零请求，403保护文案可即时切语言，不重试或扩大权限', async () => {
    const topic = 7403, host = await prepare(topic, [post(1, 'Topic introduction.', null, topic)], route => route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }), false, null), page = host.page;
    try {
      await page.evaluate(() => { document.documentElement.lang = 'de'; }); await host.boot(); await edge(page).click();
      assert.equal(await page.locator('.tm-root').getAttribute('lang'), 'en');
      await page.getByRole('button', { name: 'Load posts…', exact: true }).click();
      const confirmation = page.getByRole('alert', { name: 'Confirm load' });
      assert((await confirmation.innerText()).includes('The site may prohibit batch reads'));
      assert.equal(host.requests.length, 0);
      await page.getByRole('button', { name: 'Allow and load', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Loading permission was turned off' }).waitFor();
      assert.equal(host.requests.length, 1);
      await page.getByRole('tab', { name: 'Settings' }).click();
      await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN');
      await page.getByRole('alert').filter({ hasText: '已自动关闭主动补取' }).waitFor();
      assert.equal(await page.getByRole('switch', { name: '允许主动补取楼层' }).getAttribute('aria-checked'), 'false');
      assert.equal(await page.evaluate(() => Object.keys(window).some(key => /^threadmap.*(?:agent|reader|api)/i.test(key))), false, '未安装全局agent正文桥');
      assert.equal(host.requests.length, 1);
      return { fallback: 'en', requests: 1, protectionRetained: true, globalReaderApi: false };
    } finally { await page.close(); }
  });
}
