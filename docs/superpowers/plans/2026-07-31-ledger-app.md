# 记账应用（Ledger App）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Windows 桌面记账应用：记录收入/支出（自定义分类+标签），按日/月/年统计结余，月度预算超支警告，豁免重大支出机制，ECharts 图表，CSV+汇总文本导出，Excel 导入。

**Architecture:** Electron 应用，主进程（Node）负责全部数据操作（SQLite 读写、Excel 导入导出），渲染进程只做 UI；数据层为纯 Node 模块（不依赖 Electron），便于单元测试。项目直接位于仓库根目录 `E:\agent`。

**Tech Stack:** Electron、better-sqlite3（SQLite，失败时回退 sql.js）、xlsx（SheetJS，读 Excel）、ECharts、原生 HTML/CSS/JS（无前端框架）、node:test（测试）、npm 12 / Node 24。

## Global Constraints

- 平台：Windows 桌面应用，Electron；渲染进程 `contextIsolation: true`、`nodeIntegration: false`，仅通过 preload + contextBridge 暴露 IPC
- 金额一律以**整数分**存储（`amount` INTEGER），显示时除以 100；禁止浮点金额
- 统计口径（豁免规则，逐条遵守）：
  - 当日/当月**支出统计、预算进度、超支警告**：不含豁免支出（`exempt = 0` 仅）
  - 当日/当月**结余** = 收入 − **全部**支出（含豁免）
  - **季度、年度**总支出：含豁免
  - 豁免记录须可独立查询（`getExemptTransactions(month)`），供「重大支出」分区展示
- 导出 CSV 用 UTF-8 **with BOM**（Excel 打开不乱码）；汇总文本含：月度收支、分类占比、预算执行、结余趋势、重大支出清单
- 账本列表**分页**：每页 100 条
- 数据库文件 `ledger.db` 存放于 app 用户数据目录（`app.getPath('userData')`）
- 每个 Task 结束必须 git commit；提交信息格式见各 Task

---

### Task 1: 项目脚手架（package.json + Electron 最小窗口）

**Files:**
- Create: `package.json`
- Create: `electron/main.js`
- Create: `electron/preload.js`
- Create: `renderer/index.html`
- Create: `.gitignore`（追加：`node_modules/`）

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces: `electron/main.js` 导出启动入口（`npm start` 运行）；窗口 1280×800，加载 `renderer/index.html`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "ledger-app",
  "version": "0.1.0",
  "description": "Windows 桌面记账应用",
  "main": "electron/main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test tests/"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "echarts": "^5.5.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "electron": "^33.0.0"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `npm install`
Expected: 安装成功，`node_modules/electron`、`better-sqlite3`、`echarts`、`xlsx` 存在。若 `better-sqlite3` 原生编译失败，改用 `sql.js`（见 Task 2 的备用说明）。

- [ ] **Step 3: 写主进程入口 `electron/main.js`**

```js
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 4: 写 `electron/preload.js` 占位**

```js
// 后续 Task 8 填充完整 IPC 桥接
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('ledger', { ping: () => 'pong' });
```

- [ ] **Step 5: 写最小 `renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>记账应用</title>
</head>
<body>
  <h1>记账应用 — 脚手架验证</h1>
  <p id="ping"></p>
  <script>document.getElementById('ping').textContent = window.ledger.ping();</script>
</body>
</html>
```

- [ ] **Step 6: 手动验证**

Run: `npm start`
Expected: 弹出 1280×800 窗口，页面显示「记账应用 — 脚手架验证」和 `pong`。关闭窗口后进程退出。

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json electron renderer .gitignore
git commit -m "chore: Electron 项目脚手架（最小窗口 + preload 占位）"
```

---

### Task 2: 数据库层（SQLite 初始化 + 建表迁移）

**Files:**
- Create: `electron/db.js`
- Create: `tests/db.test.js`
- Modify: `package.json`（test script 已含 `tests/`）

**Interfaces:**
- Consumes: `better-sqlite3`（Task 1 已装）
- Produces: `openDb(dbPath)` → `Database`（已建好全部表并开启外键）；`initSchema(db)` → `void`（幂等：`CREATE TABLE IF NOT EXISTS`）

- [ ] **Step 1: 写失败测试 `tests/db.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../electron/db');

test('openDb 建出全部表并支持写入读取', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  const db = openDb(path.join(dir, 'test.db'));
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

test('重复 openDb 幂等，不报错', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  const p = path.join(dir, 'test.db');
  openDb(p).close();
  openDb(p).close();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，报 `Cannot find module '../electron/db'`

- [ ] **Step 3: 写 `electron/db.js`**

```js
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  date TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  note TEXT DEFAULT '',
  exempt INTEGER NOT NULL DEFAULT 0 CHECK (exempt IN (0,1)),
  exempt_note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE TABLE IF NOT EXISTS tx_tags (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  UNIQUE (category_id, month)
);
`;

function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb, SCHEMA };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（2 个测试）

- [ ] **Step 5: Commit**

```bash
git add electron/db.js tests/db.test.js
git commit -m "feat: SQLite 数据库层（建表迁移 + 幂等初始化）"
```

---

### Task 3: 分类与标签管理（CRUD）

**Files:**
- Create: `electron/store.js`
- Create: `tests/store-categories.test.js`

**Interfaces:**
- Consumes: `openDb(dbPath)`（Task 2）
- Produces（分类）: `createCategory(db, {name, type})` → id；`listCategories(db, type?)` → `[{id,name,type,sort_order}]`；`updateCategory(db, id, {name,type,sort_order})` → void；`deleteCategory(db, id)` → void（有记录引用时抛错提示）
- Produces（标签）: `createTag(db, name)` → id（重名返回已有 id）；`listTags(db)` → `[{id,name}]`；`deleteTag(db, id)` → void

- [ ] **Step 1: 写失败测试 `tests/store-categories.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../electron/db');
const { createCategory, listCategories, updateCategory, deleteCategory,
        createTag, listTags, deleteTag } = require('../electron/store');

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  return openDb(path.join(dir, 'test.db'));
}

