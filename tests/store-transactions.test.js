const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../electron/db');
const { createCategory, createTag } = require('../electron/store');
const { createTransaction, updateTransaction, deleteTransaction,
        listTransactions, getTransaction } = require('../electron/store');

async function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  return await openDb(path.join(dir, 'test.db'));
}

test('记账 CRUD：创建、读取、更新、删除', async () => {
  const db = await tempDb();
  const cat = createCategory(db, { name: '餐饮', type: 'expense' });
  const t1 = createTag(db, '出差');
  const id = createTransaction(db, {
    type: 'expense', amount: 1250, date: '2026-07-31',
    categoryId: cat, note: '午饭', exempt: 0, exemptNote: '', tagIds: [t1],
  });
  let tx = getTransaction(db, id);
  assert.strictEqual(tx.amount, 1250);
  assert.strictEqual(tx.exempt, 0);
  assert.deepStrictEqual(tx.tags.map(t => t.id), [t1]);
  updateTransaction(db, id, { type: 'expense', amount: 2000, date: '2026-07-31',
    categoryId: cat, note: '晚饭', exempt: 1, exemptNote: '请客', tagIds: [] });
  tx = getTransaction(db, id);
  assert.strictEqual(tx.amount, 2000);
  assert.strictEqual(tx.exempt, 1);
  assert.strictEqual(tx.exempt_note, '请客');
  assert.deepStrictEqual(tx.tags, []);
  deleteTransaction(db, id);
  assert.strictEqual(getTransaction(db, id), undefined);
  db.close();
});

test('listTransactions 分页与月度过滤', async () => {
  const db = await tempDb();
  const cat = createCategory(db, { name: '交通', type: 'expense' });
  for (let i = 0; i < 5; i++) {
    createTransaction(db, { type: 'expense', amount: 100, date: '2026-07-0' + (i + 1),
      categoryId: cat, note: '', exempt: 0, exemptNote: '', tagIds: [] });
  }
  const page1 = listTransactions(db, { page: 1, pageSize: 2 });
  assert.strictEqual(page1.items.length, 2);
  assert.strictEqual(page1.total, 5);
  const july = listTransactions(db, { page: 1, pageSize: 100, month: '2026-07' });
  assert.strictEqual(july.total, 5);
  db.close();
});

test('listTransactions 类型/豁免过滤与排序', async () => {
  const db = await tempDb();
  const cat = createCategory(db, { name: '餐饮', type: 'expense' });
  createTransaction(db, { type: 'expense', amount: 500, date: '2026-07-01',
    categoryId: cat, note: 'a', exempt: 0, exemptNote: '', tagIds: [] });
  createTransaction(db, { type: 'expense', amount: 9000, date: '2026-07-02',
    categoryId: cat, note: 'b', exempt: 1, exemptNote: '大额', tagIds: [] });
  createTransaction(db, { type: 'income', amount: 100000, date: '2026-07-03',
    categoryId: null, note: 'c', exempt: 0, exemptNote: '', tagIds: [] });
  const onlyExpense = listTransactions(db, { page: 1, pageSize: 100, type: 'expense' });
  assert.strictEqual(onlyExpense.total, 2);
  const onlyExempt = listTransactions(db, { page: 1, pageSize: 100, exempt: 1 });
  assert.strictEqual(onlyExempt.total, 1);
  assert.strictEqual(onlyExempt.items[0].note, 'b');
  const noExempt = listTransactions(db, { page: 1, pageSize: 100, exempt: 0 });
  assert.strictEqual(noExempt.total, 2);
  const byAmountAsc = listTransactions(db, { page: 1, pageSize: 100, sort: 'amount-asc' });
  assert.strictEqual(byAmountAsc.items[0].amount, 500);
  const byAmountDesc = listTransactions(db, { page: 1, pageSize: 100, sort: 'amount-desc' });
  assert.strictEqual(byAmountDesc.items[0].amount, 100000);
  const byDateAsc = listTransactions(db, { page: 1, pageSize: 100, sort: 'date-asc' });
  assert.strictEqual(byDateAsc.items[0].date, '2026-07-01');
  const combo = listTransactions(db, { page: 1, pageSize: 100, month: '2026-07', type: 'expense', exempt: 1, sort: 'amount-desc' });
  assert.strictEqual(combo.total, 1);
  assert.strictEqual(combo.items[0].note, 'b');
  db.close();
});
