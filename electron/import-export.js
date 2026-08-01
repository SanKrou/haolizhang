/**
 * electron/import-export.js — 导入导出（Task 7）
 *
 * 依赖 Task 4/5/6 的 store/budget 与 db 约定（sql.js 兼容层）：
 *   db.prepare(sql).all/get/run(...params)、db.transaction(fn)、db.close()
 *
 * - parseExcelRows：读 xlsx，表头按包含匹配定位列；类型由「收入/支出」列
 *   或金额正负推断；豁免由「是/1/yes」判定；日期统一为 YYYY-MM-DD。
 * - importRows：事务导入，任一行失败整体回滚，返回 { imported, failed, errors }。
 * - exportCsv：UTF-8 with BOM，CRLF 行分隔，金额以元两位小数输出。
 * - exportSummary：月度汇总文本（收支 / 分类占比 / 预算执行 / 豁免清单 / 结余趋势）。
 */
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

// 只接受 yyyy[-/.]m[-/.]d 形态；非法日期返回 undefined，
// 交由 importRows 在插入时触发失败从而整批回滚（NOT NULL 约束 / sql.js bind 报错）。
function normalizeDate(raw) {
  const m = String(raw).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return undefined;
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
