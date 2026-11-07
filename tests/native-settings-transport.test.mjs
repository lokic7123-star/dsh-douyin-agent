import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchSettings, SETTINGS_PREFIX } from '../native-settings-transport.mjs';

// transport 白名单单测：纯 Node，不依赖宿主 SDK（verification/settings-transport.test.mjs 因 F:\codex SDK 路径本机跑不了）。
// 背景：client.js routes Set / native-settings.mjs case 分支里有 /interactions/configure，
// 但 transport writes 白名单此前缺该路由，DSH RPC 模式下好友互动总开关点击必 400（本轮修复的断链）。
function stubRoute() {
  const seen = [];
  return { seen, route: { kind: 'prefix', path: '/api/douyin-browser', async handler(request, response) {
    seen.push({ method: request.method, url: request.url });
    response.writeHead(200); response.end(JSON.stringify({ ok: true, method: request.method, url: request.url }));
  } } };
}

test('transport 白名单放行好友互动总开关（interactions/configure 三方对齐）', async () => {
  const f = stubRoute();
  const result = await dispatchSettings(f.route, { path: '/interactions/configure', input: { enabled: true }, token: 'a'.repeat(64) });
  assert.equal(result.status, 200);
  assert.deepEqual(f.seen, [{ method: 'POST', url: `${SETTINGS_PREFIX}/interactions/configure` }]);
  const disabled = await dispatchSettings(f.route, { path: '/interactions/configure', input: { enabled: false }, token: 'a'.repeat(64) });
  assert.equal(disabled.status, 200);
});

test('观看足迹以 GET 派发且允许 14/30 天，超界与未列路由仍拒绝', async () => {
  const f = stubRoute();
  for (const days of ['14', '30']) {
    const result = await dispatchSettings(f.route, { path: `/watched?days=${days}` });
    assert.equal(result.status, 200);
    assert.equal(f.seen.at(-1).method, 'GET', '足迹是只读 GET，不得注册成 POST');
  }
  assert.equal(f.seen[0].url, `${SETTINGS_PREFIX}/watched?days=14`);
  const wide = await dispatchSettings(f.route, { path: '/watched?days=90' });
  assert.equal(wide.status, 200);
  const tooWide = await dispatchSettings(f.route, { path: '/watched?days=144' });
  assert.equal(tooWide.status, 400);
  const unknown = await dispatchSettings(f.route, { path: '/persona/autowrite', input: { enabled: true } });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /只允许/);
});
