// 后续 Task 8 填充完整 IPC 桥接
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('ledger', { ping: () => 'pong' });
