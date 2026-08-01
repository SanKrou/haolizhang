const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../electron/db');

test('openDb 建出全部表并支持写入读取', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  const db = await openDb(path.join(dir, 'test.db'));
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);
  assert.ok(tables.includes('transactions'));
  assert.ok(tables.includes('categories'));
  assert.ok(tables.includes('tags'));
  assert.ok(tables.includes('tx_tags'));
  assert.ok(tables.includes('budgets'));
  db.close();
});

test('重复 openDb 幂等，不报错', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  const p = path.join(dir, 'test.db');
  (await openDb(p)).close();
  (await openDb(p)).close();
});
