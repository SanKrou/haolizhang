/**
 * electron/budget.js — 预算逻辑（Task 6）
 *
 * 依赖 Task 3/4 的 db 约定（sql.js 兼容层）：
 *   db.prepare(sql).all/get/run(...params)，语句可反复调用。
 *
 * 关键点：
 * - category_id 与 month 组合唯一（upsert：先查后改/插）。
 * - categoryId=null 表示总额预算（无分类）。
 * - spent 仅统计常规支出（exempt=0），豁免支出不计入预算进度。
 * - spentFor 分两种情况：总额预算（categoryId=null）统计当月全部常规支出
 *   （不按分类过滤）；分类预算统计该分类下的常规支出。
 */

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
  // 总额预算（categoryId=null）：当月全部常规支出，不按分类过滤
  if (categoryId === null || categoryId === undefined) {
    const row = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS n FROM transactions
       WHERE strftime('%Y-%m', date) = ? AND type='expense' AND exempt=0`
    ).get(month);
    return row.n;
  }
  // 分类预算：仅统计该分类的常规支出
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS n FROM transactions
     WHERE strftime('%Y-%m', date) = ? AND type='expense' AND exempt=0
       AND category_id = ?`
  ).get(month, categoryId);
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