test('分类 CRUD', () => {
  const db = tempDb();
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

test('标签去重：重名返回同一 id', () => {
  const db = tempDb();
  const a = createTag(db, '出差');
  const b = createTag(db, '出差');
  assert.strictEqual(a, b);
  assert.strictEqual(listTags(db).length, 1);
  db.close();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '../electron/store'`

- [ ] **Step 3: 写 `electron/store.js`（分类标签部分）**

```js
const { openDb } = require('./db'); // 仅供类型参考，测试直接传 db

function createCategory(db, { name, type }) {
  const info = db.prepare(
    'INSERT INTO categories (name, type) VALUES (?, ?)'
  ).run(name, type);
  return Number(info.lastInsertRowid);
}

function listCategories(db, type) {
  if (type) {
    return db.prepare(
      'SELECT * FROM categories WHERE type = ? ORDER BY sort_order, id'
    ).all(type);
  }
  return db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
}

function updateCategory(db, id, { name, type, sort_order }) {
  db.prepare(
    'UPDATE categories SET name = ?, type = ?, sort_order = ? WHERE id = ?'
  ).run(name, type, sort_order, id);
}

function deleteCategory(db, id) {
  const used = db.prepare(
    'SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?'
  ).get(id);
  if (used.n > 0) throw new Error('该分类下已有记账记录，无法删除');
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

function createTag(db, name) {
  const row = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
  if (row) return row.id;
  const info = db.prepare('INSERT INTO tags (name) VALUES (?)').run(name);
  return Number(info.lastInsertRowid);
}

function listTags(db) {
  return db.prepare('SELECT * FROM tags ORDER BY name').all();
}

function deleteTag(db, id) {
  db.prepare('DELETE FROM tags WHERE id = ?').run(id);
}

module.exports = { createCategory, listCategories, updateCategory, deleteCategory,
                   createTag, listTags, deleteTag };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（含 Task 2 共 4 个测试）

- [ ] **Step 5: Commit**

```bash
git add electron/store.js tests/store-categories.test.js
git commit -m "feat: 分类与标签 CRUD"
```

---

### Task 4: 记账记录 CRUD（含豁免字段与标签关联）

**Files:**
- Modify: `electron/store.js`（追加记账函数）
- Create: `tests/store-transactions.test.js`

**Interfaces:**
- Consumes: Task 3 的 `db` 约定
- Produces: `createTransaction(db, {type, amount, date, categoryId, note, exempt, exemptNote, tagIds})` → id（事务内写 transactions + tx_tags）；`updateTransaction(db, id, fields)` → void（覆盖标签）；`deleteTransaction(db, id)` → void；`listTransactions(db, {page, pageSize, month})` → `{items, total}`（按 date DESC, id DESC；item 含 `tags: []`）；`getTransaction(db, id)` → 单条含 tags

- [ ] **Step 1: 写失败测试 `tests/store-transactions.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../electron/db');
const { createCategory, createTag } = require('../electron/store');
const { createTransaction, updateTransaction, deleteTransaction,
        listTransactions, getTransaction } = require('../electron/store');

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  return openDb(path.join(dir, 'test.db'));
}

test('记账 CRUD：创建、读取、更新、删除', () => {
  const db = tempDb();
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

test('listTransactions 分页与月度过滤', () => {
  const db = tempDb();
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，`createTransaction is not a function`

- [ ] **Step 3: 追加记账函数到 `electron/store.js`**

```js
const TAG_SELECT = `(
  SELECT COALESCE(json_group_array(json_object('id', t.id, 'name', t.name)), '[]')
  FROM tx_tags tt JOIN tags t ON t.id = tt.tag_id
  WHERE tt.transaction_id = transactions.id
)`;

function createTransaction(db, { type, amount, date, categoryId, note, exempt, exemptNote, tagIds }) {
  const insert = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO transactions (type, amount, date, category_id, note, exempt, exempt_note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(type, amount, date, categoryId ?? null, note ?? '', exempt ? 1 : 0, exemptNote ?? '');
    const txId = Number(info.lastInsertRowid);
    const stmt = db.prepare('INSERT OR IGNORE INTO tx_tags (transaction_id, tag_id) VALUES (?, ?)');
    for (const tagId of tagIds || []) stmt.run(txId, tagId);
    return txId;
  });
  return insert();
}

function updateTransaction(db, id, { type, amount, date, categoryId, note, exempt, exemptNote, tagIds }) {
  db.transaction(() => {
    db.prepare(
      `UPDATE transactions SET type=?, amount=?, date=?, category_id=?, note=?, exempt=?, exempt_note=?
       WHERE id=?`
    ).run(type, amount, date, categoryId ?? null, note ?? '', exempt ? 1 : 0, exemptNote ?? '', id);
    db.prepare('DELETE FROM tx_tags WHERE transaction_id = ?').run(id);
    const stmt = db.prepare('INSERT OR IGNORE INTO tx_tags (transaction_id, tag_id) VALUES (?, ?)');
    for (const tagId of tagIds || []) stmt.run(id, tagId);
  })();
}

function deleteTransaction(db, id) {
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
}

function getTransaction(db, id) {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!tx) return undefined;
  tx.tags = JSON.parse(db.prepare(
    `SELECT COALESCE(json_group_array(json_object('id', t.id, 'name', t.name)), '[]') AS j
     FROM tx_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.transaction_id = ?`
  ).get(id).j);
  return tx;
}

function listTransactions(db, { page = 1, pageSize = 100, month } = {}) {
  const where = month ? 'WHERE strftime(\'%Y-%m\', date) = ?' : '';
  const params = month ? [month] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM transactions ${where}`).get(...params).n;
  const items = db.prepare(
    `SELECT *, ${TAG_SELECT} AS tags FROM transactions ${where}
     ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);
  for (const item of items) item.tags = JSON.parse(item.tags);
  return { items, total };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（共 6 个测试）

- [ ] **Step 5: Commit**

```bash
git add electron/store.js tests/store-transactions.test.js
git commit -m "feat: 记账记录 CRUD（豁免字段 + 标签多对多 + 分页）"
```

---

### Task 5: 统计查询（日/月/年聚合 + 豁免口径）

**Files:**
- Modify: `electron/store.js`（追加统计函数）
- Create: `tests/store-stats.test.js`

**Interfaces:**
- Consumes: Task 4 的 `createTransaction`
- Produces:
  - `getStatistics(db, {period: 'day'|'month'|'year', date: 'YYYY-MM-DD'})` →
    `{ income, expense, exemptExpense, balance, byCategory: [{name, amount}], trend: [{label, income, expense}] }`
    - 口径：`expense` 仅常规（`exempt=0`）；`exemptExpense` 为豁免合计；`balance = income - (expense + exemptExpense)`；日/月视图 `byCategory` 不含豁免、年视图含豁免；`trend`：日视图=当月每日、月视图=当年每月、年视图=近 5 年
  - `getExemptTransactions(db, month)` → `[{id, amount, category_id, note, exempt_note, date}]`

- [ ] **Step 1: 写失败测试 `tests/store-stats.test.js`（重点覆盖豁免口径）**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../electron/db');
const { createCategory, createTransaction, getStatistics,
        getExemptTransactions } = require('../electron/store');

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  return openDb(path.join(dir, 'test.db'));
}

test('月度统计：常规支出不含豁免，结余含豁免', () => {
  const db = tempDb();
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

test('年度统计：总支出含豁免', () => {
  const db = tempDb();
  const cat = createCategory(db, { name: '数码', type: 'expense' });
  createTransaction(db, { type: 'expense', amount: 10000, date: '2026-03-01',
    categoryId: cat, note: '', exempt: 1, exemptNote: '', tagIds: [] });
  const s = getStatistics(db, { period: 'year', date: '2026-07-15' });
  assert.strictEqual(s.expense, 10000); // 年度支出含豁免
  db.close();
});

test('getExemptTransactions 返回当月豁免记录', () => {
  const db = tempDb();
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，`getStatistics is not a function`

- [ ] **Step 3: 追加统计函数到 `electron/store.js`**

```js
function getStatistics(db, { period, date }) {
  if (period === 'day') {
    return dayStats(db, date);
  }
  if (period === 'month') {
    return monthStats(db, date);
  }
  return yearStats(db, date);
}

function dayStats(db, date) {
  const row = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN type='income' THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type='expense' AND exempt=0 THEN amount END), 0) AS expense,
       COALESCE(SUM(CASE WHEN type='expense' AND exempt=1 THEN amount END), 0) AS exemptExpense
     FROM transactions WHERE date = ?`
  ).get(date);
  const byCategory = db.prepare(
    `SELECT c.name, SUM(t.amount) AS amount
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.date = ? AND t.type='expense' AND t.exempt=0
     GROUP BY c.id ORDER BY amount DESC`
  ).all(date);
  const trend = monthTrend(db, date.slice(0, 7), date);
  return finalize(row, byCategory, trend);
}

function monthStats(db, date) {
  const month = date.slice(0, 7);
  const row = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN type='income' THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type='expense' AND exempt=0 THEN amount END), 0) AS expense,
       COALESCE(SUM(CASE WHEN type='expense' AND exempt=1 THEN amount END), 0) AS exemptExpense
     FROM transactions WHERE strftime('%Y-%m', date) = ?`
  ).get(month);
  const byCategory = db.prepare(
    `SELECT c.name, SUM(t.amount) AS amount
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE strftime('%Y-%m', t.date) = ? AND t.type='expense' AND t.exempt=0
     GROUP BY c.id ORDER BY amount DESC`
  ).all(month);
  const trend = yearTrend(db, month.slice(0, 4), date);
  return finalize(row, byCategory, trend);
}

function yearStats(db, date) {
  const year = date.slice(0, 4);
  const row = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN type='income' THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type='expense' THEN amount END), 0) AS expense,
       COALESCE(SUM(CASE WHEN type='expense' AND exempt=1 THEN amount END), 0) AS exemptExpense
     FROM transactions WHERE strftime('%Y', date) = ?`
  ).get(year);
  const byCategory = db.prepare(
    `SELECT c.name, SUM(t.amount) AS amount
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE strftime('%Y', t.date) = ? AND t.type='expense'
     GROUP BY c.id ORDER BY amount DESC`
  ).all(year);
  const trend = lastYearsTrend(db, date);
  return finalize(row, byCategory, trend);
}

function finalize(row, byCategory, trend) {
  return {
    income: row.income,
    expense: row.expense,
    exemptExpense: row.exemptExpense,
    balance: row.income - (row.expense + row.exemptExpense),
    byCategory,
    trend,
  };
}

function monthTrend(db, month, upToDate) {
  return db.prepare(
    `SELECT date AS label,
       COALESCE(SUM(CASE WHEN type='income' THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type='expense' AND exempt=0 THEN amount END), 0) AS expense
     FROM transactions
     WHERE strftime('%Y-%m', date) = ? AND date <= ?
     GROUP BY date ORDER BY date`
  ).all(month, upToDate);
}

function yearTrend(db, year, upToDate) {
  return db.prepare(
    `SELECT strftime('%Y-%m', date) AS label,
       COALESCE(SUM(CASE WHEN type='income' THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type='expense' AND exempt=0 THEN amount END), 0) AS expense
     FROM transactions
     WHERE strftime('%Y', date) = ? AND date <= ?
     GROUP BY strftime('%Y-%m', date) ORDER BY label`
  ).all(year, upToDate);
}

function lastYearsTrend(db, upToDate) {
  const startYear = String(Number(upToDate.slice(0, 4)) - 4);
  return db.prepare(
    `SELECT strftime('%Y', date) AS label,
       COALESCE(SUM(CASE WHEN type='income' THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type='expense' THEN amount END), 0) AS expense
     FROM transactions
     WHERE strftime('%Y', date) >= ? AND date <= ?
     GROUP BY strftime('%Y', date) ORDER BY label`
  ).all(startYear, upToDate);
}

function getExemptTransactions(db, month) {
  return db.prepare(
    `SELECT id, type, amount, date, category_id, note, exempt_note
     FROM transactions
     WHERE strftime('%Y-%m', date) = ? AND exempt = 1
     ORDER BY date DESC`
  ).all(month);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（共 9 个测试；豁免口径 3 个关键断言全部命中）

- [ ] **Step 5: Commit**

```bash
git add electron/store.js tests/store-stats.test.js
git commit -m "feat: 日/月/年统计聚合（豁免口径 + 趋势 + 分类占比）"
```

---

### Task 6: 预算逻辑（CRUD + 进度/超支，不含豁免）

**Files:**
- Create: `electron/budget.js`
- Create: `tests/budget.test.js`

**Interfaces:**
- Consumes: Task 3/4 的 `db` 约定
- Produces: `setBudget(db, {categoryId, month, amount})` → void（upsert：`category_id` 与 `month` 组合唯一）；`getBudgets(db, month)` → `[{categoryId, categoryName, amount, spent, remaining, over}]`（`spent` 仅常规支出，`categoryId=null` 表示总额预算）；`getBudgetSummary(db, month)` → `{totalBudget, totalSpent, usedPercent, overLimit}`

- [ ] **Step 1: 写失败测试 `tests/budget.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../electron/db');
const { createCategory, createTransaction } = require('../electron/store');
const { setBudget, getBudgets, getBudgetSummary } = require('../electron/budget');

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  return openDb(path.join(dir, 'test.db'));
}

test('预算进度不含豁免支出，超支可检出', () => {
  const db = tempDb();
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

test('超支警告触发', () => {
  const db = tempDb();
  setBudget(db, { categoryId: null, month: '2026-07', amount: 2000 });
  createTransaction(db, { type: 'expense', amount: 2500, date: '2026-07-03',
    categoryId: null, note: '', exempt: 0, exemptNote: '', tagIds: [] });
  assert.strictEqual(getBudgetSummary(db, '2026-07').overLimit, true);
  db.close();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '../electron/budget'`

- [ ] **Step 3: 写 `electron/budget.js`**

```js
function setBudget(db, { categoryId, month, amount }) {
  const existing = db.prepare(
    'SELECT id FROM budgets WHERE category_id IS ? AND month = ?'
  ).get(categoryId ?? null, month);
  if (existing) {
    db.prepare('UPDATE budgets SET amount = ? WHERE id = ?').run(amount, existing.id);
  } else {
    db.prepare(
      'INSERT INTO budgets (category_id, month, amount) VALUES (?, ?, ?)'
    ).run(categoryId ?? null, month, amount);
  }
}

function spentFor(db, month, categoryId) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS n FROM transactions
     WHERE strftime('%Y-%m', date) = ? AND type='expense' AND exempt=0
       AND category_id IS ?`
  ).get(month, categoryId ?? null);
  return row.n;
}

