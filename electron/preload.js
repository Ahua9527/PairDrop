// Preload script for security
// This script runs before the web page loads and can safely expose APIs to the renderer process

const { contextBridge } = require('electron');

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 可以在这里添加需要暴露给前端的API
  platform: process.platform,
  isElectron: true
});