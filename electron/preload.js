// Task 8：完整 IPC 桥接（contextBridge + ipcRenderer.invoke）
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