function getBudgets(db, month) {
  return db.prepare(
    `SELECT b.category_id AS categoryId, c.name AS categoryName, b.amount
     FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
     WHERE b.month = ? ORDER BY b.category_id IS NOT NULL, b.category_id`
  ).all(month).map(b => {
    const spent = spentFor(db, month, b.categoryId);
    return { categoryId: b.categoryId, categoryName: b.categoryName,
             amount: b.amount, spent, remaining: b.amount - spent,
             over: spent > b.amount };
  });
}

function getBudgetSummary(db, month) {
  const budgets = getBudgets(db, month);
  const totalBudget = budgets.filter(b => b.categoryId === null)
    .reduce((s, b) => s + b.amount, 0);
  const totalSpent = budgets.filter(b => b.categoryId === null)
    .reduce((s, b) => s + b.spent, 0);
  const usedPercent = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  return { totalBudget, totalSpent, usedPercent, overLimit: totalBudget > 0 && totalSpent > totalBudget };
}

module.exports = { setBudget, getBudgets, getBudgetSummary };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（共 11 个测试）

- [ ] **Step 5: Commit**

```bash
git add electron/budget.js tests/budget.test.js
git commit -m "feat: 预算 CRUD 与超支计算（豁免不计入预算进度）"
```

---

### Task 7: 导入导出（Excel 导入 + CSV/汇总文本导出）

**Files:**
- Create: `electron/import-export.js`
- Create: `tests/import-export.test.js`

**Interfaces:**
- Consumes: Task 4 的 `createTransaction`；`xlsx` 库
- Produces:
  - `parseExcelRows(filePath)` → `[{type, amount, date, category, note, exempt}]`（`type` 由「收入/支出」列或金额正负推断；`exempt` 由「豁免」列 `是/1` 判定；日期统一 `YYYY-MM-DD`）
  - `importRows(db, rows, {createMissingCategories})` → `{imported, failed, errors: [{row, message}]}`；任一行失败则整体回滚（事务）；`category` 匹配不到且 `createMissingCategories=false` 时报错
  - `exportCsv(db, csvPath)` → 写 UTF-8 **with BOM** CSV，列：`日期,类型,金额,分类,标签,备注,豁免,豁免原因`
  - `exportSummary(db, summaryPath, {month})` → 写汇总文本（月度收支、分类占比、预算执行、结余趋势、重大支出清单）

- [ ] **Step 1: 写失败测试 `tests/import-export.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../electron/db');
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
  assert.strictEqual(rows[0].exempt, false);
  assert.strictEqual(rows[1].exempt, true);
  assert.strictEqual(rows[2].type, 'income');
});

test('importRows 失败整体回滚', () => {
  const db = openDb(path.join(tempDir(), 't.db'));
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

test('exportCsv 输出 BOM 且含豁免列', () => {
  const db = openDb(path.join(tempDir(), 't.db'));
  const dir = tempDir();
  const csv = path.join(dir, 'out.csv');
  exportCsv(db, csv);
  const raw = fs.readFileSync(csv);
  assert.strictEqual(raw[0], 0xEF); // UTF-8 BOM
  assert.match(raw.toString('utf8'), /豁免/);
  db.close();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '../electron/import-export'`

- [ ] **Step 3: 写 `electron/import-export.js`**

```js
const XLSX = require('xlsx');
const fs = require('node:fs');

function parseExcelRows(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const header = aoa[0].map(h => String(h).trim());
  const idx = {
    date: header.findIndex(h => h.includes('日期')),
    type: header.findIndex(h => h.includes('类型') || h.includes('收支')),
    amount: header.findIndex(h => h.includes('金额')),
    category: header.findIndex(h => h.includes('分类')),
    note: header.findIndex(h => h.includes('备注')),
    exempt: header.findIndex(h => h.includes('豁免')),
  };
  return aoa.slice(1).filter(r => r.some(c => String(c).trim() !== '')).map(row => {
    const amountRaw = String(row[idx.amount]).trim();
    const amount = Math.round(Math.abs(Number(amountRaw)) * 100);
    const typeRaw = String(row[idx.type] ?? '').trim();
    const type = (typeRaw === '收入' || typeRaw === 'income' || Number(amountRaw) > 0)
      ? 'income' : 'expense';
    const exemptRaw = String(row[idx.exempt] ?? '').trim();
    return {
      type,
      amount,
      date: normalizeDate(String(row[idx.date]).trim()),
      category: idx.category >= 0 ? String(row[idx.category] ?? '').trim() : '',
      note: idx.note >= 0 ? String(row[idx.note] ?? '').trim() : '',
      exempt: exemptRaw === '是' || exemptRaw === '1' || exemptRaw.toLowerCase() === 'yes',
    };
  });
}

function normalizeDate(raw) {
  const m = String(raw).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) throw new Error(`无法解析日期: ${raw}`);
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

function importRows(db, rows, { createMissingCategories }) {
  const categories = db.prepare('SELECT id, name, type FROM categories').all();
  const findCat = (name, type) =>
    categories.find(c => c.name === name && c.type === type);
  const errors = [];
  const insert = db.transaction(() => {
    let imported = 0;
    for (const [i, row] of rows.entries()) {
      try {
        let catId = null;
        if (row.category) {
          let cat = findCat(row.category, row.type);
          if (!cat) {
            if (!createMissingCategories) throw new Error(`分类「${row.category}」不存在`);
            const info = db.prepare(
              'INSERT INTO categories (name, type) VALUES (?, ?)'
            ).run(row.category, row.type);
            cat = { id: Number(info.lastInsertRowid), name: row.category, type: row.type };
            categories.push(cat);
          }
          catId = cat.id;
        }
        db.prepare(
          `INSERT INTO transactions (type, amount, date, category_id, note, exempt)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(row.type, row.amount, row.date, catId, row.note, row.exempt ? 1 : 0);
        imported++;
      } catch (e) {
        errors.push({ row: i + 2, message: e.message });
      }
    }
    if (errors.length > 0) throw new Error('IMPORT_FAILED');
    return imported;
  });
  try {
    const imported = insert();
    return { imported, failed: 0, errors: [] };
  } catch (e) {
    if (e.message === 'IMPORT_FAILED') {
      return { imported: 0, failed: rows.length, errors };
    }
    throw e;
  }
}

