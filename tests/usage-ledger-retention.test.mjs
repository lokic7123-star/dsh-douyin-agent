import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { UsageLedger } from '../usage-ledger.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-usage-keep-'));
  t.after(() => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('douyin-usage-keep-')) throw new Error('合成测试清理路径不符。');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, stateDir: path.join(root, 'state') };
}

test('按日用量文件只保留最近 90 天，更早的自动删除', t => {
  const { stateDir } = fixture(t);
  const directory = path.join(stateDir, 'usage');
  fs.mkdirSync(directory, { recursive: true });
  for (let index = 0; index < 120; index += 1) fs.writeFileSync(path.join(directory, `2026-01-${String(index % 28 + 1).padStart(2, '0')}.jsonl`), '{}\n');
  const ledger = new UsageLedger({ stateDir, now: () => Date.parse('2026-11-12T00:00:00.000Z') });
  ledger.record({ id: 'keep-1', source: 'api', kind: 'watch', model: 'm', usage: { totalTokens: 10 } });
  const names = fs.readdirSync(directory);
  assert.ok(names.length <= 91, `旧日期文件应被清理，实际还有 ${names.length} 个`);
  assert.ok(names.includes('2026-11-12.jsonl'), '今天的用量文件必须保留');
});
