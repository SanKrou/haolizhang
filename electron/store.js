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

// ---- 记账记录（Task 4） ----

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

module.exports = { createCategory, listCategories, updateCategory, deleteCategory,
                   createTag, listTags, deleteTag,
                   createTransaction, updateTransaction, deleteTransaction,
                   listTransactions, getTransaction };