function exportCsv(db, csvPath) {
  const rows = db.prepare(
    `SELECT t.date, t.type, t.amount, c.name AS category, t.note, t.exempt, t.exempt_note,
            COALESCE((SELECT group_concat(tg.name, ';') FROM tx_tags tt
                      JOIN tags tg ON tg.id = tt.tag_id WHERE tt.transaction_id = t.id), '') AS tags
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     ORDER BY t.date DESC, t.id DESC`
  ).all();
  const header = ['日期', '类型', '金额', '分类', '标签', '备注', '豁免', '豁免原因'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const type = r.type === 'income' ? '收入' : '支出';
    lines.push([r.date, type, (r.amount / 100).toFixed(2), r.category ?? '',
      r.tags, r.note, r.exempt ? '是' : '否', r.exempt_note ?? ''].join(','));
  }
  fs.writeFileSync(csvPath, '\uFEFF' + lines.join('\r\n'), 'utf8');
}

function exportSummary(db, summaryPath, { month }) {
  const { getStatistics } = require('./store');
  const { getBudgetSummary } = require('./budget');
  const stats = getStatistics(db, { period: 'month', date: month + '-01' });
  const budget = getBudgetSummary(db, month);
  const exempts = db.prepare(
    `SELECT t.date, t.amount, c.name AS category, t.note, t.exempt_note
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE strftime('%Y-%m', t.date) = ? AND t.exempt = 1 ORDER BY t.date DESC`
  ).all(month);
  const L = [];
  L.push(`# 记账汇总（${month}）`);
  L.push('');
  L.push(`总收入：${(stats.income / 100).toFixed(2)} 元`);
  L.push(`常规支出：${(stats.expense / 100).toFixed(2)} 元`);
  L.push(`重大支出（豁免）：${(stats.exemptExpense / 100).toFixed(2)} 元`);
  L.push(`本月结余：${(stats.balance / 100).toFixed(2)} 元`);
  L.push('');
  L.push('## 分类占比（常规支出）');
  for (const c of stats.byCategory) {
    L.push(`- ${c.name}：${(c.amount / 100).toFixed(2)} 元`);
  }
  L.push('');
  L.push(`## 预算执行：总额预算 ${(budget.totalBudget / 100).toFixed(2)} 元，`
    + `已用 ${(budget.totalSpent / 100).toFixed(2)} 元（${budget.usedPercent}%）`
    + (budget.overLimit ? '，已超支！' : ''));
  L.push('');
  L.push('## 重大支出清单（豁免）');
  for (const e of exempts) {
    L.push(`- ${e.date} ${e.category ?? '未分类'} ${(e.amount / 100).toFixed(2)} 元（${e.exempt_note}）${e.note}`);
  }
  L.push('');
  L.push('## 结余趋势（近 12 个月）');
  const trend = db.prepare(
    `SELECT strftime('%Y-%m', date) AS label,
       SUM(CASE WHEN type='income' THEN amount ELSE -amount END) AS net
     FROM transactions WHERE date >= date(?, '-11 months') AND date <= ?
     GROUP BY strftime('%Y-%m', date) ORDER BY label`
  ).all(month + '-01', month + '-28');
  for (const t of trend) {
    L.push(`- ${t.label}：净 ${(t.net / 100).toFixed(2)} 元`);
  }
  fs.writeFileSync(summaryPath, L.join('\r\n'), 'utf8');
}

module.exports = { parseExcelRows, importRows, exportCsv, exportSummary };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS（共 14 个测试）

- [ ] **Step 5: Commit**

```bash
git add electron/import-export.js tests/import-export.test.js
git commit -m "feat: Excel 导入（事务回滚）与 CSV/汇总文本导出（BOM）"
```

---

### Task 8: IPC 桥接层（preload + 主进程通道注册）

**Files:**
- Modify: `electron/main.js`（初始化 db、注册 IPC）
- Modify: `electron/preload.js`（完整桥接）
- Create: `electron/ipc.js`

**Interfaces:**
- Consumes: Task 2-7 的全部函数
- Produces: `registerIpc(ipcMain, getDb)`；preload 暴露 `window.ledger`，方法命名与下文一致（每个方法返回 Promise，主进程统一 try/catch 返回 `{ok, data|error}`）：
  - `createTransaction(fields)`、`updateTransaction(id, fields)`、`deleteTransaction(id)`、`listTransactions({page,pageSize,month})`、`getTransaction(id)`
  - `createCategory(f)`、`listCategories(type?)`、`updateCategory(id,f)`、`deleteCategory(id)`
  - `createTag(name)`、`listTags()`、`deleteTag(id)`
  - `getStatistics({period,date})`、`getExemptTransactions(month)`
  - `setBudget(f)`、`getBudgets(month)`、`getBudgetSummary(month)`
  - `pickExcelFile()` → 打开文件对话框返回路径；`importExcel(path,{createMissingCategories})` → `{imported,failed,errors}`
  - `exportCsv()` → 保存对话框；`exportSummary(month)` → 保存对话框；均返回保存路径

- [ ] **Step 1: 写 `electron/ipc.js`（通道注册）**

```js
const { dialog } = require('electron');
const store = require('./store');
const budget = require('./budget');
const ie = require('./import-export');
const fs = require('node:fs');

function wrap(handler) {
  return async (_event, ...args) => {
    try {
      return { ok: true, data: await handler(...args) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
}

function registerIpc(ipcMain, getDb) {
  const db = () => getDb();
  ipcMain.handle('tx:create', wrap((f) => store.createTransaction(db(), f)));
  ipcMain.handle('tx:update', wrap((id, f) => store.updateTransaction(db(), id, f)));
  ipcMain.handle('tx:delete', wrap((id) => store.deleteTransaction(db(), id)));
  ipcMain.handle('tx:list', wrap((q) => store.listTransactions(db(), q)));
  ipcMain.handle('tx:get', wrap((id) => store.getTransaction(db(), id)));
  ipcMain.handle('cat:create', wrap((f) => store.createCategory(db(), f)));
  ipcMain.handle('cat:list', wrap((type) => store.listCategories(db(), type)));
  ipcMain.handle('cat:update', wrap((id, f) => store.updateCategory(db(), id, f)));
  ipcMain.handle('cat:delete', wrap((id) => store.deleteCategory(db(), id)));
  ipcMain.handle('tag:create', wrap((name) => store.createTag(db(), name)));
  ipcMain.handle('tag:list', wrap(() => store.listTags(db())));
  ipcMain.handle('tag:delete', wrap((id) => store.deleteTag(db(), id)));
  ipcMain.handle('stats:get', wrap((q) => store.getStatistics(db(), q)));
  ipcMain.handle('stats:exempt', wrap((month) => store.getExemptTransactions(db(), month)));
  ipcMain.handle('budget:set', wrap((f) => budget.setBudget(db(), f)));
  ipcMain.handle('budget:list', wrap((month) => budget.getBudgets(db(), month)));
  ipcMain.handle('budget:summary', wrap((month) => budget.getBudgetSummary(db(), month)));
  ipcMain.handle('file:pickExcel', wrap(async () => {
    const r = await dialog.showOpenDialog({ filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  }));
  ipcMain.handle('file:importExcel', wrap(async (filePath, opts) =>
    ie.importRows(db(), ie.parseExcelRows(filePath), opts)));
  ipcMain.handle('file:exportCsv', wrap(async () => {
    const r = await dialog.showSaveDialog({
      defaultPath: 'ledger-export.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (r.canceled || !r.filePath) return null;
    ie.exportCsv(db(), r.filePath);
    return r.filePath;
  }));
  ipcMain.handle('file:exportSummary', wrap(async (_e, month) => {
    const r = await dialog.showSaveDialog({
      defaultPath: `ledger-summary-${month}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (r.canceled || !r.filePath) return null;
    ie.exportSummary(db(), r.filePath, { month });
    return r.filePath;
  }));
}

module.exports = { registerIpc };
```

- [ ] **Step 2: 改写 `electron/preload.js` 完整桥接**

```js
const { contextBridge, ipcRenderer } = require('electron');

