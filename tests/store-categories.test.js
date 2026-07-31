const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../electron/db');
const { createCategory, listCategories, updateCategory, deleteCategory,
        createTag, listTags, deleteTag } = require('../electron/store');

async function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  return await openDb(path.join(dir, 'test.db'));
}

test('分类 CRUD', async () => {
  const db = await tempDb();
  const id = createCategory(db, { name: '餐饮', type: 'expense' });
  assert.ok(id > 0);
  const list = listCategories(db, 'expense');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, '餐饮');
  updateCategory(db, id, { name: '伙食', type: 'expense', sort_order: 1 });
  assert.strictEqual(listCategories(db)[0].name, '伙食');
  deleteCategory(db, id);
  assert.strictEqual(listCategories(db).length, 0);
  db.close();
});

test('标签去重：重名返回同一 id', async () => {
  const db = await tempDb();
  const a = createTag(db, '出差');
  const b = createTag(db, '出差');
  assert.strictEqual(a, b);
  assert.strictEqual(listTags(db).length, 1);
  db.close();
});
