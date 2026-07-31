const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../electron/db');
const { createCategory, createTransaction, getStatistics,
        getExemptTransactions } = require('../electron/store');

async function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  return await openDb(path.join(dir, 'test.db'));
}

test('月度统计：常规支出不含豁免，结余含豁免', async () => {
  const db = await tempDb();
  const cat = createCategory(db, { name: '餐饮', type: 'expense' });
  createTransaction(db, { type: 'income', amount: 100000, date: '2026-07-01',
    categoryId: null, note: '', exempt: 0, exemptNote: '', tagIds: [] });
  createTransaction(db, { type: 'expense', amount: 3000, date: '2026-07-05',
    categoryId: cat, note: '', exempt: 0, exemptNote: '', tagIds: [] });
  createTransaction(db, { type: 'expense', amount: 50000, date: '2026-07-10',
    categoryId: cat, note: '买电脑', exempt: 1, exemptNote: '大额', tagIds: [] });
  const s = getStatistics(db, { period: 'month', date: '2026-07-15' });
  assert.strictEqual(s.income, 100000);
  assert.strictEqual(s.expense, 3000);          // 不含豁免
  assert.strictEqual(s.exemptExpense, 50000);
  assert.strictEqual(s.balance, 100000 - 53000); // 结余含豁免
  assert.strictEqual(s.byCategory.length, 1);
  assert.strictEqual(s.byCategory[0].amount, 3000); // 饼图不含豁免
  db.close();
});

test('年度统计：总支出含豁免', async () => {
  const db = await tempDb();
  const cat = createCategory(db, { name: '数码', type: 'expense' });
  createTransaction(db, { type: 'expense', amount: 10000, date: '2026-03-01',
    categoryId: cat, note: '', exempt: 1, exemptNote: '', tagIds: [] });
  const s = getStatistics(db, { period: 'year', date: '2026-07-15' });
  assert.strictEqual(s.expense, 10000); // 年度支出含豁免
  db.close();
});

test('getExemptTransactions 返回当月豁免记录', async () => {
  const db = await tempDb();
  const cat = createCategory(db, { name: '数码', type: 'expense' });
  createTransaction(db, { type: 'expense', amount: 9000, date: '2026-07-02',
    categoryId: cat, note: '手机', exempt: 1, exemptNote: '大额', tagIds: [] });
  createTransaction(db, { type: 'expense', amount: 100, date: '2026-07-03',
    categoryId: cat, note: '配件', exempt: 0, exemptNote: '', tagIds: [] });
  const list = getExemptTransactions(db, '2026-07');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].note, '手机');
  db.close();
});