function api(channel) {
  return (...args) => ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld('ledger', {
  createTransaction: api('tx:create'),
  updateTransaction: api('tx:update'),
  deleteTransaction: api('tx:delete'),
  listTransactions: api('tx:list'),
  getTransaction: api('tx:get'),
  createCategory: api('cat:create'),
  listCategories: api('cat:list'),
  updateCategory: api('cat:update'),
  deleteCategory: api('cat:delete'),
  createTag: api('tag:create'),
  listTags: api('tag:list'),
  deleteTag: api('tag:delete'),
  getStatistics: api('stats:get'),
  getExemptTransactions: api('stats:exempt'),
  setBudget: api('budget:set'),
  getBudgets: api('budget:list'),
  getBudgetSummary: api('budget:summary'),
  pickExcelFile: api('file:pickExcel'),
  importExcel: api('file:importExcel'),
  exportCsv: api('file:exportCsv'),
  exportSummary: api('file:exportSummary'),
});
```

- [ ] **Step 3: 改写 `electron/main.js` 接入 db 与 IPC**

```js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { openDb } = require('./db');
const { registerIpc } = require('./ipc');

let db = null;
function getDb() {
  if (!db) {
    db = openDb(path.join(app.getPath('userData'), 'ledger.db'));
  }
  return db;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  getDb(); // 启动时初始化并做完整性检查
  registerIpc(ipcMain, getDb);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 4: 手动验证 IPC**

Run: `npm start`，然后在 DevTools Console 执行：
```js
await window.ledger.listCategories()
```
Expected: 返回 `{ok:true, data:[]}`（无报错），`window.ledger` 全部 21 个方法可用。

- [ ] **Step 5: Commit**

```bash
git add electron/main.js electron/preload.js electron/ipc.js
git commit -m "feat: IPC 桥接层（contextBridge 全量 API + 统一错误包装）"
```

---

### Task 9: 前端骨架（设计系统 + 导航布局）

**Files:**
- Create: `renderer/styles.css`
- Modify: `renderer/index.html`（替换占位内容）
- Create: `renderer/app.js`（视图切换路由）

**Interfaces:**
- Consumes: `window.ledger`（Task 8）
- Produces: 布局：左侧导航栏（6 个视图按钮 + 顶部当月结余卡片）、右侧内容区 `<main id="view-root">`；`window.showView(name)` 切换视图并触发 `view:change` 自定义事件；CSS 变量定义设计系统（`--bg`、`--card`、`--accent`、`--danger`、`--radius`、`--shadow`）

- [ ] **Step 1: 写 `renderer/styles.css`（设计系统 + 布局）**

```css
:root {
  --bg: #f4f6fb;
  --card: #ffffff;
  --accent: #4f7cff;
  --accent-soft: #e8eeff;
  --danger: #ff5a5f;
  --warn: #ffb020;
  --text: #1f2430;
  --text-muted: #8a91a5;
  --radius: 14px;
  --shadow: 0 2px 12px rgba(31, 36, 48, 0.08);
  --transition: 0.25s ease;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
  background: var(--bg); color: var(--text);
  display: grid; grid-template-columns: 220px 1fr; height: 100vh;
}
#sidebar {
  background: var(--card); border-right: 1px solid #eceff5;
  padding: 20px 14px; display: flex; flex-direction: column; gap: 6px;
}
#sidebar .brand { font-size: 18px; font-weight: 700; padding: 0 8px 14px; }
.nav-btn {
  border: none; background: transparent; text-align: left; cursor: pointer;
  padding: 10px 12px; border-radius: 10px; font-size: 14px; color: var(--text-muted);
  transition: background var(--transition), color var(--transition);
}
.nav-btn:hover { background: var(--accent-soft); color: var(--text); }
.nav-btn.active { background: var(--accent); color: #fff; }
#balance-card {
  margin-top: auto; background: linear-gradient(135deg, var(--accent), #7a5cff);
  color: #fff; border-radius: var(--radius); padding: 16px; box-shadow: var(--shadow);
}
#balance-card .label { font-size: 12px; opacity: 0.85; }
#balance-card .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
#view-root { padding: 24px 32px; overflow-y: auto; }
.card {
  background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow);
  padding: 20px; margin-bottom: 16px; animation: fadeUp 0.3s ease;
}
@keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.btn { border: none; cursor: pointer; padding: 8px 16px; border-radius: 10px;
  background: var(--accent); color: #fff; font-size: 14px; transition: opacity var(--transition); }
.btn:hover { opacity: 0.85; }
.btn.ghost { background: var(--accent-soft); color: var(--accent); }
.btn.danger { background: var(--danger); }
input, select {
  border: 1px solid #dde2ee; border-radius: 10px; padding: 8px 12px; font-size: 14px;
  background: #fff; outline: none; transition: border var(--transition);
}
input:focus, select:focus { border-color: var(--accent); }
.field-error { color: var(--danger); font-size: 12px; margin-top: 4px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px;
  background: var(--accent-soft); color: var(--accent); }
```

- [ ] **Step 2: 改写 `renderer/index.html` 为布局骨架**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>记账应用</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <aside id="sidebar">
    <div class="brand">💰 记账</div>
    <button class="nav-btn active" data-view="add">记一笔</button>
    <button class="nav-btn" data-view="ledger">账本</button>
    <button class="nav-btn" data-view="stats">统计</button>
    <button class="nav-btn" data-view="budget">预算</button>
    <button class="nav-btn" data-view="io">导入导出</button>
    <button class="nav-btn" data-view="manage">管理</button>
    <div id="balance-card">
      <div class="label">本月结余</div>
      <div class="value" id="balance-value">--</div>
    </div>
  </aside>
  <main id="view-root"></main>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: 写 `renderer/app.js`（路由骨架）**

```js
const views = ['add', 'ledger', 'stats', 'budget', 'io', 'manage'];
let currentView = 'add';

function renderView(name) {
  const root = document.getElementById('view-root');
  root.innerHTML = '';
  if (window.renderers && window.renderers[name]) {
    window.renderers[name](root);
  } else {
    root.innerHTML = `<div class="card">视图 ${name} 尚未实现（Task 10-15）</div>`;
  }
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  currentView = name;
  document.dispatchEvent(new CustomEvent('view:change', { detail: name }));
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => renderView(btn.dataset.view));
});

window.showView = renderView;
window.ledger.getStatistics({ period: 'month', date: new Date().toISOString().slice(0, 10) })
  .then(r => {
    if (r.ok) {
      document.getElementById('balance-value').textContent =
        (r.data.balance / 100).toFixed(2) + ' 元';
    }
  });

renderView('add');
```

- [ ] **Step 4: 手动验证**

Run: `npm start`
Expected: 左侧导航 + 结余卡片显示，点击各按钮切换视图（未实现的显示占位卡片），切换有淡入动画。

- [ ] **Step 5: Commit**

```bash
git add renderer/styles.css renderer/index.html renderer/app.js
git commit -m "feat: 前端骨架（设计系统 + 导航布局 + 视图路由）"
```

---

### Task 10: 记一笔视图（表单 + 校验 + 保存）

**Files:**
- Create: `renderer/pages/add.js`
- Modify: `renderer/index.html`（`<script src="pages/add.js">` 在 app.js 之前）
- Modify: `renderer/app.js`（加载 `window.renderers.add`）

**Interfaces:**
- Consumes: `window.ledger.listCategories/type`, `listTags`, `createTransaction`
- Produces: `window.renderers.add(root)` 渲染表单：类型切换（支出/收入）、金额、日期（默认今天）、分类下拉、标签多选（可输入新标签）、备注、豁免开关 + 豁免原因；保存成功刷新结余卡片并清空表单

- [ ] **Step 1: 写 `renderer/pages/add.js`**

```js
window.renderers = window.renderers || {};

window.renderers.add = async function (root) {
  root.innerHTML = `
    <div class="card">
      <h2>记一笔</h2>
      <div class="form" style="display:grid;gap:14px;max-width:560px">
        <div>
          <button class="btn" id="type-expense" type="button">支出</button>
          <button class="btn ghost" id="type-income" type="button">收入</button>
        </div>
        <div><label>金额（元）</label><input id="f-amount" type="number" min="0.01" step="0.01" /></div>
        <div><label>日期</label><input id="f-date" type="date" /></div>
        <div><label>分类</label><select id="f-category"></select></div>
        <div><label>标签</label><div id="f-tags"></div><input id="f-newtag" placeholder="输入新标签后回车" /></div>
        <div><label>备注</label><input id="f-note" /></div>
        <div>
          <label><input type="checkbox" id="f-exempt" /> 豁免（不计入当月支出/预算）</label>
          <input id="f-exemptnote" placeholder="豁免原因（如：大额/报销）" style="margin-top:6px" />
        </div>
        <div id="f-errors" class="field-error"></div>
        <button class="btn" id="f-save">保存</button>
      </div>
    </div>`;

  let type = 'expense';
  const catSel = root.querySelector('#f-category');
  const tagBox = root.querySelector('#f-tags');
  const errBox = root.querySelector('#f-errors');
  root.querySelector('#f-date').value = new Date().toISOString().slice(0, 10);

  async function loadCats() {
    const r = await window.ledger.listCategories(type);
    catSel.innerHTML = '<option value="">（未分类）</option>' +
      (r.ok ? r.data.map(c => `<option value="${c.id}">${c.name}</option>`).join('') : '');
  }
  const toggleType = (t) => {
    type = t;
    root.querySelector('#type-expense').className = t === 'expense' ? 'btn' : 'btn ghost';
    root.querySelector('#type-income').className = t === 'income' ? 'btn' : 'btn ghost';
    loadCats();
  };
  root.querySelector('#type-expense').onclick = () => toggleType('expense');
  root.querySelector('#type-income').onclick = () => toggleType('income');

  const tags = new Set();
  async function loadTags() {
    const r = await window.ledger.listTags();
    if (!r.ok) return;
    tagBox.innerHTML = r.data.map(t =>
      `<button type="button" class="badge" data-tag="${t.id}">${t.name}</button>`).join('');
    tagBox.querySelectorAll('[data-tag]').forEach(b => {
      b.onclick = () => {
        const id = Number(b.dataset.tag);
        if (tags.has(id)) { tags.delete(id); b.style.opacity = '0.5'; }
        else { tags.add(id); b.style.opacity = '1'; }
      };
      b.style.opacity = tags.has(Number(b.dataset.tag)) ? '1' : '0.5';
    });
  }
  root.querySelector('#f-newtag').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const r = await window.ledger.createTag(e.target.value.trim());
    if (r.ok) { e.target.value = ''; loadTags(); }
  });

  root.querySelector('#f-save').onclick = async () => {
    errBox.textContent = '';
    const amount = Math.round(parseFloat(root.querySelector('#f-amount').value) * 100);
    const date = root.querySelector('#f-date').value;
    if (!amount || amount <= 0) { errBox.textContent = '请输入有效金额'; return; }
    if (!date) { errBox.textContent = '请选择日期'; return; }
    const exempt = root.querySelector('#f-exempt').checked;
    if (exempt && !root.querySelector('#f-exemptnote').value.trim()) {
      errBox.textContent = '豁免需填写原因'; return;
    }
    const r = await window.ledger.createTransaction({
      type, amount, date,
      categoryId: catSel.value ? Number(catSel.value) : null,
      note: root.querySelector('#f-note').value.trim(),
      exempt, exemptNote: root.querySelector('#f-exemptnote').value.trim(),
      tagIds: [...tags],
    });
    if (!r.ok) { errBox.textContent = r.error; return; }
    root.querySelector('#f-amount').value = '';
    root.querySelector('#f-note').value = '';
    root.querySelector('#f-exempt').checked = false;
    root.querySelector('#f-exemptnote').value = '';
    tags.clear(); loadTags();
    const s = await window.ledger.getStatistics({ period: 'month', date });
    if (s.ok) {
      document.getElementById('balance-value').textContent =
        (s.data.balance / 100).toFixed(2) + ' 元';
    }
  };

  await Promise.all([loadCats(), loadTags()]);
};
```

- [ ] **Step 2: 修改 `renderer/index.html` 引入页面脚本（app.js 之前）**

```html
  <script src="pages/add.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 3: 手动验收**

Run: `npm start` → 记一笔页：
1. 选「支出」，金额 25.50，分类选新建的「餐饮」，备注「午饭」，保存 → 成功无报错
2. 勾选「豁免」不填原因 → 显示「豁免需填写原因」
3. 切「收入」→ 分类下拉只剩收入分类
4. 输入新标签回车 → 标签出现可选
5. 保存后结余卡片更新

- [ ] **Step 4: Commit**

```bash
git add renderer/pages/add.js renderer/index.html
git commit -m "feat: 记一笔视图（表单校验 + 豁免 + 标签 + 保存）"
```

---

### Task 11: 账本视图（分页列表 + 编辑/删除）

**Files:**
- Create: `renderer/pages/ledger.js`
- Modify: `renderer/index.html`、`renderer/app.js`（同 Task 10 模式）

**Interfaces:**
- Consumes: `window.ledger.listTransactions({page,pageSize,month})`, `getTransaction`, `updateTransaction`, `deleteTransaction`, `listCategories`, `listTags`
- Produces: `window.renderers.ledger(root)`：按月过滤（默认当月）+ 分页控件；每行显示日期/分类/标签/备注/金额/豁免徽章；编辑弹出行内表单；删除前 confirm

- [ ] **Step 1: 写 `renderer/pages/ledger.js`**

```js
window.renderers = window.renderers || {};

window.renderers.ledger = async function (root) {
  const month = new Date().toISOString().slice(0, 7);
  let page = 1;
  const pageSize = 100;

  async function render() {
    const r = await window.ledger.listTransactions({ page, pageSize, month });
    if (!r.ok) { root.innerHTML = `<div class="card">加载失败：${r.error}</div>`; return; }
    const { items, total } = r.data;
    const rows = items.map(t => `
      <tr data-id="${t.id}">
        <td>${t.date}</td>
        <td>${t.type === 'income' ? '收入' : '支出'}${t.exempt ? ' <span class="badge">豁免</span>' : ''}</td>
        <td>${(t.amount / 100).toFixed(2)} 元</td>
        <td>${t.note || ''}</td>
        <td>
          <button class="btn ghost edit-btn">编辑</button>
          <button class="btn danger del-btn">删除</button>
        </td>
      </tr>`).join('');
    root.innerHTML = `
      <div class="card">
        <h2>账本</h2>
        <input type="month" id="g-month" value="${month}" />
        <table style="width:100%;border-collapse:collapse;margin-top:12px">
          <thead><tr><th>日期</th><th>类型</th><th>金额</th><th>备注</th><th>操作</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">本月暂无记录</td></tr>'}</tbody>
        </table>
        <div style="margin-top:12px;display:flex;gap:10px;align-items:center">
          <button class="btn ghost" id="g-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
          <span>第 ${page} 页 / 共 ${Math.max(1, Math.ceil(total / pageSize))} 页（${total} 条）</span>
          <button class="btn ghost" id="g-next" ${page * pageSize >= total ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
    root.querySelector('#g-month').onchange = (e) => { month = e.target.value; page = 1; render(); };
    root.querySelector('#g-prev').onclick = () => { page--; render(); };
    root.querySelector('#g-next').onclick = () => { page++; render(); };
    root.querySelectorAll('.edit-btn').forEach(b =>
      b.onclick = () => editForm(root.querySelector(`tr[data-id="${b.closest('tr').dataset.id}"]`)));
    root.querySelectorAll('.del-btn').forEach(b =>
      b.onclick = async () => {
        const id = b.closest('tr').dataset.id;
        if (!confirm('确认删除这条记录？')) return;
        await window.ledger.deleteTransaction(Number(id));
        render();
      });
  }

  async function editForm(tr) {
    const id = Number(tr.dataset.id);
    const r = await window.ledger.getTransaction(id);
    if (!r.ok) return;
    const t = r.data;
    const cats = await window.ledger.listCategories(t.type);
    tr.innerHTML = `
      <td><input type="date" value="${t.date}" class="e-date" /></td>
      <td><select class="e-type">
        <option value="expense" ${t.type === 'expense' ? 'selected' : ''}>支出</option>
        <option value="income" ${t.type === 'income' ? 'selected' : ''}>收入</option>
      </select></td>
      <td><input type="number" step="0.01" value="${(t.amount / 100).toFixed(2)}" class="e-amount" /></td>
      <td><input value="${t.note}" class="e-note" /></td>
      <td><button class="btn e-save">保存</button> <button class="btn ghost e-cancel">取消</button></td>`;
    tr.querySelector('.e-save').onclick = async () => {
      await window.ledger.updateTransaction(id, {
        type: tr.querySelector('.e-type').value,
        amount: Math.round(parseFloat(tr.querySelector('.e-amount').value) * 100),
        date: tr.querySelector('.e-date').value,
        categoryId: t.category_id,
        note: tr.querySelector('.e-note').value,
        exempt: t.exempt, exemptNote: t.exempt_note, tagIds: t.tags.map(x => x.id),
      });
      render();
    };
    tr.querySelector('.e-cancel').onclick = render;
  }

  await render();
};
```

- [ ] **Step 2: 修改 `renderer/index.html`（app.js 之前加 `<script src="pages/ledger.js">`）**

- [ ] **Step 3: 手动验收**

Run: `npm start` → 账本页：
1. 看到 Task 10 保存的记录
2. 点「编辑」改金额保存 → 列表刷新
3. 点「删除」→ confirm → 记录消失
4. 切换月份显示对应记录，分页按钮状态正确

- [ ] **Step 4: Commit**

```bash
git add renderer/pages/ledger.js renderer/index.html
git commit -m "feat: 账本视图（月度过滤 + 分页 + 编辑/删除）"
```

---

### Task 12: 统计视图（ECharts 饼图/趋势图 + 结余卡片 + 重大支出分区）

**Files:**
- Create: `renderer/pages/stats.js`
- Modify: `renderer/index.html`、`renderer/app.js`

**Interfaces:**
- Consumes: `window.ledger.getStatistics({period,date})`, `getExemptTransactions(month)`
- Produces: `window.renderers.stats(root)`：日/月/年切换；结余卡片（收入/常规支出/豁免支出/结余）；分类饼图（ECharts pie）；收支趋势折线图（ECharts line，数据来自 `stats.trend`）；月视图下展示「重大支出」独立分区列表；金额统一 `/100` 显示

- [ ] **Step 1: 写 `renderer/pages/stats.js`**

```js
window.renderers = window.renderers || {};

window.renderers.stats = async function (root) {
  let period = 'month';
  const today = new Date().toISOString().slice(0, 10);

  async function render() {
    const r = await window.ledger.getStatistics({ period, date: today });
    if (!r.ok) { root.innerHTML = `<div class="card">加载失败：${r.error}</div>`; return; }
    const s = r.data;
    const fmt = (v) => (v / 100).toFixed(2) + ' 元';
    let exemptSection = '';
    if (period === 'month') {
      const ex = await window.ledger.getExemptTransactions(today.slice(0, 7));
      exemptSection = `<div class="card"><h3>重大支出（豁免，不计入当月常规支出）</h3>
        ${ex.ok && ex.data.length ? ex.data.map(e =>
          `<p>${e.date} ${fmt(e.amount)} — ${e.exempt_note} ${e.note}</p>`).join('')
          : '<p>本月无豁免支出</p>'}</div>`;
    }
    root.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn ${period === 'day' ? '' : 'ghost'}" data-p="day">日</button>
        <button class="btn ${period === 'month' ? '' : 'ghost'}" data-p="month">月</button>
        <button class="btn ${period === 'year' ? '' : 'ghost'}" data-p="year">年</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px">
        <div class="card"><div class="label" style="color:var(--text-muted)">收入</div><div style="font-size:20px;font-weight:700;color:var(--accent)">${fmt(s.income)}</div></div>
        <div class="card"><div class="label" style="color:var(--text-muted)">常规支出</div><div style="font-size:20px;font-weight:700">${fmt(s.expense)}</div></div>
        <div class="card"><div class="label" style="color:var(--text-muted)">豁免支出</div><div style="font-size:20px;font-weight:700;color:var(--warn)">${fmt(s.exemptExpense)}</div></div>
        <div class="card"><div class="label" style="color:var(--text-muted)">结余</div><div style="font-size:20px;font-weight:700;color:${s.balance >= 0 ? 'var(--accent)' : 'var(--danger)'}">${fmt(s.balance)}</div></div>
      </div>
      <div class="card"><h3>分类占比</h3><div id="pie" style="height:280px"></div></div>
      <div class="card"><h3>收支趋势</h3><div id="line" style="height:280px"></div></div>
      ${exemptSection}`;
    root.querySelectorAll('[data-p]').forEach(b =>
      b.onclick = () => { period = b.dataset.p; render(); });

    const charts = [];
    charts.push(echarts.init(root.querySelector('#pie')));
    charts.push(echarts.init(root.querySelector('#line')));
    charts[0].setOption({
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie', radius: ['40%', '70%'],
        data: s.byCategory.map(c => ({ name: c.name, value: c.amount / 100 })),
        label: { formatter: '{b}: {d}%' },
      }],
    });
    charts[1].setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: ['收入', '支出'] },
      xAxis: { type: 'category', data: s.trend.map(t => t.label) },
      yAxis: { type: 'value' },
      series: [
        { name: '收入', type: 'line', smooth: true, data: s.trend.map(t => t.income / 100) },
        { name: '支出', type: 'line', smooth: true, data: s.trend.map(t => t.expense / 100) },
      ],
    });
  }

  await render();
};
```

- [ ] **Step 2: 修改 `renderer/index.html` 引入 echarts 与 stats.js（app.js 之前）**

```html
  <script src="../node_modules/echarts/dist/echarts.min.js"></script>
  <script src="pages/stats.js"></script>
