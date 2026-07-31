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
