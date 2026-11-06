import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';

test('软件未答由后台处理，顶栏不提供人工清除入口且不展示旧核对副标题', async () => {
  const source=await fs.readFile(new URL('../src/main.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/function UnansweredDialog|setUnansweredOpen|onOpenUnanswered|chatResolveAll/);
  assert.match(source,/回复处理记录/);assert.match(source,/查看分享收据/);
  const component=source.slice(source.indexOf('function FriendPresence('),source.indexOf('function ReviewDialog('));
  const desktop=createRequire(new URL('../../package.json',import.meta.url));
  const code=desktop('esbuild').transformSync(component,{loader:'jsx',jsx:'transform',target:'es2022'}).code;
  const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)});
  const render=vm.runInNewContext(code+';FriendPresence;',{React:{createElement:h}});
  const tree=render({connected:true,presence:{reply:{status:'replying',online:true,label:'在线 · 回复中',reason:'正在处理许可会话的消息。'},review:{active:true,manualCount:2,label:'有2条未答',reason:'已核实的3个会话继续检查新消息。'}}});
  const nodes=value=>value&&typeof value==='object'?[value,...value.children.flatMap(nodes)]:[];
  const text=value=>value&&typeof value==='object'?value.children.map(text).join(' '):typeof value==='string'?value:'';
  assert.match(text(tree),/在线 · 回复中/);assert.doesNotMatch(text(tree),/未答|已核实|核对/);
  assert.equal(nodes(tree).some(item=>item.type==='button'||item.props.onClick),false);
  const down=render({connected:false,presence:{reply:{status:'replying',online:true,label:'在线 · 回复中'}}});
  assert.doesNotMatch(text(down),/在线 · 回复中/);assert.match(text(down),/状态待核实/);
});

test('UnansweredSection 合成待答卡片挂载渲染：支持 onOpenDouyin 传入与安全降级，不抛引用错误', async () => {
  const source = await fs.readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const sectionCode = source.slice(source.indexOf('const STATE_LABELS'), source.indexOf('function ForwardPanel('));
  const desktop = createRequire(new URL('../../package.json', import.meta.url));
  const transformed = desktop('esbuild').transformSync(sectionCode, { loader: 'jsx', jsx: 'transform', target: 'es2022' }).code;

  const h = (type, props, ...children) => {
    if (typeof type === 'function') return type({ ...(props || {}), children: children.flat(Infinity) });
    return { type, props: props || {}, children: children.flat(Infinity) };
  };
  const text = value => value && typeof value === 'object' ? value.children.map(text).join(' ') : (typeof value === 'string' || typeof value === 'number') ? String(value) : '';
  const nodes = value => value && typeof value === 'object' ? [value, ...value.children.flatMap(nodes)] : [];

  const context = {
    React: {
      createElement: h,
      useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
    },
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    Note: ({ children, error }) => h('div', { className: error ? 'note error' : 'note' }, children),
    Button: ({ children, onClick, disabled }) => h('button', { onClick, disabled }, children),
  };

  const UnansweredSection = vm.runInNewContext(transformed + ';UnansweredSection;', context);

  // 1. 设置缓存中待答数据（含 open-chat 动作）
  UnansweredSection.cache = {
    value: {
      protocol: 'chat-unanswered-v2',
      count: 1,
      checkedAt: new Date().toISOString(),
      items: [{
        recordId: 'synth-rec-1',
        contactName: '合成测试好友',
        backlogState: 'uncertain',
        availableActions: ['open-chat'],
        preview: '合成预览文本',
        progressNote: '发送结果未确认'
      }]
    }
  };

  // 2. 传入 onOpenDouyin 回调：必须正常渲染出「打开抖音」按钮与提示，且绝不抛 ReferenceError
  let opened = false;
  const onOpenDouyin = () => { opened = true; };
  const treeWithHandler = UnansweredSection({
    api: async () => {},
    run: () => {},
    busy: new Set(),
    connected: true,
    allowlist: [],
    workerActive: false,
    onOpenDouyin
  });

  const fullText = text(treeWithHandler);
  assert.match(fullText, /打开抖音/);
  assert.match(fullText, /打开抖音后请手动查找原会话核对/);
  const openBtn = nodes(treeWithHandler).find(item => item.type === 'button' && text(item).includes('打开抖音'));
  assert.ok(openBtn, '必须渲染出打开抖音按钮');
  openBtn.props.onClick();
  assert.equal(opened, true, '打开抖音按钮点击事件正常调用');

  // 3. 不传 onOpenDouyin 回调：安全降级为只读文本，同样绝不抛 ReferenceError
  const treeWithoutHandler = UnansweredSection({
    api: async () => {},
    run: () => {},
    busy: new Set(),
    connected: true,
    allowlist: [],
    workerActive: false
  });
  const fallbackText = text(treeWithoutHandler);
  assert.match(fallbackText, /打开抖音核对/);
  assert.match(fallbackText, /打开抖音后请手动查找原会话核对/);

  // 4. 统计与缓存提示渲染断言（对齐顶部展示）
  assert.match(fullText, /待答\s*1\s*条/);
  assert.match(fullText, /显示的是.*的缓存数据/);
});