```

- [ ] **Step 3: 手动验收**

Run: `npm start` → 统计页：
1. 三张结余卡片数值正确（与账本核对）
2. 饼图展示分类占比；趋势图展示收支曲线
3. 月视图显示「重大支出」分区；日/年视图无该分区
4. 年视图支出含豁免（对比月视图口径不同）

- [ ] **Step 4: Commit**

```bash
git add renderer/pages/stats.js renderer/index.html
git commit -m "feat: 统计视图（ECharts 饼图/趋势图 + 重大支出分区）"
```

---

### Task 13: 预算视图（设置 + 进度条 + 超支警告）

**Files:**
- Create: `renderer/pages/budget.js`
- Modify: `renderer/index.html`、`renderer/app.js`

**Interfaces:**
- Consumes: `window.ledger.setBudget`, `getBudgets(month)`, `getBudgetSummary(month)`, `listCategories('expense')`
- Produces: `window.renderers.budget(root)`：月份选择（默认当月）；总额预算输入 + 各支出分类预算输入；每项进度条（`spent/amount`）；超支时进度条变红并显示「已超支」徽章；汇总卡片（总额预算/已用/百分比）

- [ ] **Step 1: 写 `renderer/pages/budget.js`**

```js
window.renderers = window.renderers || {};

window.renderers.budget = async function (root) {
  let month = new Date().toISOString().slice(0, 7);

  async function render() {
    const [catsR, budR, sumR] = await Promise.all([
      window.ledger.listCategories('expense'),
      window.ledger.getBudgets(month),
      window.ledger.getBudgetSummary(month),
    ]);
    if (!budR.ok) { root.innerHTML = `<div class="card">加载失败：${budR.error}</div>`; return; }
    const cats = catsR.ok ? catsR.data : [];
    const budgets = budR.data;
    const sum = sumR.ok ? sumR.data : null;
    const total = budgets.find(b => b.categoryId === null);

    const bar = (b) => {
      const pct = b.amount > 0 ? Math.min(100, Math.round((b.spent / b.amount) * 100)) : 0;
      const color = b.over ? 'var(--danger)' : (pct >= 80 ? 'var(--warn)' : 'var(--accent)');
      return `<div style="height:8px;background:#eef1f8;border-radius:99px;margin:6px 0">
        <div style="height:8px;width:${pct}%;background:${color};border-radius:99px;transition:width .4s ease"></div>
      </div>
      <span style="font-size:12px;color:var(--text-muted)">
        ${(b.spent / 100).toFixed(2)} / ${(b.amount / 100).toFixed(2)} 元（${pct}%）
        ${b.over ? '<span class="badge" style="background:var(--danger);color:#fff">已超支</span>' : ''}
      </span>`;
    };

    root.innerHTML = `
      <div class="card">
        <h2>预算</h2>
        <input type="month" id="b-month" value="${month}" />
        <h3 style="margin-top:16px">总额预算</h3>
        ${total ? bar(total) : '<p style="color:var(--text-muted)">未设置</p>'}
        <input id="b-total" type="number" step="0.01" placeholder="每月总支出预算（元）"
          value="${total ? (total.amount / 100).toFixed(2) : ''}" />
        <button class="btn" id="b-save-total">保存总额预算</button>
        <h3 style="margin-top:16px">分类预算</h3>
        ${cats.map(c => {
          const b = budgets.find(x => x.categoryId === c.id);
          return `<div style="margin-bottom:10px">
            <span>${c.name}</span> ${b ? bar(b) : ''}
            <input class="b-cat" data-cat="${c.id}" type="number" step="0.01"
              placeholder="分类预算（元）" value="${b ? (b.amount / 100).toFixed(2) : ''}" />
          </div>`;
        }).join('')}
        <button class="btn" id="b-save-cats">保存分类预算</button>
      </div>`;

    root.querySelector('#b-month').onchange = (e) => { month = e.target.value; render(); };
    root.querySelector('#b-save-total').onclick = async () => {
      const v = parseFloat(root.querySelector('#b-total').value);
      if (!v || v <= 0) return;
      await window.ledger.setBudget({ categoryId: null, month, amount: Math.round(v * 100) });
      render();
    };
    root.querySelector('#b-save-cats').onclick = async () => {
      for (const inp of root.querySelectorAll('.b-cat')) {
        const v = parseFloat(inp.value);
        await window.ledger.setBudget({
          categoryId: Number(inp.dataset.cat), month,
          amount: Math.round(v * 100),
        });
      }
      render();
    };
  }

  await render();
};
```

- [ ] **Step 2: 修改 `renderer/index.html` 引入 `pages/budget.js`**

- [ ] **Step 3: 手动验收**

Run: `npm start` → 预算页：
1. 设总额预算 1000 元，当月常规支出 300 元 → 进度 30%
2. 记账一笔豁免支出 5000 元 → 进度不变（不含豁免）
3. 常规支出超过预算 → 进度条变红 + 「已超支」徽章
4. 分类预算独立显示

- [ ] **Step 4: Commit**

```bash
git add renderer/pages/budget.js renderer/index.html
git commit -m "feat: 预算视图（进度条 + 超支警告 + 豁免不占额度）"
```

---

### Task 14: 导入导出视图（Excel 导入 + CSV/汇总导出）

**Files:**
- Create: `renderer/pages/io.js`
- Modify: `renderer/index.html`、`renderer/app.js`

**Interfaces:**
- Consumes: `window.ledger.pickExcelFile`, `importExcel(path,{createMissingCategories})`, `exportCsv`, `exportSummary(month)`
- Produces: `window.renderers.io(root)`：Excel 导入区（选文件 → 结果报告：成功/失败行数 + 错误明细，可勾选「自动创建缺失分类」）；导出区（导出 CSV、导出当月汇总文本，成功提示保存路径）

- [ ] **Step 1: 写 `renderer/pages/io.js`**

```js
window.renderers = window.renderers || {};

