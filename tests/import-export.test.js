const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../electron/db');
const { createCategory, createTransaction } = require('../electron/store');
const { setBudget } = require('../electron/budget');
const { parseExcelRows, importRows, exportCsv, exportSummary } = require('../electron/import-export');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-')); }

function makeXlsx(rows) {
  const XLSX = require('xlsx');
  const dir = tempDir();
  const file = path.join(dir, 'in.xlsx');
  const ws = XLSX.utils.aoa_to_sheet([['日期','类型','金额','分类','备注','豁免']].concat(rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, file);
  return file;
}

test('parseExcelRows 解析含豁免标记', () => {
  const file = makeXlsx([
    ['2026-07-01', '支出', 100, '餐饮', '午饭', ''],
    ['2026-07-02', '支出', 5000, '数码', '电脑', '是'],
    ['2026-07-03', '收入', 100000, '', '工资', ''],
  ]);
  const rows = parseExcelRows(file);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].type, 'expense'); // 类型列优先：支出+正金额 ≠ 收入
  assert.strictEqual(rows[0].exempt, false);
  assert.strictEqual(rows[1].type, 'expense'); // 豁免记录仍是支出
  assert.strictEqual(rows[1].exempt, true);
  assert.strictEqual(rows[2].type, 'income');
});

test('parseExcelRows 无类型列时按金额正负推断', () => {
  const XLSX = require('xlsx');
  const dir = tempDir();
  const file = path.join(dir, 'in2.xlsx');
  const ws = XLSX.utils.aoa_to_sheet([
    ['日期', '金额', '备注'],
    ['2026-07-01', 100, '入账'],
    ['2026-07-02', -50, '花销'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, file);
  const rows = parseExcelRows(file);
  assert.strictEqual(rows[0].type, 'income');  // 正 → 收入
  assert.strictEqual(rows[1].type, 'expense'); // 负 → 支出
});

test('importRows 失败整体回滚', async () => {
  const db = await openDb(path.join(tempDir(), 't.db'));
  const file = makeXlsx([
    ['2026-07-01', '支出', 100, '餐饮', '午饭', ''],
    ['bad-date', '支出', 200, '交通', '', ''],
  ]);
  const res = importRows(db, parseExcelRows(file), { createMissingCategories: false });
  assert.strictEqual(res.imported, 0);
  assert.ok(res.errors.length >= 1);
  const count = db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
  assert.strictEqual(count, 0); // 全部回滚
  db.close();
});

test('exportCsv 输出 BOM 且含豁免列', async () => {
  const db = await openDb(path.join(tempDir(), 't.db'));
  const dir = tempDir();
  const csv = path.join(dir, 'out.csv');
  exportCsv(db, csv);
  const raw = fs.readFileSync(csv);
  assert.strictEqual(raw[0], 0xEF); // UTF-8 BOM
  assert.match(raw.toString('utf8'), /豁免/);
  db.close();
});

test('exportCsv 对含逗号/引号/换行的备注做 RFC 4180 转义', async () => {
  const db = await openDb(path.join(tempDir(), 't.db'));
  const dir = tempDir();
  const csv = path.join(dir, 'out.csv');
  createTransaction(db, { type: 'expense', amount: 12345, date: '2026-07-05',
    categoryId: null, note: '备注,含"引号"\r\n换行', exempt: 0, exemptNote: '', tagIds: [] });
  exportCsv(db, csv);
  const text = fs.readFileSync(csv, 'utf8');
  // BOM 保留、CRLF 行分隔、备注字段被双引号包裹且内部引号翻倍、内嵌换行不拆行
  assert.strictEqual(text,
    '\uFEFF日期,类型,金额,分类,标签,备注,豁免,豁免原因\r\n'
    + '2026-07-05,支出,123.45,,,"备注,含""引号""\r\n换行",否,');
  db.close();
});

test('exportSummary 输出月度汇总文本', async () => {
  const db = await openDb(path.join(tempDir(), 't.db'));
  const cat = createCategory(db, { name: '餐饮', type: 'expense' });
  createTransaction(db, { type: 'income', amount: 100000, date: '2026-07-01',
    categoryId: null, note: '', exempt: 0, exemptNote: '', tagIds: [] });
  createTransaction(db, { type: 'expense', amount: 3000, date: '2026-07-05',
    categoryId: cat, note: '午饭', exempt: 0, exemptNote: '', tagIds: [] });
  createTransaction(db, { type: 'expense', amount: 50000, date: '2026-07-10',
    categoryId: cat, note: '买电脑', exempt: 1, exemptNote: '大额', tagIds: [] });
  setBudget(db, { categoryId: null, month: '2026-07', amount: 50000 });
  const dir = tempDir();
  const summaryPath = path.join(dir, 'summary.txt');
  exportSummary(db, summaryPath, { month: '2026-07' });
  const text = fs.readFileSync(summaryPath, 'utf8');
  assert.match(text, /总收入：1000\.00 元/);
  assert.match(text, /常规支出：30\.00 元/);
  assert.match(text, /重大支出（豁免）：500\.00 元/);
  assert.match(text, /本月结余：470\.00 元/);
  assert.match(text, /预算执行/);
  assert.match(text, /2026-07-10 餐饮 500\.00 元（大额）买电脑/);
  assert.match(text, /净 470\.00 元/);
  db.close();
});
