const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../electron/db');
const { createCategory, createTransaction } = require('../electron/store');
const { setBudget, getBudgets, getBudgetSummary } = require('../electron/budget');

async function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  return await openDb(path.join(dir, 'test.db'));
}

test('预算进度不含豁免支出，超支可检出', async () => {
  const db = await tempDb();
  const cat = createCategory(db, { name: '餐饮', type: 'expense' });
  setBudget(db, { categoryId: null, month: '2026-07', amount: 10000 });
  setBudget(db, { categoryId: cat, month: '2026-07', amount: 5000 });
  createTransaction(db, { type: 'expense', amount: 3000, date: '2026-07-03',
    categoryId: cat, note: '', exempt: 0, exemptNote: '', tagIds: [] });
  createTransaction(db, { type: 'expense', amount: 20000, date: '2026-07-04',
    categoryId: cat, note: '电脑', exempt: 1, exemptNote: '大额', tagIds: [] });
  const budgets = getBudgets(db, '2026-07');
  const total = budgets.find(b => b.categoryId === null);
  const food = budgets.find(b => b.categoryId === cat);
  assert.strictEqual(food.spent, 3000);          // 豁免不计入
  assert.strictEqual(food.over, false);
  assert.strictEqual(total.spent, 3000);         // 总额预算同样不含豁免
  assert.strictEqual(getBudgetSummary(db, '2026-07').totalSpent, 3000);
  assert.strictEqual(getBudgetSummary(db, '2026-07').overLimit, false);
  db.close();
});

test('超支警告触发', async () => {
  const db = await tempDb();
  setBudget(db, { categoryId: null, month: '2026-07', amount: 2000 });
  createTransaction(db, { type: 'expense', amount: 2500, date: '2026-07-03',
    categoryId: null, note: '', exempt: 0, exemptNote: '', tagIds: [] });
  assert.strictEqual(getBudgetSummary(db, '2026-07').overLimit, true);
  db.close();
});
