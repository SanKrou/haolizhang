const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { openDb } = require('./db');
const { registerIpc } = require('./ipc');

// openDb 为 async（sql.js 兼容层），getDb 返回 Promise，handler 内 await
let dbPromise = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = openDb(path.join(app.getPath('userData'), 'ledger.db'));
  }
  return dbPromise;
}

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
  getDb().catch(err => console.error('数据库初始化失败：', err)); // 启动时初始化并做完整性检查
  registerIpc(ipcMain, getDb);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