window.renderers.io = async function (root) {
  root.innerHTML = `
    <div class="card">
      <h2>导入导出</h2>
      <h3>导入 Excel</h3>
      <label><input type="checkbox" id="io-create-cat" checked /> 自动创建缺失分类</label>
      <p style="margin:8px 0;color:var(--text-muted)">
        表头需包含：日期、类型（收入/支出）、金额、分类（可选）、备注（可选）、豁免（可选，填「是」）
      </p>
      <button class="btn" id="io-import">选择 Excel 文件并导入</button>
      <div id="io-result"></div>
      <h3 style="margin-top:20px">导出</h3>
      <button class="btn ghost" id="io-csv">导出 CSV（全部记录）</button>
      <button class="btn ghost" id="io-summary">导出当月汇总文本（给 AI 分析）</button>
      <div id="io-export-result"></div>
    </div>`;

  root.querySelector('#io-import').onclick = async () => {
    const res = document.getElementById('io-result');
    const path = await window.ledger.pickExcelFile();
    if (!path) return;
    res.textContent = '导入中…';
    const r = await window.ledger.importExcel(path,
      { createMissingCategories: root.querySelector('#io-create-cat').checked });
    if (!r.ok) { res.textContent = '导入失败：' + r.error; return; }
    res.innerHTML = `<p>成功导入 ${r.data.imported} 行，失败 ${r.data.failed} 行</p>` +
      (r.data.errors.length
        ? `<ul style="font-size:12px;color:var(--danger)">${r.data.errors.map(e =>
            `<li>第 ${e.row} 行：${e.message}</li>`).join('')}</ul>` : '');
    document.getElementById('balance-value').textContent = '--';
  };

  root.querySelector('#io-csv').onclick = async () => {
    const out = document.getElementById('io-export-result');
    const r = await window.ledger.exportCsv();
    out.textContent = r.ok && r.data ? `已导出：${r.data}` : (r.ok ? '已取消' : '失败：' + r.error);
  };
  root.querySelector('#io-summary').onclick = async () => {
    const out = document.getElementById('io-export-result');
    const month = new Date().toISOString().slice(0, 7);
    const r = await window.ledger.exportSummary(month);
    out.textContent = r.ok && r.data ? `已导出：${r.data}` : (r.ok ? '已取消' : '失败：' + r.error);
  };
};
```

- [ ] **Step 2: 修改 `renderer/index.html` 引入 `pages/io.js`**

- [ ] **Step 3: 手动验收**

Run: `npm start` → 导入导出页：
1. 用 Task 7 测试里的样例 xlsx 导入 → 成功行数正确
2. 取消勾选「自动创建分类」导入含新分类文件 → 显示错误明细、无数据写入
3. 导出 CSV → 用记事本确认首字符 BOM、Excel 打开中文不乱码
4. 导出汇总文本 → 内容含收支/分类占比/预算/重大支出/趋势

- [ ] **Step 4: Commit**

```bash
git add renderer/pages/io.js renderer/index.html
git commit -m "feat: 导入导出视图（Excel 导入 + CSV/汇总导出）"
```

---

### Task 15: 管理视图（分类/标签管理）

**Files:**
- Create: `renderer/pages/manage.js`
- Modify: `renderer/index.html`、`renderer/app.js`

**Interfaces:**
- Consumes: `window.ledger.listCategories`, `createCategory`, `updateCategory`, `deleteCategory`, `listTags`, `createTag`, `deleteTag`
- Produces: `window.renderers.manage(root)`：支出/收入分类两个分组，新增/改名/删除；标签列表，新增/删除

- [ ] **Step 1: 写 `renderer/pages/manage.js`**

```js
window.renderers = window.renderers || {};

