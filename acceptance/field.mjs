import assert from 'node:assert/strict';
import { hostHtml, post } from './fixtures.mjs';

/**
 * 实测反馈的端到端检查：可选补取、模式隔离、构建标识和原生进度轴避让。
 * 只运行本地构建脚本；论坛页面、接口和资源全部由 prepare 拦截，不访问真实站点。
 */
export async function fieldChecks({ script, check, prepare, startLoad, enableLoad }) {
  const edge = page => page.getByRole('button', { name: /^展开 ThreadMap/ });
  const panel = page => page.locator('.tm-panel');
  const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
  const loadButton = page => page.getByRole('button', { name: '加载更多楼层', exact: true });
  const chainBadges = page => page.locator('.cooked > button[data-threadmap-owner]').filter({ hasText: /接 #|开局/ });
  const box = async locator => { const b = await locator.boundingBox(); assert(b, 'element not visible'); return b; };

  await check('可选补取：默认关闭且零请求；开启仍需确认；403 后自动关闭并跨刷新保持冷却', async () => {
    const topic = 7140;
    const host = await prepare(topic, [post(1, '主题说明。', null, topic)], route => route.fulfill({ status: 403, contentType: 'application/json', body: '{"errors":["forbidden"]}' }), false, null);
    try {
      await host.boot(); await edge(host.page).click();
      assert.equal(await loadButton(host.page).count(), 0, '出厂设置不应显示补取入口');
      await enableLoad(host.page);
      assert.equal(host.requests.length, 0, '开启许可本身不发请求');
      await loadButton(host.page).click();
      await host.page.getByRole('alert', { name: '确认加载' }).waitFor();
      assert.equal(host.requests.length, 0, '确认前不发请求');
      await host.page.getByRole('button', { name: '开始加载', exact: true }).click();
      await host.page.getByRole('alert').filter({ hasText: '已自动关闭主动补取' }).waitFor();
      assert.equal(host.requests.length, 1);
      assert.equal(await host.page.getByRole('switch', { name: '允许主动补取楼层' }).getAttribute('aria-checked'), 'false');
      assert.equal(await loadButton(host.page).count(), 0);
      assert.equal(await host.page.evaluate(() => JSON.parse(localStorage.getItem('threadmap-prefs-v2')).allowLoad), false);
      await host.page.reload(); await host.boot(); await edge(host.page).click();
      assert.equal(await loadButton(host.page).count(), 0, '刷新后仍保持关闭');
      await enableLoad(host.page); await startLoad(host.page);
      await host.page.getByRole('alert').filter({ hasText: '冷却' }).waitFor();
      assert.equal(host.requests.length, 1, '重新开启也不能绕过 403 冷却');
      return { requestsBeforeConfirm: 0, requestsAfter403: 1, allowLoadAfter403: false, extraRequestsAfterReload: 0 };
    } finally { await host.page.close(); }
  });

  await check('构建标识：运行实例与元数据一致；重复注入不生成第二套界面和监听', async () => {
    const id = script.match(/构建标识：([0-9a-f]{12})/)?.[1];
    assert(id, '构建产物缺少构建标识');
    const topic = 7141, host = await prepare(topic, [post(1, '主题说明。', null, topic)]);
    try {
      await host.boot();
      await host.page.addScriptTag({ content: script });
      await host.page.waitForTimeout(200);
      assert.equal(await host.page.locator('#threadmap-root').count(), 1);
      assert.equal(await host.page.locator('style#threadmap-host-style').count(), 1);
      assert.equal(await host.page.locator('#threadmap-root').getAttribute('data-threadmap-build'), id);
      await edge(host.page).click(); await tab(host.page, '规则').click();
      assert((await panel(host.page).innerText()).includes(id), '规则页应显示同一构建标识');
      assert.equal(host.requests.length, 0);
      return { buildId: id, roots: 1, requests: 0 };
    } finally { await host.page.close(); }
  });

  await check('模式隔离（构建产物）：显式切换后标注、输入和视图互不影响', async () => {
    const topic = 7142, shown = [
      ...['一心一意', '意气风发', '发奋图强', '强人所难'].map((text, i) => post(i + 1, text, null, topic)),
      post(5, '脚本怎么安装？', null, topic), post(6, '脚本安装方法是什么？', null, topic),
    ];
    const host = await prepare(topic, shown);
    try {
      await host.boot(); await edge(host.page).click();
      await host.page.locator('#tm-try').fill('难能可贵');
      assert(await chainBadges(host.page).count() > 0);
      await tab(host.page, '规则').click();
      await host.page.getByRole('group', { name: '工具模式' }).getByRole('button', { name: '问答', exact: true }).click();
      assert.deepEqual((await host.page.getByRole('tab').allInnerTexts()).map(t => t.replace(/\s+/g, '')), ['问答1', '规则']);
      assert(await host.page.getByRole('heading', { name: '问答规则' }).isVisible());
      await host.page.waitForFunction(() => document.querySelectorAll('.cooked > button[data-threadmap-owner]').length === 2);
      assert.equal(await chainBadges(host.page).count(), 0, '问答模式不能残留接龙标注');
      await tab(host.page, '问答').click();
      await host.page.locator('#tm-ask').fill('脚本安装');
      await tab(host.page, '规则').click();
      await host.page.getByRole('group', { name: '工具模式' }).getByRole('button', { name: '接龙', exact: true }).click();
      await tab(host.page, '接龙').click();
      assert.equal(await host.page.locator('#tm-try').inputValue(), '难能可贵');
      await host.page.waitForFunction(() => document.querySelectorAll('.cooked > button[data-threadmap-owner]').length >= 4);
      assert.equal(await host.page.locator('.cooked > button[data-threadmap-owner]').filter({ hasText: '被问过' }).count(), 0);
      await tab(host.page, '规则').click();
      await host.page.getByRole('group', { name: '工具模式' }).getByRole('button', { name: '问答', exact: true }).click();
      await tab(host.page, '问答').click();
      assert.equal(await host.page.locator('#tm-ask').inputValue(), '脚本安装');
      assert.equal(host.requests.length, 0);
      return { retainedChainInput: true, retainedQaQuery: true, crossModeBadges: 0, requests: 0 };
    } finally { await host.page.close(); }
  });

  await check('自动并排：正文与进度轴同时可见，左右偏好/全屏/窄屏/动态布局有明确边界', async () => {
    const topic = 7143, host = await prepare(topic, [post(1, '主题说明。', null, topic), post(2, '普通回复。', null, topic)]);
    const addTimeline = page => page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'timeline-container';
      el.style.cssText = 'position:fixed;top:180px;right:24px;width:150px;height:320px;z-index:400;background:#fff';
      el.innerHTML = '<div class="topic-timeline" style="height:100%"><button type="button" id="native-progress" style="margin-top:120px">111 / 5555</button></div>';
      window.__nativeClicks = 0;
      el.querySelector('button').addEventListener('click', () => { window.__nativeClicks++; });
      document.body.append(el);
    });
    const visibleTarget = page => page.evaluate(() => {
      const rect = document.querySelector('#native-progress').getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id === 'native-progress';
    });
    const waitOffset = value => host.page.waitForFunction(value => getComputedStyle(document.querySelector('#threadmap-root')).getPropertyValue('--tm-dock-offset').trim() === value, value);
    const noOverlap = async target => {
      const p = await box(target), body = await box(host.page.locator('.topic-post').first()), axis = await box(host.page.locator('.timeline-container'));
      for (const rect of [body, axis]) assert(p.x + p.width <= rect.x || p.x >= rect.x + rect.width, `界面与正文/控件相交：${JSON.stringify({ p, rect })}`);
    };
    try {
      await addTimeline(host.page); await host.boot(); await waitOffset('182px');
      await noOverlap(edge(host.page));
      assert.equal(await edge(host.page).evaluate(el => getComputedStyle(el).borderRightWidth), '1px');
      await edge(host.page).click(); await noOverlap(panel(host.page));
      assert.equal(await panel(host.page).getAttribute('data-layout'), 'sidecar');
      assert(await visibleTarget(host.page)); await host.page.locator('#native-progress').click();
      assert.equal(await host.page.evaluate(() => window.__nativeClicks), 1);
      await tab(host.page, '规则').click();
      assert.equal(await host.page.getByRole('switch', { name: /避让|页面空白/ }).count(), 0, '布局应做好默认，不再增加避让开关');
      await host.page.getByRole('group', { name: '停靠位置' }).getByRole('button', { name: '左侧' }).click();
      assert.equal(await panel(host.page).getAttribute('data-side'), 'right', '左侧不足320时不能强行盖正文');
      await noOverlap(panel(host.page));
      await host.page.setViewportSize({ width: 1920, height: 960 });
      await host.page.waitForFunction(() => document.querySelector('#threadmap-root').shadowRoot.querySelector('.tm-panel').dataset.side === 'left');
      await noOverlap(panel(host.page));
      await host.page.getByRole('group', { name: '停靠位置' }).getByRole('button', { name: '右侧' }).click();
      await host.page.setViewportSize({ width: 1440, height: 960 }); await waitOffset('182px');
      await host.page.getByRole('button', { name: '全屏' }).click();
      assert.equal(await visibleTarget(host.page), false, '全屏是明确覆盖选择');
      await host.page.getByRole('button', { name: '退出全屏' }).click();
      await host.page.setViewportSize({ width: 560, height: 900 }); await waitOffset('0px');
      assert.equal(await panel(host.page).getAttribute('data-layout'), 'drawer');
      await host.page.getByText('没有足够的并排空白', { exact: false }).waitFor();
      await host.page.setViewportSize({ width: 1440, height: 960 }); await waitOffset('182px');
      await host.page.getByRole('button', { name: '钉成小窗' }).click();
      const hud = host.page.getByRole('region', { name: /^ThreadMap .*小窗$/ });
      await hud.waitFor(); await noOverlap(hud); assert(await visibleTarget(host.page));
      await hud.getByRole('button', { name: '展开面板' }).click();
      await host.page.evaluate(() => document.querySelector('.timeline-container').remove()); await waitOffset('0px');
      await addTimeline(host.page); await waitOffset('182px'); await noOverlap(panel(host.page));
      assert.equal(host.requests.length, 0);
      return { checksBodyAndTimeline: true, automaticSideFallback: true, narrowLayout: 'drawer', requests: 0 };
    } finally { await host.page.close(); }
  });
}
