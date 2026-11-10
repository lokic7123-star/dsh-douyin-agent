import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchSettings, bindNativeSettingsRoutes, SETTINGS_PREFIX } from '../native-settings-transport.mjs';

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

// 2026-11-10 用户反馈「观看足迹还是 404」的根因：宿主 connection.fetch 是精确 pathname 表，
// 早前把 '/watched?days=14' 这类带查询串的路径拿去登记，宿主按路径段校验直接判非法路由，
// 请求因此全部 404。这里钉死「注册路径只能是路径名，不含查询串」。
test('只读路由按路径名登记，不把查询串写进注册路径', async () => {
  const registered = [];
  const ctx = {
    inject(names, handler) {
      const owner = {
        connection: { fetch: { register(route) { registered.push(route); } } },
        webServer: { register() {} },
        effect() {},
      };
      handler(owner);
      return { async dispose() {} };
    },
  };
  bindNativeSettingsRoutes(ctx, () => ({ kind: 'prefix', path: SETTINGS_PREFIX, async handler() {} }));
  const paths = registered.map(route => route.path);
  assert.ok(paths.includes(`${SETTINGS_PREFIX}/watched`), '观看足迹必须按路径名登记');
  assert.ok(paths.includes(`${SETTINGS_PREFIX}/thumb`), '封面必须按路径名登记');
  assert.ok(paths.includes(`${SETTINGS_PREFIX}/state`), '状态必须按路径名登记');
  assert.ok(paths.includes(`${SETTINGS_PREFIX}/reports/read`), '日报读取必须按路径名登记');
  for (const path of paths) assert.doesNotMatch(path, /\?/, `注册路径不应带查询串：${path}`);
  const watched = registered.find(route => route.path === `${SETTINGS_PREFIX}/watched`);
  assert.deepEqual(watched.methods, ['GET'], '只读路由必须是 GET');
});
