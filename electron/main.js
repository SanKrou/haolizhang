const { app, BrowserWindow, ipcMain, Menu } = require('electron');
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
    minWidth: 940,
    minHeight: 600,
    frame: false, // 无边框窗口：自绘标题栏
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // 去掉原生菜单栏
  getDb().catch(err => console.error('数据库初始化失败：', err)); // 启动时初始化并做完整性检查
  registerIpc(ipcMain, getDb);

  // 窗口控制（自绘标题栏按钮）
  ipcMain.handle('win:minimize', (e) => { BrowserWindow.fromWebContents(e.sender)?.minimize(); });
  ipcMain.handle('win:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('win:close', (e) => { BrowserWindow.fromWebContents(e.sender)?.close(); });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
