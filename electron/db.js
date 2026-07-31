/**
 * electron/db.js — 数据库层（sql.js 兼容层）
 *
 * 本项目经计划偏差授权改用 sql.js（纯 WASM，无原生编译依赖）替代 better-sqlite3。
 * 本模块导出：
 *   openDb(dbPath)  — async，返回 better-sqlite3 风格兼容 db 对象
 *   SCHEMA          — 建表迁移 SQL（幂等，CREATE TABLE/INDEX IF NOT EXISTS）
 *
 * 兼容 db 对象接口（供后续 store/budget 等任务直接使用）：
 *   db.prepare(sql).all(...params)  → 对象数组
 *   db.prepare(sql).get(...params)  → 首行对象或 undefined
 *   db.prepare(sql).run(...params)  → { changes, lastInsertRowid }
 *   db.exec(sql)                    → sql.js 原生结果数组
 *   db.transaction(fn)              → 包装函数：BEGIN → fn(...args) → COMMIT，出错 ROLLBACK
 *   db.pragma(sql)                  → 用 exec 执行（如 'foreign_keys = ON'）
 *   db.close()                      → 持久化后释放
 *
 * 持久化策略：内存数据库 + 写后落盘。openDb 时若文件存在则加载，否则空库；
 * 每次 compat run 写操作后同步 writeFileSync 落盘（事务进行中暂缓，COMMIT/ROLLBACK 后落盘），
 * 保证测试可断言且不会导出未提交事务中间态。
 */
const initSqlJs = require('sql.js');
const fs = require('node:fs');
const path = require('node:path');

// Node 下自动定位 wasm；模块加载时即开始异步初始化，首次 openDb await 复用同一实例
const SQL_PROMISE = initSqlJs();

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

/**
 * 打开（或创建）数据库。
 * @param {string} dbPath 数据库文件路径；支持 ':memory:'（不落盘）
 * @returns {Promise<object>} better-sqlite3 风格兼容 db 对象
 */
async function openDb(dbPath) {
  const SQL = await SQL_PROMISE;
  const file = dbPath === ':memory:' ? null : path.resolve(dbPath);

  // 已存在则加载，否则空库
  let raw;
  if (file && fs.existsSync(file) && fs.statSync(file).size > 0) {
    raw = new SQL.Database(fs.readFileSync(file));
  } else {
    raw = new SQL.Database();
  }
  if (file) fs.mkdirSync(path.dirname(file), { recursive: true });

  let inTransaction = false;

  const persist = (force) => {
    if (!file) return;
    if (!force && inTransaction) return; // 事务进行中不中途落盘
    fs.writeFileSync(file, Buffer.from(raw.export()));
  };

  const readLastInsertRowid = () => {
    const res = raw.exec('SELECT last_insert_rowid()');
    return res[0] && res[0].values[0] ? res[0].values[0][0] : 0;
  };

  // better-sqlite3 支持位置参数数组与命名参数对象，sql.js bind 同样两者皆可
  const toBindArgs = (params) =>
    params.length === 1 &&
    params[0] !== null &&
    typeof params[0] === 'object' &&
    !Array.isArray(params[0])
      ? params[0]
      : params;

  // 兼容 better-sqlite3：prepare 返回的 statement 对象可反复调用。
  // 每次 all/get/run 调用时惰性重新 raw.prepare(sql)，用完 free——
  // 避免 sql.js Statement 释放（free）后无法再次使用（会抛 "Statement closed"）。
  const makeStatement = (sql) => {
    const use = (fn) => {
      const stmt = raw.prepare(sql);
      try {
        return fn(stmt);
      } finally {
        stmt.free();
      }
    };
    return {
      all(...params) {
        return use((stmt) => {
          stmt.bind(toBindArgs(params));
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          return rows;
        });
      },
      get(...params) {
        return use((stmt) => {
          stmt.bind(toBindArgs(params));
          return stmt.step() ? stmt.getAsObject() : undefined;
        });
      },
      run(...params) {
        return use((stmt) => {
          stmt.bind(toBindArgs(params));
          stmt.step();
          const changes = raw.getRowsModified();
          const result = { changes, lastInsertRowid: readLastInsertRowid() };
          persist(false); // 每次写后落盘
          return result;
        });
      },
    };
  };

  const db = {
    prepare: (sql) => makeStatement(sql),
    exec: (sql) => raw.exec(sql),
    pragma: (sql) => raw.exec(`PRAGMA ${sql}`),
    transaction(fn) {
      const wrapped = (...args) => {
        // 嵌套事务直接并入外层事务（近似 better-sqlite3 语义）
        if (inTransaction) return fn(...args);
        raw.exec('BEGIN');
        inTransaction = true;
        try {
          const result = fn(...args);
          raw.exec('COMMIT');
          inTransaction = false;
          persist(false);
          return result;
        } catch (err) {
          raw.exec('ROLLBACK');
          inTransaction = false;
          persist(false); // 回滚后与内存一致
          throw err;
        }
      };
      return wrapped;
    },
    close() {
      persist(true); // 强制落盘后释放
      raw.close();
    },
  };

  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb, SCHEMA };
