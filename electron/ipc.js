/**
 * electron/ipc.js — IPC 桥接层（Task 8）
 *
 * registerIpc(ipcMain, getDb)：注册全部 21 个通道
 *   tx:*（5）、cat:*（4）、tag:*（3）、stats:*（2）、budget:*（3）、file:*（4）。
 *
 * 约定：
 * - getDb() 返回 Promise（openDb 为 async，见 electron/db.js），
 *   每个 handler 内 `await getDb()` 后再调用 store/budget/import-export 函数。
 * - wrap 统一 try/catch，返回 { ok: true, data } 或 { ok: false, error }。
 * - file:* 通道经 dialog 选择/保存文件，取消返回 null。
 */
const { dialog } = require('electron');
const store = require('./store');
const budget = require('./budget');
const ie = require('./import-export');

function wrap(handler) {
  return async (_event, ...args) => {
    try {
      return { ok: true, data: await handler(...args) };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  };
}

function registerIpc(ipcMain, getDb) {
  // ---- 记账记录 tx:*（5） ----
  ipcMain.handle('tx:create', wrap(async (f) => store.createTransaction(await getDb(), f)));
  ipcMain.handle('tx:update', wrap(async (id, f) => store.updateTransaction(await getDb(), id, f)));
  ipcMain.handle('tx:delete', wrap(async (id) => store.deleteTransaction(await getDb(), id)));
  ipcMain.handle('tx:list', wrap(async (q) => store.listTransactions(await getDb(), q)));
  ipcMain.handle('tx:get', wrap(async (id) => store.getTransaction(await getDb(), id)));

  // ---- 分类 cat:*（4） ----
  ipcMain.handle('cat:create', wrap(async (f) => store.createCategory(await getDb(), f)));
  ipcMain.handle('cat:list', wrap(async (type) => store.listCategories(await getDb(), type)));
  ipcMain.handle('cat:update', wrap(async (id, f) => store.updateCategory(await getDb(), id, f)));
  ipcMain.handle('cat:delete', wrap(async (id) => store.deleteCategory(await getDb(), id)));

  // ---- 标签 tag:*（3） ----
  ipcMain.handle('tag:create', wrap(async (name) => store.createTag(await getDb(), name)));
  ipcMain.handle('tag:list', wrap(async () => store.listTags(await getDb())));
  ipcMain.handle('tag:delete', wrap(async (id) => store.deleteTag(await getDb(), id)));

  // ---- 统计 stats:*（2） ----
  ipcMain.handle('stats:get', wrap(async (q) => store.getStatistics(await getDb(), q)));
  ipcMain.handle('stats:exempt', wrap(async (month) => store.getExemptTransactions(await getDb(), month)));

  // ---- 预算 budget:*（3） ----
  ipcMain.handle('budget:set', wrap(async (f) => budget.setBudget(await getDb(), f)));
  ipcMain.handle('budget:list', wrap(async (month) => budget.getBudgets(await getDb(), month)));
  ipcMain.handle('budget:summary', wrap(async (month) => budget.getBudgetSummary(await getDb(), month)));

  // ---- 导入导出 file:*（4） ----
  ipcMain.handle('file:pickExcel', wrap(async () => {
    const r = await dialog.showOpenDialog({
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  }));
  ipcMain.handle('file:importExcel', wrap(async (filePath, opts) =>
    ie.importRows(await getDb(), ie.parseExcelRows(filePath), opts)));
  ipcMain.handle('file:exportCsv', wrap(async () => {
    const r = await dialog.showSaveDialog({
      defaultPath: 'ledger-export.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (r.canceled || !r.filePath) return null;
    ie.exportCsv(await getDb(), r.filePath);
    return r.filePath;
  }));
  ipcMain.handle('file:exportSummary', wrap(async (month) => {
    const r = await dialog.showSaveDialog({
      defaultPath: `ledger-summary-${month}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (r.canceled || !r.filePath) return null;
    ie.exportSummary(await getDb(), r.filePath, { month });
    return r.filePath;
  }));
}

module.exports = { registerIpc };