window.renderers.manage = async function (root) {
  async function render() {
    const [catsR, tagsR] = await Promise.all([
      window.ledger.listCategories(), window.ledger.listTags()]);
    const cats = catsR.ok ? catsR.data : [];
    const tags = tagsR.ok ? tagsR.data : [];
    const group = (type, label) => `
      <h3>${label}</h3>
      <div id="m-${type}">
        ${cats.filter(c => c.type === type).map(c => `
          <div style="display:flex;gap:8px;align-items:center;margin:6px 0">
            <input class="m-cat-name" data-id="${c.id}" value="${c.name}" />
            <button class="btn ghost m-cat-save" data-id="${c.id}">改名</button>
            <button class="btn danger m-cat-del" data-id="${c.id}">删除</button>
          </div>`).join('')}
        <div style="display:flex;gap:8px;margin-top:8px">
          <input id="m-new-${type}" placeholder="新${label}" />
          <button class="btn m-cat-add" data-type="${type}">添加</button>
        </div>
      </div>`;
    root.innerHTML = `
      <div class="card">
        <h2>管理</h2>
        ${group('expense', '支出分类')}
        ${group('income', '收入分类')}
        <h3 style="margin-top:20px">标签</h3>
        <div id="m-tags">
          ${tags.map(t => `
            <span class="badge" style="margin:4px">${t.name}
              <button class="m-tag-del" data-id="${t.id}" style="border:none;background:none;cursor:pointer;color:inherit">×</button>
            </span>`).join('')}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input id="m-new-tag" placeholder="新标签" />
          <button class="btn m-tag-add">添加</button>
        </div>
      </div>`;

    root.querySelectorAll('.m-cat-add').forEach(b =>
      b.onclick = async () => {
        const inp = root.querySelector(`#m-new-${b.dataset.type}`);
        if (!inp.value.trim()) return;
        await window.ledger.createCategory({ name: inp.value.trim(), type: b.dataset.type });
        render();
      });
    root.querySelectorAll('.m-cat-save').forEach(b =>
      b.onclick = async () => {
        const inp = root.querySelector(`.m-cat-name[data-id="${b.dataset.id}"]`);
        const cat = cats.find(c => String(c.id) === b.dataset.id);
        await window.ledger.updateCategory(Number(b.dataset.id),
          { name: inp.value.trim(), type: cat.type, sort_order: cat.sort_order });
        render();
      });
    root.querySelectorAll('.m-cat-del').forEach(b =>
      b.onclick = async () => {
        const r = await window.ledger.deleteCategory(Number(b.dataset.id));
        if (!r.ok) { alert(r.error); return; }
        render();
      });
    root.querySelector('.m-tag-add').onclick = async () => {
      const inp = root.querySelector('#m-new-tag');
      if (!inp.value.trim()) return;
      await window.ledger.createTag(inp.value.trim());
      render();
    };
    root.querySelectorAll('.m-tag-del').forEach(b =>
      b.onclick = async () => { await window.ledger.deleteTag(Number(b.dataset.id)); render(); });
  }
  await render();
};
```

- [ ] **Step 2: 修改 `renderer/index.html` 引入 `pages/manage.js`**

- [ ] **Step 3: 手动验收**

Run: `npm start` → 管理页：
1. 添加支出分类「交通」→ 记一笔页下拉出现
2. 改名分类 → 记账记录的分类显示同步变化
3. 删除有记录的分类 → 弹出错误提示
4. 添加/删除标签正常

- [ ] **Step 4: Commit**

```bash
git add renderer/pages/manage.js renderer/index.html
git commit -m "feat: 管理视图（分类/标签管理）"
```

---

### Task 16: 收尾（动效打磨 + README + 全量验收）

**Files:**
- Create: `README.md`
- Modify: `renderer/styles.css`（如有需要）

**Interfaces:**
- Consumes: 全部已完成任务
- Produces: `README.md`（启动方式、功能清单、导出文件说明）；最终手动验收清单全部通过

- [ ] **Step 1: 写 `README.md`**

```markdown
# 记账应用（Ledger App）

Windows 桌面记账应用：记录收入/支出，按日/月/年统计结余，月度预算超支警告，豁免重大支出，图表可视化，CSV/汇总文本导出（可交给 AI 分析），Excel 导入。

## 启动

```bash
npm install
npm start
```

## 测试

```bash
npm test
```

## 功能

- 记一笔：支出/收入、自定义分类、标签、备注、豁免（不计入当月支出与预算）
- 账本：月度记录列表、分页、编辑、删除
- 统计：日/月/年视图、结余卡片、分类饼图、收支趋势、重大支出分区
- 预算：总额 + 分类预算、进度条、超支警告（不含豁免）
- 导入导出：Excel 导入（事务回滚）、CSV（UTF-8 BOM）、汇总文本
- 管理：分类/标签维护

## 统计口径（豁免规则）

- 当日/当月常规支出、预算进度、超支警告：不含豁免
- 当日/当月结余：含豁免（真实结余）
- 季度/年度总支出：含豁免
```

- [ ] **Step 2: 跑全量测试**

Run: `npm test`
Expected: 14 个测试全部 PASS

- [ ] **Step 3: 全量手动验收清单（逐项勾选）**

Run: `npm start`
- [ ] 记一笔：支出/收入切换、金额、分类、标签新增、备注、豁免+原因、校验提示
- [ ] 账本：分页、编辑、删除、月份过滤
- [ ] 统计：日/月/年切换、结余卡片数值正确、饼图、趋势图、重大支出分区
- [ ] 预算：设置、进度条动画、超支变红、豁免不占额度
- [ ] 导入导出：导入成功/回滚、CSV BOM、汇总文本内容完整
- [ ] 管理：分类增删改、标签增删、删除受限提示
- [ ] 结余卡片与统计页数值一致
- [ ] 窗口关闭后重新打开，数据仍在（持久化）

- [ ] **Step 4: Commit**

```bash
git add README.md renderer/styles.css
git commit -m "docs: README + 收尾打磨"
```
